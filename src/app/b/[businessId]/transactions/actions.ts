"use server";

import { refresh } from "next/cache";
import { getBusiness, getSupabase, searchArgs, todayIso } from "@/lib/dal";
import { parseFilters } from "@/lib/transactions/filters";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/validation/accounts";
import { parseForm } from "@/lib/validation/business";
import { toPosting, transactionSchema } from "@/lib/validation/transaction";
import { normalizeDescription } from "@/lib/transactions/normalize";
import { formatCents } from "@/lib/money";
import { findMerchant } from "@/lib/transactions/merchants";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_ALLOWED = { ok: false as const, error: "Only owners and editors can categorize transactions." };

async function writer(businessId: string) {
  const ctx = await getBusiness(businessId);
  return ctx.canWrite ? ctx : null;
}

type Supabase = Awaited<ReturnType<typeof getSupabase>>;

/** The other rows a filing should carry over to: the same vendor, live, after the lock date. */
async function sameVendor(supabase: Supabase, businessId: string, sourceId: string, lockDate: string | null) {
  const { data: t } = await supabase.from("transactions").select("vendor_normalized, description_clean").eq("id", sourceId).single();
  if (!t) return { vendor: null, rows: [] };
  // A well-known merchant matches by name, so older lines saved with reference codes in
  // the vendor ("state farm ro 27 cpc client") still count as the same vendor.
  const known = findMerchant(t.description_clean ?? "") ?? findMerchant(t.vendor_normalized ?? "");
  const vendor = known?.vendor ?? t.vendor_normalized;
  if (!vendor) return { vendor: null, rows: [] };
  let q = supabase.from("transactions").select("id, category_account_id, category_source, vendor_normalized, description_clean")
    .eq("business_id", businessId).is("deleted_at", null).neq("id", sourceId).limit(5000);
  q = known
    ? q.or(`vendor_normalized.eq.${JSON.stringify(vendor)},description_clean.ilike.${JSON.stringify(known.name.split(" ")[0] + "*")}`)
    : q.eq("vendor_normalized", vendor);
  if (lockDate) q = q.gt("date", lockDate);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = known
    ? data.filter((r) => r.vendor_normalized === vendor || findMerchant(r.description_clean ?? "")?.vendor === vendor)
    : data;
  return { vendor, label: known?.name ?? t.description_clean ?? vendor, rows };
}

/** Uncategorized, live, unlocked transactions with the same vendor (excluding one). */
async function findSimilar(businessId: string, sourceId: string, lockDate: string | null) {
  const { rows } = await sameVendor(await getSupabase(), businessId, sourceId, lockDate);
  return rows.filter((r) => !r.category_account_id).map((r) => r.id);
}

/** One row's earlier category, so "Undo" can put it back. */
export interface Previous { id: string; categoryId: string | null }
export interface Matched { count: number; label: string; categoryId: string; previous: Previous[] }

/**
 * Someone filed one row by hand: file the vendor's other rows the same way. Touches rows
 * that are uncategorized or were filed by the AI, a rule or the import file; never a row a
 * person filed differently on purpose.
 */
async function fileMatching(businessId: string, sourceId: string, categoryId: string, lockDate: string | null): Promise<Matched | null> {
  const supabase = await getSupabase();
  const { rows, label } = await sameVendor(supabase, businessId, sourceId, lockDate);
  const targets = rows.filter((r) => r.category_account_id !== categoryId
    && (!r.category_account_id || r.category_source !== "user"));
  if (!targets.length) return null;
  const { error } = await supabase.rpc("categorize_transactions", {
    p_transaction_ids: targets.map((r) => r.id), p_category_account_id: categoryId,
  });
  if (error) { console.error("file matching rows failed:", error.message); return null; }
  return { count: targets.length, label: label ?? "", categoryId, previous: targets.map((r) => ({ id: r.id, categoryId: r.category_account_id })) };
}

/** Undo "also filed N more": each row back to the category it had. */
export async function undoMatching(businessId: string, previous: Previous[]): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const groups = new Map<string | null, string[]>();
  for (const p of previous.slice(0, 5000)) groups.set(p.categoryId, [...(groups.get(p.categoryId) ?? []), p.id]);
  for (const [categoryId, ids] of groups) {
    const { error } = await supabase.rpc("categorize_transactions", { p_transaction_ids: ids, p_category_account_id: categoryId as string });
    if (error) return { ok: false, error: error.message };
  }
  refresh();
  return { ok: true };
}

/** After someone files rows by hand: file any rows from vendors they've now taught (2+ the same way). */
async function fileTaught(businessId: string, autoFile: boolean) {
  if (!autoFile) return;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("auto_file_suggestions", { p_business_id: businessId });
  if (error) console.error("auto-file after categorize failed:", error.message);
}

export interface Similar { sourceId: string; vendor: string; categoryId: string; count: number }

/**
 * Set one transaction's category (null = uncategorized) through update_transaction, so
 * its journal lines repost, and file the vendor's other rows the same way.
 */
export async function categorizeOne(businessId: string, transactionId: string, categoryId: string | null): Promise<Result<{ matched: Matched | null }>> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("categorize_transactions", {
    p_transaction_ids: [transactionId], p_category_account_id: categoryId as string,
  });
  if (error) return { ok: false, error: error.message };
  const matched = categoryId ? await fileMatching(businessId, transactionId, categoryId, ctx.business.lock_date) : null;
  if (categoryId) await fileTaught(businessId, ctx.business.ai_auto_file);
  refresh();
  return { ok: true, matched };
}

/** After a suggestion is accepted: carry it to the vendor's other rows, like a hand filing. */
export async function fileMatchingFor(businessId: string, transactionId: string, categoryId: string): Promise<Matched | null> {
  const ctx = await writer(businessId);
  if (!ctx) return null;
  return fileMatching(businessId, transactionId, categoryId, ctx.business.lock_date);
}

/** Bulk: either explicit ids, or every row matching a list URL's filters. */
export async function bulkCategorize(
  businessId: string,
  target: { ids: string[] } | { query: string },
  categoryId: string | null,
): Promise<Result<{ changed: number }>> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const supabase = await getSupabase();

  let ids: string[];
  if ("ids" in target) {
    ids = target.ids;
  } else {
    const filters = parseFilters(new URLSearchParams(target.query));
    const { data, error } = await supabase
      .rpc("search_transactions", searchArgs(businessId, filters, todayIso(), ctx.business.fiscal_year_start_month))
      .select("id").limit(5000);
    if (error) return { ok: false, error: error.message };
    ids = data.map((t) => t.id);
  }
  if (!ids.length) return { ok: true, changed: 0 };

  const { data: changed, error } = await supabase.rpc("categorize_transactions", {
    p_transaction_ids: ids, p_category_account_id: categoryId as string,
  });
  if (error) return { ok: false, error: error.message };
  if (categoryId) await fileTaught(businessId, ctx.business.ai_auto_file);
  refresh();
  return { ok: true, changed };
}

/** "Apply to similar": same category on the vendor's other uncategorized rows, optionally as a rule. */
export async function applyToSimilar(businessId: string, similar: Similar, saveRule: boolean): Promise<Result<{ changed: number }>> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const ids = await findSimilar(businessId, similar.sourceId, ctx.business.lock_date);
  let changed = 0;
  if (ids.length) {
    const { data, error } = await supabase.rpc("categorize_transactions", {
      p_transaction_ids: ids, p_category_account_id: similar.categoryId,
    });
    if (error) return { ok: false, error: error.message };
    changed = data;
  }
  if (saveRule) {
    const { error } = await supabase.rpc("save_category_rule", {
      p_business_id: businessId, p_vendor_normalized: similar.vendor, p_category_account_id: similar.categoryId,
    });
    if (error) return { ok: false, error: error.message };
  }
  refresh();
  return { ok: true, changed };
}

/** Create a category from inside the picker; returns its id so the picker can select it. */
export async function quickCreateCategory(businessId: string, name: string, type: AccountType): Promise<Result<{ id: string }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const clean = name.trim();
  if (!clean || clean.length > 100) return { ok: false, error: "Enter a name under 100 characters." };
  if (!ACCOUNT_TYPES.includes(type)) return { ok: false, error: "Pick a type." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").insert({ business_id: businessId, name: clean, type }).select("id").single();
  if (error?.code === "23505") return { ok: false, error: `There's already an account named "${clean}".` };
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Add, edit, delete, restore, history (Prompt 5)
// ---------------------------------------------------------------------------

export type SaveResult =
  | { ok: true; id: string; matched: Matched | null }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[] | undefined> };

/** Add (transactionId null) or edit a transaction from the drawer form. */
export async function saveTransaction(businessId: string, transactionId: string | null, formData: FormData): Promise<SaveResult> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const parsed = parseForm(transactionSchema, formData);
  if (parsed.state) return { ok: false, fieldErrors: parsed.state.fieldErrors };
  const p = toPosting(parsed.data);
  // Cleaned description and vendor are always derived from the raw text.
  const { description_clean, vendor_normalized } = normalizeDescription(p.description_raw);
  const supabase = await getSupabase();

  let result;
  if (transactionId) {
    const { data: current } = await supabase.from("transactions").select("dedupe_hash").eq("id", transactionId).single();
    result = await supabase.rpc("update_transaction", {
      p_transaction_id: transactionId, p_date: p.date, p_money_account_id: p.money_account_id,
      p_amount_cents: p.amount_cents, p_description_raw: p.description_raw,
      p_category_account_id: p.category_account_id as string, p_description_clean: description_clean,
      p_vendor_normalized: vendor_normalized as string, p_memo: p.memo as string, p_reference: p.reference as string,
      p_dedupe_hash: current?.dedupe_hash as string,
    });
  } else {
    result = await supabase.rpc("post_transaction", {
      p_business_id: businessId, p_date: p.date, p_money_account_id: p.money_account_id,
      p_amount_cents: p.amount_cents, p_description_raw: p.description_raw,
      p_category_account_id: p.category_account_id ?? undefined, p_description_clean: description_clean,
      p_vendor_normalized: vendor_normalized ?? undefined, p_memo: p.memo ?? undefined, p_reference: p.reference ?? undefined,
      p_source: "manual",
    });
  }
  if (result.error) {
    if (result.error.hint === "locked_period") return { ok: false, fieldErrors: { date: [result.error.message] } };
    return { ok: false, error: result.error.message };
  }
  // The drawer filled the category from a rule: record it as the rule's (the database
  // re-checks that the rule really wins for this transaction).
  const ruleId = String(formData.get("rule_id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(ruleId) && p.category_account_id) {
    const marked = await supabase.rpc("mark_transaction_rule", { p_transaction_id: result.data as string, p_rule_id: ruleId });
    if (marked.error) console.error("mark_transaction_rule failed:", marked.error.message);
  }
  let matched: Matched | null = null;
  if (transactionId && p.category_account_id && !/^[0-9a-f-]{36}$/i.test(ruleId)) {
    const ctx = await getBusiness(businessId);
    matched = await fileMatching(businessId, transactionId, p.category_account_id, ctx.business.lock_date);
    await fileTaught(businessId, ctx.business.ai_auto_file);
  }
  refresh();
  return { ok: true, id: result.data as string, matched };
}

export async function deleteTransactions(businessId: string, ids: string[]): Promise<Result<{ changed: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("soft_delete_transactions", { p_transaction_ids: ids });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, changed: data };
}

export async function restoreTransactions(businessId: string, ids: string[]): Promise<Result<{ changed: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("restore_transactions", { p_transaction_ids: ids });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, changed: data };
}

/** Delete every row matching a list URL (the "select all matching" case). */
export async function deleteMatching(businessId: string, query: string): Promise<Result<{ changed: number; ids: string[] }>> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const filters = parseFilters(new URLSearchParams(query));
  const { data, error } = await supabase
    .rpc("search_transactions", searchArgs(businessId, filters, todayIso(), ctx.business.fiscal_year_start_month))
    .select("id").limit(5000);
  if (error) return { ok: false, error: error.message };
  const ids = data.map((t) => t.id);
  const r = await deleteTransactions(businessId, ids);
  return r.ok ? { ok: true, changed: r.changed, ids } : r;
}

export interface HistoryEntry {
  at: string;
  who: string;
  action: string;
  changes: { field: string; from: string; to: string }[];
}

const FIELDS: [key: string, label: string][] = [
  ["date", "Date"], ["amount_cents", "Amount"], ["description_raw", "Description"], ["money_account_id", "Account"],
  ["category_account_id", "Category"], ["memo", "Memo"], ["reference", "Reference"],
];

/** The audit trail for one transaction, as "who changed what, when". */
export async function getHistory(businessId: string, transactionId: string): Promise<Result<{ entries: HistoryEntry[] }>> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const [{ data, error }, { data: accounts }] = await Promise.all([
    supabase.rpc("transaction_history", { p_transaction_id: transactionId }),
    supabase.from("accounts").select("id, name").eq("business_id", businessId),
  ]);
  if (error) return { ok: false, error: error.message };
  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const show = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return key === "category_account_id" ? "Uncategorized" : "—";
    if (key === "amount_cents") return formatCents(Number(v), { signPositive: true });
    if (key.endsWith("_account_id")) return names.get(String(v)) ?? "(removed account)";
    return String(v);
  };
  const entries = data.map((e) => {
    const before = (e.before ?? {}) as Record<string, unknown>;
    const after = (e.after ?? {}) as Record<string, unknown>;
    const changes = e.action === "update"
      ? FIELDS.filter(([k]) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
          .map(([k, label]) => ({ field: label, from: show(k, before[k]), to: show(k, after[k]) }))
      : [];
    return { at: e.at, who: e.actor_email ?? "Unknown", action: e.action, changes };
  });
  return { ok: true, entries };
}

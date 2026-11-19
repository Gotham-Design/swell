// Data access layer: every server-side read of the session or business data goes through
// here, as the signed-in user, so RLS decides what comes back.
import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/validation/business";
import { PAGE_SIZE, amountRange, resolveRange, type Filters } from "@/lib/transactions/filters";
import { searchCents } from "@/lib/transactions/search";

// connection() marks every read as request-time: the Supabase client checks token expiry
// with Date.now(), which Next refuses to evaluate while prerendering.
export const getSupabase = cache(async () => {
  await connection();
  return createClient();
});

export const getUser = cache(async () => {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { id: user.id, email: user.email ?? "" };
});

/** Businesses the user belongs to, with their role in each. */
export const getMyBusinesses = cache(async () => {
  const user = await getUser();
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("business_members")
    .select("role, businesses(id, name, archived_at)")
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return data
    .flatMap((m) => (m.businesses ? [{ id: m.businesses.id, name: m.businesses.name, role: m.role as Role, archived: !!m.businesses.archived_at }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/** The business plus the user's role, or a 404 if they aren't a member. */
export const getBusiness = cache(async (businessId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound();
  const user = await getUser();
  const supabase = await getSupabase();
  const [{ data: business }, { data: member }] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    supabase.from("business_members").select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!business || !member) notFound();
  const role = member.role as Role;
  return {
    business,
    role,
    canWrite: role === "owner" || role === "editor",
    canManage: role === "owner",
  };
});

/** Chart of accounts for the categories page: everything but money accounts and hidden ones. */
export async function getCategories(businessId: string) {
  const { business } = await getBusiness(businessId);
  const form = business.tax_form;
  const supabase = await getSupabase();
  const [accounts, usage, mappings] = await Promise.all([
    supabase.from("accounts")
      .select("id, name, type, subtype, parent_id, description, is_system, is_standard, archived_at")
      .eq("business_id", business.id).eq("is_money_account", false).eq("is_hidden", false).order("name"),
    supabase.from("account_usage").select("account_id, line_count, child_count").eq("business_id", business.id),
    form
      ? supabase.from("account_tax_lines").select("account_id, tax_line_id").eq("business_id", business.id).eq("form", form)
      : Promise.resolve({ data: [] as { account_id: string; tax_line_id: string }[], error: null }),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (usage.error) throw new Error(usage.error.message);
  if (mappings.error) throw new Error(mappings.error.message);
  const byId = new Map(usage.data.map((u) => [u.account_id, u]));
  const lineOf = new Map(mappings.data.map((m) => [m.account_id, m.tax_line_id]));
  return accounts.data.map((a) => ({
    ...a,
    line_count: byId.get(a.id)?.line_count ?? 0,
    child_count: byId.get(a.id)?.child_count ?? 0,
    tax_line_id: lineOf.get(a.id) ?? null,
  }));
}
export type CategoryRow = Awaited<ReturnType<typeof getCategories>>[number];

/** The lines of one tax form, in form order. */
export async function getTaxLines(form: string | null) {
  if (!form) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("tax_lines").select("id, line, label").eq("form", form).order("sort");
  if (error) throw new Error(error.message);
  return data;
}
export type TaxLine = Awaited<ReturnType<typeof getTaxLines>>[number];

/** What a category picker offers (active, visible, non-system; money accounts included). */
export async function getPickerOptions(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("category_picker")
    .select("id, name, type, parent_id, is_money_account").eq("business_id", business.id).order("name");
  if (error) throw new Error(error.message);
  return data.flatMap((o) => (o.id && o.name && o.type
    ? [{ id: o.id, name: o.name, type: o.type, parent_id: o.parent_id, is_money_account: !!o.is_money_account }]
    : []));
}
export type PickerOption = Awaited<ReturnType<typeof getPickerOptions>>[number];

/** Money accounts with their current balance (as people read it) and opening balance. */
export async function getMoneyAccounts(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data: accounts, error } = await supabase.from("accounts")
    .select("id, name, type, subtype, last4, archived_at, opening_transaction_id")
    .eq("business_id", business.id).eq("is_money_account", true).order("name");
  if (error) throw new Error(error.message);
  const ids = accounts.map((a) => a.id);
  const openingIds = accounts.flatMap((a) => (a.opening_transaction_id ? [a.opening_transaction_id] : []));
  const [balances, openings] = await Promise.all([
    supabase.from("account_balances").select("account_id, natural_balance_cents").in("account_id", ids),
    supabase.from("transactions").select("id, date, amount_cents, deleted_at").in("id", openingIds),
  ]);
  if (balances.error) throw new Error(balances.error.message);
  if (openings.error) throw new Error(openings.error.message);
  const balanceOf = new Map(balances.data.map((b) => [b.account_id, b.natural_balance_cents ?? 0]));
  const openingOf = new Map(openings.data.filter((t) => !t.deleted_at).map((t) => [t.id, t]));
  return accounts.map((a) => {
    const opening = a.opening_transaction_id ? openingOf.get(a.opening_transaction_id) : undefined;
    const sign = a.type === "liability" ? -1 : 1;
    return {
      id: a.id,
      name: a.name,
      kind: a.subtype ?? "checking",
      last4: a.last4,
      archived: !!a.archived_at,
      balance_cents: balanceOf.get(a.id) ?? 0,
      opening_balance_cents: opening ? sign * opening.amount_cents : 0,
      opening_date: opening?.date ?? null,
    };
  });
}
export type MoneyAccountRow = Awaited<ReturnType<typeof getMoneyAccounts>>[number];

import { STALE_IMPORT_DAYS } from "@/lib/accounts/freshness";
export { STALE_IMPORT_DAYS };

/** Last committed import per money account: when it was imported and the statement's last date. */
export async function getLastImports(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("money_account_last_import")
    .select("money_account_id, last_committed_at, last_statement_date").eq("business_id", business.id);
  if (error) throw new Error(error.message);
  return new Map(data.flatMap((r) => (r.money_account_id && r.last_committed_at
    ? [[r.money_account_id, { at: r.last_committed_at, statementDate: r.last_statement_date }] as const] : [])));
}

/** "Imported Oct 21" and whether it's stale (older than 21 days, or never). */
export function importFreshness(lastAt: string | undefined, now = Date.now()) {
  if (!lastAt) return { label: "Never imported", stale: true, daysAgo: null as number | null };
  const at = new Date(lastAt);
  const daysAgo = Math.floor((now - at.getTime()) / 86_400_000);
  const date = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return { label: daysAgo > STALE_IMPORT_DAYS ? `Last import ${date}` : `Imported ${date}`, stale: daysAgo > STALE_IMPORT_DAYS, daysAgo };
}

/** Today as YYYY-MM-DD (server clock, UTC). */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Filter arguments for search_transactions / summarize_transactions. */
export function searchArgs(businessId: string, f: Filters, today: string, fiscalYearStartMonth: number) {
  const { from, to } = resolveRange(f, today, fiscalYearStartMonth);
  const { min, max } = amountRange(f);
  return {
    p_business_id: businessId,
    p_from: from ?? undefined,
    p_to: to ?? undefined,
    p_types: f.types.length ? f.types : undefined,
    p_categorized_by: f.categorizedBy.length ? f.categorizedBy : undefined,
    p_category_ids: f.categories.length ? f.categories : undefined,
    p_money_account_ids: f.accounts.length ? f.accounts : undefined,
    p_amount_min: min ?? undefined,
    p_amount_max: max ?? undefined,
    p_sources: f.sources.length ? f.sources : undefined,
    p_query: f.q || undefined,
    // A search that reads as money also matches that amount.
    p_query_cents: f.q ? searchCents(f.q) ?? undefined : undefined,
    p_deleted: f.deleted,
    p_import_batch_id: f.batch ?? undefined,
  };
}

/** One page of the filtered transaction list, plus count and totals for the whole set. */
export async function getTransactionsPage(businessId: string, f: Filters) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const args = searchArgs(business.id, f, todayIso(), business.fiscal_year_start_month);
  const offset = (f.page - 1) * PAGE_SIZE;
  const [rows, summary] = await Promise.all([
    supabase.rpc("search_transactions", args)
      .select("id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id, category_account_id, category_source, category_rule_id, kind, source, memo, reference, deleted_at, created_at")
      .order("date", { ascending: false }).order("created_at", { ascending: false }).order("id")
      .range(offset, offset + PAGE_SIZE - 1),
    supabase.rpc("summarize_transactions", args).single(),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  if (summary.error) throw new Error(summary.error.message);
  return { rows: rows.data, summary: summary.data };
}
export type TransactionRow = Awaited<ReturnType<typeof getTransactionsPage>>["rows"][number];

/** id -> name for every account (archived and system too, since old rows may use them). */
export async function getAccountNames(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").select("id, name").eq("business_id", business.id);
  if (error) throw new Error(error.message);
  return Object.fromEntries(data.map((a) => [a.id, a.name])) as Record<string, string>;
}

/** The categories used most recently, newest first (for the top of the picker). */
export async function getRecentCategoryIds(businessId: string, limit = 5) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("transactions").select("category_account_id")
    .eq("business_id", business.id).not("category_account_id", "is", null).is("deleted_at", null)
    .order("updated_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return [...new Set(data.map((t) => t.category_account_id!))].slice(0, limit);
}

/** Rules for the Rules page: active and suggested (draft), with conditions and actions, in priority order. */
export async function getRules(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("category_rules")
    .select("id, name, priority, match_mode, stop_processing, enabled, origin, status, times_applied, last_applied_at, confirmations, created_at, rule_conditions(field, operator, value, case_sensitive, position), rule_actions(action, account_id, value, position)")
    .eq("business_id", business.id).is("deleted_at", null)
    .order("priority").order("created_at").order("id");
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    ...r,
    rule_conditions: [...r.rule_conditions].sort((a, b) => a.position - b.position),
    rule_actions: [...r.rule_actions].sort((a, b) => a.position - b.position),
  }));
}
export type RuleRow = Awaited<ReturnType<typeof getRules>>[number];

/** id -> name of every rule (deleted too), for "categorized by rule X" on old rows. */
export async function getRuleNames(businessId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("category_rules").select("id, name").eq("business_id", businessId);
  if (error) throw new Error(error.message);
  return Object.fromEntries(data.map((r) => [r.id, r.name])) as Record<string, string>;
}

/**
 * Transactions waiting for review: every live uncategorized row. A pending suggestion only
 * ever sits on an uncategorized row, so this is Suggested + Needs review. Drives the rail
 * dot, tab counts, the sidebar card and the P&L footnote.
 */
export const getToReviewCount = cache(async (businessId: string) => {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { count, error } = await supabase.from("transactions").select("id", { count: "exact", head: true })
    .eq("business_id", business.id).is("deleted_at", null).is("category_account_id", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
});

/** AI suggestions on/off, this month's token use, and how many suggestions wait for review. */
export async function getAiState(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [budget, pending, confident] = await Promise.all([
    supabase.rpc("ai_budget", { p_business_id: business.id }),
    supabase.from("ai_suggestion_queue").select("id", { count: "exact", head: true }).eq("business_id", business.id),
    // What auto_file_suggestions would file: unflagged, 0.9+ or vendor history.
    supabase.from("ai_suggestion_queue").select("id", { count: "exact", head: true }).eq("business_id", business.id)
      .filter("flags", "eq", "{}").or("confidence.gte.0.9,model.eq.vendor-history"),
  ]);
  if (budget.error) throw new Error(budget.error.message);
  if (pending.error) throw new Error(pending.error.message);
  const b = budget.data?.[0];
  return {
    enabled: business.ai_enabled,
    used: Number(b?.used ?? 0),
    budget: Number(b?.budget ?? business.ai_monthly_token_budget),
    exhausted: Number(b?.remaining ?? 1) <= 0,
    pending: pending.count ?? 0,
    /** Pending and confident enough to file automatically. */
    confident: confident.count ?? 0,
    autoFile: business.ai_auto_file,
  };
}
export type AiState = Awaited<ReturnType<typeof getAiState>>;

/** Pending suggestions for the transactions on screen, by transaction id. */
export async function getSuggestionsFor(businessId: string, transactionIds: string[]) {
  if (!transactionIds.length) return {};
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("ai_suggestion_queue")
    .select("id, transaction_id, category_account_id, category_name, confidence, reason, flags, runner_up_category_account_id, runner_up_name, runner_up_confidence, vendor_normalized, vendor_has_history")
    .eq("business_id", businessId).in("transaction_id", transactionIds);
  if (error) throw new Error(error.message);
  return Object.fromEntries(data.flatMap((s) => (s.transaction_id && s.id ? [[s.transaction_id, {
    id: s.id, category_account_id: s.category_account_id!, category_name: s.category_name ?? "",
    confidence: Number(s.confidence), reason: s.reason, flags: s.flags ?? [],
    runner_up_id: s.runner_up_name ? s.runner_up_category_account_id : null,
    runner_up_name: s.runner_up_name ?? null,
    vendor: s.vendor_normalized ?? null,
    vendor_has_history: !!s.vendor_has_history,
  } satisfies SuggestionChipData]] : [])));
}
export type SuggestionChipData = {
  id: string; category_account_id: string; category_name: string; confidence: number; reason: string | null; flags: string[];
  /** Second most likely category, when the model gave one and it's still usable. */
  runner_up_id?: string | null; runner_up_name?: string | null;
  vendor?: string | null;
  /** People have filed this vendor before: the drawer may say "based on how past X charges were filed". */
  vendor_has_history?: boolean;
};

/** Statement files clients sent that haven't been imported or deleted (0 for viewers). */
export async function getReceivedCount(businessId: string) {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return 0;
  const supabase = await getSupabase();
  const { count } = await supabase.from("statement_uploads").select("id", { count: "exact", head: true })
    .eq("business_id", business.id).is("deleted_at", null).is("imported_at", null);
  return count ?? 0;
}

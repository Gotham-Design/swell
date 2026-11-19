// Reads for the import verify/commit screens, as the signed-in user (RLS applies).
import "server-only";
import { notFound } from "next/navigation";
import { getBusiness, getSupabase } from "@/lib/dal";
import type { BalanceCheck } from "@/lib/import/reconcile";
import { mappingSchema } from "@/lib/validation/import";

export const IMPORT_TABS = ["all", "import", "problems", "duplicates", "near", "skipped"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];
export const IMPORT_TAB_LABEL: Record<ImportTab, string> = {
  all: "All rows", import: "Will import", problems: "Problems", duplicates: "Duplicates", near: "Possible duplicates", skipped: "Skipped",
};
export const ROWS_PER_PAGE = 100;

export async function getImportBatch(businessId: string, batchId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
  const ctx = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data: batch } = await supabase.from("import_batches")
    .select("id, status, file_name, money_account_id, mapping, row_count, skipped_count, committed_count, total_in_cents, total_out_cents, date_from, date_to, balance_check, category_map, committed_at, undone_at, created_at")
    .eq("id", batchId).eq("business_id", ctx.business.id).maybeSingle();
  if (!batch) notFound();
  const { data: account } = await supabase.from("accounts").select("name, subtype").eq("id", batch.money_account_id).single();
  const mapping = mappingSchema.safeParse(batch.mapping);
  return {
    ...ctx,
    batch: {
      ...batch,
      mapping: mapping.success ? mapping.data : null,
      balance_check: batch.balance_check as BalanceCheck | null,
      account_name: account?.name ?? "",
    },
  };
}

/** One page of a tab, plus how many rows each tab has. */
export async function getImportRows(batchId: string, tab: ImportTab, page: number) {
  const supabase = await getSupabase();
  // Each tab is one equality filter on the staged rows.
  const where = (t: ImportTab): Record<string, string | boolean> => ({
    all: {}, import: { included: true }, problems: { status: "error" }, duplicates: { status: "duplicate" },
    near: { status: "near_duplicate" }, skipped: { included: false },
  })[t];
  const from = (page - 1) * ROWS_PER_PAGE;
  const [rows, ...counts] = await Promise.all([
    supabase.from("import_rows")
      .select("id, row_index, raw, date, amount_cents, description_raw, category_name, category_account_id, status, decision, included, parse_issues, check_issues, duplicate_of_row, duplicate_of_transaction, near_duplicate_of, transaction_id")
      .eq("import_batch_id", batchId).match(where(tab))
      .order("row_index").range(from, from + ROWS_PER_PAGE - 1),
    ...IMPORT_TABS.map((t) => supabase.from("import_rows").select("id", { count: "exact", head: true })
      .eq("import_batch_id", batchId).match(where(t))),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  const tabCounts = Object.fromEntries(IMPORT_TABS.map((t, i) => [t, counts[i].count ?? 0])) as Record<ImportTab, number>;
  return { rows: rows.data, tabCounts };
}
export type ImportRow = Awaited<ReturnType<typeof getImportRows>>["rows"][number];

/** Category names in the file that don't match a category yet, with how many rows use each. */
export async function getUnmatchedCategories(batchId: string) {
  const supabase = await getSupabase();
  const { data } = await supabase.from("import_rows").select("category_name")
    .eq("import_batch_id", batchId).is("category_account_id", null).not("category_name", "is", null).limit(50000);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const name = r.category_name!.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, rows]) => ({ name, rows })).sort((a, b) => b.rows - a.rows);
}

/** The descriptions of transactions rows were flagged against, for "duplicate of…" text. */
export async function getMatchedTransactions(ids: string[]) {
  if (!ids.length) return {};
  const supabase = await getSupabase();
  const { data } = await supabase.from("transactions").select("id, date, description_clean, description_raw, amount_cents").in("id", ids);
  return Object.fromEntries((data ?? []).map((t) => [t.id, t]));
}

/** Recent imports for the import page. */
export async function getRecentImports(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data } = await supabase.from("import_batches").select("id, file_name, status, row_count, committed_count, created_at, money_account_id")
    .eq("business_id", business.id).order("created_at", { ascending: false }).limit(10);
  return data ?? [];
}

/**
 * The statement's ending balance from its balance column: the balance on the latest row
 * (files run oldest-first or newest-first, so compare both ends). null without a balance column.
 */
export async function getEndingBalance(batchId: string): Promise<number | null> {
  const supabase = await getSupabase();
  const end = (ascending: boolean) => supabase.from("import_rows").select("date, balance_cents")
    .eq("import_batch_id", batchId).not("balance_cents", "is", null).not("date", "is", null)
    .order("row_index", { ascending }).limit(1).maybeSingle();
  const [first, last] = await Promise.all([end(true), end(false)]);
  const a = first.data, b = last.data;
  if (!a || !b || a.balance_cents === null || b.balance_cents === null) return null;
  return (a.date! > b.date! ? a.balance_cents : b.balance_cents);
}

/** Files clients sent (not imported or deleted yet) and request links still open. */
export async function getClientRequests(businessId: string) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const now = new Date().toISOString();
  const [files, links] = await Promise.all([
    supabase.from("statement_uploads").select("id, file_name, file_size_bytes, uploaded_at, request_id")
      .eq("business_id", business.id).is("deleted_at", null).is("imported_at", null).order("uploaded_at", { ascending: false }),
    supabase.from("statement_requests").select("id, from_name, created_at, expires_at")
      .eq("business_id", business.id).is("revoked_at", null).gt("expires_at", now).order("created_at", { ascending: false }),
  ]);
  if (files.error) throw new Error(files.error.message);
  if (links.error) throw new Error(links.error.message);
  const fromOf = new Map(links.data.map((l) => [l.id, l.from_name]));
  const { data: counts } = await supabase.from("statement_uploads").select("request_id").eq("business_id", business.id)
    .in("request_id", links.data.map((l) => l.id));
  return {
    files: files.data.map((f) => ({ id: f.id, fileName: f.file_name, size: f.file_size_bytes, uploadedAt: f.uploaded_at, fromName: fromOf.get(f.request_id) ?? "" })),
    links: links.data.map((l) => ({ id: l.id, fromName: l.from_name, createdAt: l.created_at, expiresAt: l.expires_at,
      received: (counts ?? []).filter((c) => c.request_id === l.id).length })),
  };
}

/** This client's monthly statement requests. */
export async function getStatementSchedules(businessId: string) {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("statement_schedules")
    .select("id, client_email, day_of_month, active, next_send_on, last_sent_at, last_error")
    .eq("business_id", business.id).order("created_at");
  if (error) throw new Error(error.message);
  return data.map((s) => ({
    id: s.id, email: s.client_email, day: s.day_of_month, active: s.active, nextSendOn: s.next_send_on,
    lastSentAt: s.last_sent_at, lastError: s.last_error,
  }));
}

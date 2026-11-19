import "server-only";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";

export type MonthEnd = { month: string; cents: number };

/**
 * Month-end balances for each money account, oldest first (`money_account_month_end`, in SQL;
 * natural sign: what it held, or for a card or loan what was owed).
 */
export async function getMonthEnds(businessId: string, accountIds: string[], months = 6) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const through = todayIso();
  const results = await Promise.all(accountIds.map((id) =>
    supabase.rpc("money_account_month_end", { p_business_id: business.id, p_account_id: id, p_months: months, p_through: through })));
  const out = new Map<string, MonthEnd[]>();
  results.forEach((r, i) => {
    if (r.error) throw new Error(r.error.message);
    out.set(accountIds[i], [...r.data].sort((a, b) => a.month_end.localeCompare(b.month_end))
      .map((m) => ({ month: m.month_end, cents: m.balance_cents })));
  });
  return out;
}

export type StatementRow = {
  id: string; accountId: string; fileName: string | null; from: string | null; to: string | null;
  rows: number; importedAt: string;
};

/** Committed imports, newest first: the statement history under the account cards. */
export async function getStatementHistory(businessId: string, limit = 25): Promise<StatementRow[]> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("import_batches")
    .select("id, money_account_id, file_name, date_from, date_to, committed_count, row_count, committed_at, created_at")
    .eq("business_id", business.id).eq("status", "committed")
    .order("committed_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data.map((b) => ({
    id: b.id, accountId: b.money_account_id, fileName: b.file_name, from: b.date_from, to: b.date_to,
    rows: b.committed_count ?? b.row_count ?? 0, importedAt: b.committed_at ?? b.created_at,
  }));
}

// Reads for the reports: P&L and balance sheet rows from their SQL functions, as the
// signed-in user (RLS applies), laid out as statements.
import "server-only";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";
import { balanceSheetStatement, pnlStatement, type ReportRow } from "@/lib/reports/lines";
import { fiscalYearStart, parseBsParams, parsePnlParams } from "@/lib/reports/periods";

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export async function getPnlReport(businessId: string, params: Params) {
  const { business } = await getBusiness(businessId);
  const p = parsePnlParams(params, todayIso(), business.fiscal_year_start_month);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("report_pnl", {
    p_business_id: business.id, p_from: p.range.from, p_to: p.range.to,
    p_cmp_from: p.cmp?.from, p_cmp_to: p.cmp?.to,
  });
  if (error) throw new Error(error.message);
  return { business, params: p, statement: pnlStatement(data as ReportRow[], p.range, p.cmp) };
}

export async function getBalanceSheetReport(businessId: string, params: Params) {
  const { business } = await getBusiness(businessId);
  const today = todayIso();
  const p = parseBsParams(params, today, business.fiscal_year_start_month);
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("report_balance_sheet", {
    p_business_id: business.id, p_as_of: p.asOf, p_cmp_as_of: p.cmpAsOf ?? undefined,
  });
  if (error) throw new Error(error.message);
  const fy = (d: string) => fiscalYearStart(d, business.fiscal_year_start_month);
  return { business, params: p, today, statement: balanceSheetStatement(data as ReportRow[], p.asOf, p.cmpAsOf, fy) };
}

export type PnlReport = Awaited<ReturnType<typeof getPnlReport>>;
export type BalanceSheetReport = Awaited<ReturnType<typeof getBalanceSheetReport>>;

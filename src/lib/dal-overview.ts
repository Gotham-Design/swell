// Reads for the overview, as the signed-in user (RLS applies). Every money figure comes
// from SQL (report_pnl, monthly_income_expense, money_movement, overview_notes); this file
// only picks rows and shapes them for the cards.
import "server-only";
import { getBusiness, getSupabase, todayIso } from "@/lib/dal";
import { fromIso, monthStart, dayBefore, toIso, toQueryString, EMPTY_FILTERS } from "@/lib/transactions/filters";

export type OverviewTab = "all" | "review" | "in" | "out";

/** ?month=YYYY-MM, else the current month; with its range and the month before. */
export function resolveMonth(param: unknown, today = todayIso()) {
  const t = fromIso(today);
  const m = typeof param === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : `${t.y}-${String(t.m).padStart(2, "0")}`;
  const [y, mm] = m.split("-").map(Number);
  const start = monthStart(y, mm);
  const end = dayBefore(monthStart(y, mm, 1));
  const prevStart = monthStart(y, mm, -1);
  const months = Array.from({ length: 12 }, (_, i) => { const s = monthStart(t.y, t.m, -i); return `${s.y}-${String(s.m).padStart(2, "0")}`; });
  if (!months.includes(m)) months.unshift(m);
  return {
    key: m, from: toIso(start), to: toIso(end),
    prevFrom: toIso(prevStart), prevTo: toIso(dayBefore(start)),
    name: new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    prevName: new Date(Date.UTC(prevStart.y, prevStart.m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
    months,
  };
}

/** The range the overview shows, its comparison (if any) and how many months the chart covers. */
export interface OverviewRange { from: string; to: string; prevFrom: string | null; prevTo: string | null; chartMonths: number }

export async function getOverviewData(businessId: string, month: OverviewRange) {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const today = todayIso();
  const [pnl, monthly, movement, notes, summary, coming, allTime] = await Promise.all([
    supabase.rpc("report_pnl", { p_business_id: business.id, p_from: month.from, p_to: month.to, p_cmp_from: month.prevFrom ?? undefined, p_cmp_to: month.prevTo ?? undefined }),
    supabase.rpc("monthly_income_expense", { p_business_id: business.id, p_months: month.chartMonths, p_through: month.to }),
    supabase.rpc("money_movement", { p_business_id: business.id, p_from: month.from, p_to: month.to }),
    supabase.rpc("overview_notes", { p_business_id: business.id, p_from: month.from, p_to: month.to }),
    supabase.rpc("summarize_transactions", { p_business_id: business.id, p_from: month.from, p_to: month.to }).single(),
    supabase.from("transaction_patterns")
      .select("id, vendor_normalized, expected_next_date, expected_amount_cents, cadence")
      .eq("business_id", business.id).eq("kind", "recurring").eq("direction", "out")
      .gte("expected_next_date", today).order("expected_next_date").limit(3),
    // Books health is about the whole ledger, not the month on screen.
    supabase.rpc("summarize_transactions", { p_business_id: business.id }).single(),
  ]);
  for (const r of [pnl, monthly, movement, notes, summary, coming, allTime]) if (r.error) throw new Error(r.error.message);

  const total = (key: string) => pnl.data!.find((r) => r.line_type === "total" && r.key === key);
  const income = Number(total("income_total")?.total_cents ?? 0);
  const expenses = Number(total("expense_total")?.total_cents ?? 0);
  const net = Number(total("net_income")?.total_cents ?? 0);
  const prevNet = month.prevFrom ? Number(total("net_income")?.cmp_total_cents ?? 0) : 0;
  // Biggest costs: expense categories with no children shown, uncategorized left out.
  const costs = pnl.data!.filter((r) => r.line_type === "account" && r.section === "expense" && !r.has_children && !r.is_uncategorized
    && Number(r.total_cents) > 0)
    .sort((a, b) => Number(b.total_cents) - Number(a.total_cents)).slice(0, 3)
    .map((r) => ({ id: r.account_id!, name: r.name, cents: Number(r.total_cents) }));

  const count = Number(summary.data!.count);
  const uncategorized = Number(summary.data!.uncategorized);

  return {
    income, expenses, net, prevNet,
    // Shares and percentages are display ratios of SQL totals, not money sums.
    margin: income > 0 ? net / income : null,
    change: prevNet !== 0 ? (net - prevNet) / Math.abs(prevNet) : null,
    costs,
    monthly: monthly.data!.map((m) => ({ month: m.month, income: Number(m.income_cents), expense: Number(m.expense_cents) })),
    movement: (["in", "out"] as const).map((dir) => {
      const rows = movement.data!.filter((r) => r.direction === dir);
      return {
        dir, total: Number(rows[0]?.total_cents ?? 0),
        groups: rows.map((r) => ({ label: r.label, cents: Number(r.amount_cents), rank: r.rank, isVendor: r.is_vendor })),
      };
    }),
    notes: notes.data!.map((n) => ({ kind: n.kind, headline: n.headline, detail: n.detail, href: noteHref(business.id, n.link_params as Record<string, string>, month) })),
    books: (() => {
      const n = Number(allTime.data!.count), u = Number(allTime.data!.uncategorized);
      return { count: n, categorized: n - u, uncategorized: u };
    })(),
    coming: coming.data!.map((p) => ({
      id: p.id, vendor: p.vendor_normalized ?? "", date: p.expected_next_date!, cents: Math.abs(Number(p.expected_amount_cents ?? 0)),
      cadence: p.cadence, days: Math.round((Date.parse(p.expected_next_date!) - Date.parse(today)) / 86_400_000),
    })),
  };
}

/** A note's link: the transaction list with its filter, in the overview's month where it applies. */
export function noteHref(businessId: string, params: Record<string, string>, month: { from: string; to: string }) {
  const base = `/b/${businessId}/transactions`;
  if (params.type === "uncategorized") return `${base}${toQueryString({ ...EMPTY_FILTERS, types: ["uncategorized"] })}`;
  return `${base}${toQueryString({
    ...EMPTY_FILTERS, preset: "custom", from: month.from, to: month.to,
    categories: params.cat ? [params.cat] : [], q: params.q ?? "",
  })}`;
}

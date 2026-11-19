import { balanceSheetStatement, pnlStatement, type ReportRow } from "@/lib/reports/lines";

let order = 0;
const acct = (section: string, name: string, cur: number, cmp: number | null, extra: Partial<ReportRow> = {}): ReportRow => ({
  sort_order: ++order, line_type: "account", section, key: `k${order}`, account_id: `00000000-0000-4000-8000-${String(order).padStart(12, "0")}`,
  parent_id: null, depth: 0, name, has_children: false, subtree_ids: null, own_cents: cur, total_cents: cur,
  cmp_own_cents: cmp, cmp_total_cents: cmp, ...extra,
});
const tot = (key: string, name: string, cur: number, cmp: number | null): ReportRow => ({
  sort_order: ++order, line_type: "total", section: null, key, account_id: null, parent_id: null, depth: 0, name,
  has_children: false, subtree_ids: null, own_cents: cur, total_cents: cur, cmp_own_cents: cmp, cmp_total_cents: cmp,
});

export const PNL = pnlStatement([
  acct("income", "Sales", 846036, 790210), acct("income", "Service Revenue", 193822, 165000), acct("income", "Interest Income", 500, 500),
  acct("expense", "Payroll", 360000, 360000), acct("expense", "Ingredients", 184579, 161044), acct("expense", "Insurance", 62000, 62000),
  acct("expense", "Utilities", 41213, 39866), acct("expense", "Contractors", 18000, 0), acct("expense", "Software", 9800, 9800),
  acct("expense", "Bank Fees", 9400, 6750), acct("expense", "Office Supplies", 3040, 2210), acct("expense", "Meals", 692, 1240),
  tot("income_total", "Gross income", 1040358, 955710), tot("expense_total", "Total expenses", 688724, 642910), tot("net_income", "Net income", 351634, 312800),
], { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-09-01", to: "2026-09-30" });

export const BS = balanceSheetStatement([
  acct("asset", "Bakery Checking ··4821", 7082809, null, { subtype: "checking", is_money_account: true }),
  acct("asset", "Reserve Savings ··3458", 502000, null, { subtype: "savings", is_money_account: true }),
  acct("asset", "Kitchen equipment", 1840000, null),
  acct("liability", "Business Visa ··1007", 1114732, null, { subtype: "credit_card", is_money_account: true }),
  acct("liability", "Payroll taxes due", 124000, null),
  acct("equity", "Owner investment", 5000000, null), acct("equity", "Retained earnings", 148698, null),
  { ...acct("equity", "Net income this year", 3037379, null), key: "current_year_earnings", account_id: null },
  tot("total_assets", "Total assets", 9424809, null), tot("total_liabilities", "Total liabilities", 1238732, null),
  tot("total_equity", "Total equity", 8186077, null), tot("total_liabilities_equity", "Liabilities + equity", 9424809, null),
  tot("difference", "Difference", 0, null),
], "2026-10-31", null, () => "2026-01-01");

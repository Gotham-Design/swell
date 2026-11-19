import { describe, expect, it } from "vitest";
import { generatedAt, reportFilename, slugify, toCsv, type ReportDocument } from "./document";
import { pnlStatement, percentChange, type ReportRow } from "./lines";
import {
  addMonths, bsQuery, fiscalYearStart, parseBsParams, parsePnlParams, pnlQuery, previousPeriod, sameRangeLastYear,
} from "./periods";

const sp = (q: string) => new URLSearchParams(q);

describe("periods", () => {
  it("defaults to this month against last month", () => {
    const p = parsePnlParams(sp(""), "2026-10-18", 1);
    expect(p.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p.cmp).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("year to date follows the fiscal year", () => {
    expect(parsePnlParams(sp("date=ytd"), "2026-10-18", 1).range).toEqual({ from: "2026-01-01", to: "2026-10-18" });
    expect(parsePnlParams(sp("date=ytd"), "2026-10-18", 7).range).toEqual({ from: "2026-07-01", to: "2026-10-18" });
    expect(parsePnlParams(sp("date=ytd"), "2026-03-02", 7).range).toEqual({ from: "2025-07-01", to: "2026-03-02" });
  });
  it("presets: month, quarter, last fiscal year", () => {
    expect(parsePnlParams(sp("date=this_month"), "2026-02-10", 1).range).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(parsePnlParams(sp("date=this_quarter"), "2026-10-18", 7).range).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(parsePnlParams(sp("date=last_year"), "2026-10-18", 7).range).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });
  it("custom range, and a bad one falls back with a reason", () => {
    expect(parsePnlParams(sp("date=custom&from=2026-02-01&to=2026-02-14"), "2026-10-18", 1).range)
      .toEqual({ from: "2026-02-01", to: "2026-02-14" });
    const swapped = parsePnlParams(sp("date=custom&from=2026-03-01&to=2026-02-01"), "2026-10-18", 1);
    expect(swapped.problem).toMatch(/after/);
    expect(swapped.range.from).toBe("2026-01-01");
    expect(parsePnlParams(sp("date=custom&from=2026-02-30&to=2026-03-01"), "2026-10-18", 1).problem).toMatch(/both/);
  });
  it("previous period: whole months shift by their count, other ranges by their length", () => {
    expect(previousPeriod({ from: "2026-02-01", to: "2026-02-28" })).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(previousPeriod({ from: "2026-04-01", to: "2026-06-30" })).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(previousPeriod({ from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousPeriod({ from: "2026-03-10", to: "2026-03-16" })).toEqual({ from: "2026-03-03", to: "2026-03-09" });
    // YTD (Jan 1 - Oct 18) compares with the 291 days before it.
    expect(previousPeriod({ from: "2026-01-01", to: "2026-10-18" })).toEqual({ from: "2025-03-16", to: "2025-12-31" });
  });
  it("same period last year keeps month ends (leap years)", () => {
    expect(sameRangeLastYear({ from: "2025-02-01", to: "2025-02-28" })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(sameRangeLastYear({ from: "2024-02-29", to: "2024-03-15" })).toEqual({ from: "2023-02-28", to: "2023-03-15" });
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("comparison choice from the URL", () => {
    expect(parsePnlParams(sp("date=this_month&cmp=yoy"), "2026-10-18", 1).cmp).toEqual({ from: "2025-10-01", to: "2025-10-31" });
    expect(parsePnlParams(sp("cmp=none"), "2026-10-18", 1).cmp).toBeNull();
    expect(parsePnlParams(sp("cmp=bogus"), "2026-10-18", 1).compare).toBe("prev");
  });
  it("round-trips through the query string", () => {
    const p = parsePnlParams(sp("date=custom&from=2026-01-01&to=2026-03-31&cmp=yoy"), "2026-10-18", 1);
    expect(pnlQuery(p)).toBe("?date=custom&from=2026-01-01&to=2026-03-31&cmp=yoy");
    expect(pnlQuery(parsePnlParams(sp(""), "2026-10-18", 1))).toBe("");
  });
  it("balance sheet: as of today by default, comparison dates", () => {
    expect(parseBsParams(sp(""), "2026-10-18", 1)).toMatchObject({ asOf: "2026-10-18", cmpAsOf: null });
    expect(parseBsParams(sp("asof=2026-03-31&cmp=fy_end"), "2026-10-18", 7).cmpAsOf).toBe("2025-06-30");
    expect(parseBsParams(sp("asof=2024-02-29&cmp=yoy"), "2026-10-18", 1).cmpAsOf).toBe("2023-02-28");
    expect(parseBsParams(sp("cmp=custom&cmp_date=2025-12-31"), "2026-10-18", 1).cmpAsOf).toBe("2025-12-31");
    expect(parseBsParams(sp("cmp=custom"), "2026-10-18", 1).cmpAsOf).toBeNull();
    expect(bsQuery({ asOf: "2026-10-18", compare: "none", cmpDate: null }, "2026-10-18")).toBe("");
  });
  it("fiscal year start", () => {
    expect(fiscalYearStart("2026-06-30", 7)).toBe("2025-07-01");
    expect(fiscalYearStart("2026-07-01", 7)).toBe("2026-07-01");
    expect(fiscalYearStart("2026-12-31", 1)).toBe("2026-01-01");
  });
});

const row = (r: Partial<ReportRow> & Pick<ReportRow, "key" | "name">): ReportRow => ({
  sort_order: 0, line_type: "account", section: "expense", account_id: r.key, parent_id: null, depth: 0,
  has_children: false, subtree_ids: [r.key], own_cents: 0, total_cents: 0, cmp_own_cents: null, cmp_total_cents: null, ...r,
});
const totals = (inc: number, exp: number): ReportRow[] => [
  row({ key: "income_total", name: "Gross income", line_type: "total", section: "income", account_id: null, total_cents: inc }),
  row({ key: "expense_total", name: "Total expenses", line_type: "total", account_id: null, total_cents: exp }),
  row({ key: "net_income", name: "Net income", line_type: "total", section: null, account_id: null, total_cents: inc - exp }),
];

describe("statement layout", () => {
  const range = { from: "2026-01-01", to: "2026-03-31" };
  it("puts a parent's own amount and children under it, then its total", () => {
    const s = pnlStatement([
      row({ key: "tech", name: "Tech", has_children: true, subtree_ids: ["tech", "host"], own_cents: 700, total_cents: 3700 }),
      row({ key: "host", name: "Hosting", parent_id: "tech", depth: 1, own_cents: 3000, total_cents: 3000 }),
      row({ key: "uncat", name: "Uncategorized", is_uncategorized: true, own_cents: 999, total_cents: 999 }),
      ...totals(0, 4699),
    ], range, null);
    expect(s.lines.map((l) => [l.kind, l.label, l.depth, l.cents])).toEqual([
      ["heading", "Income", 0, null],
      ["total", "Total income", 0, 0],
      ["heading", "Expenses", 0, null],
      ["parent", "Tech", 0, null],
      ["account", "Tech", 1, 700],
      ["account", "Hosting", 1, 3000],
      ["subtotal", "Total Tech", 0, 3700],
      ["account", "Uncategorized", 0, 999],
      ["total", "Total expenses", 0, 4699],
      ["grand", "Net income", 0, -4699],
    ]);
    expect(s.lines.find((l) => l.label === "Total Tech")!.drill).toEqual(
      { to: "transactions", categories: ["tech", "host"], from: "2026-01-01", to_date: "2026-03-31" });
    expect(s.uncategorized).toMatchObject({ cents: 999, drill: { uncategorized: true } });
    expect(s.lines.find((l) => l.label === "Uncategorized")!.warn).toBe(true);
  });
  it("no uncategorized warning when it nets to nothing", () => {
    const s = pnlStatement([row({ key: "u", name: "Uncategorized", is_uncategorized: true }), ...totals(0, 0)], range, null);
    expect(s.uncategorized).toBeUndefined();
  });
  it("percent change", () => {
    expect(percentChange(293301, 100000)).toBe("+193.3%");
    expect(percentChange(-1200, 295500)).toBe("-100.4%");
    expect(percentChange(500, 0)).toBeNull();
    expect(percentChange(-50, -100)).toBe("+50.0%");
  });
});

describe("downloads", () => {
  it("filenames", () => {
    expect(slugify("Acme Plumbing, LLC")).toBe("acme-plumbing-llc");
    expect(slugify("Café Ñandú")).toBe("cafe-nandu");
    expect(slugify("!!!")).toBe("business");
    expect(reportFilename("Acme", "profit-and-loss", "2026-01-01", "2026-03-31", "pdf")).toBe("acme_profit-and-loss_2026-01-01_2026-03-31.pdf");
  });
  it("generated-at falls back to UTC for an unknown zone", () => {
    const at = new Date("2026-10-18T15:04:00Z");
    expect(generatedAt(at, "America/New_York")).toBe("Oct 18, 2026, 11:04 AM EDT");
    expect(generatedAt(at, "Not/AZone")).toBe("Oct 18, 2026, 3:04 PM UTC");
  });
  it("CSV: title block, indented labels, formula-looking names defused", () => {
    const statement = pnlStatement([
      row({ key: "s", name: "=HYPERLINK(\"x\")", section: "income", total_cents: 150000, own_cents: 150000, cmp_total_cents: 100000 }),
      row({ key: "p", name: "Parent", has_children: true, subtree_ids: ["p", "c"], total_cents: 100 }),
      row({ key: "c", name: "Child", parent_id: "p", depth: 1, total_cents: 100, own_cents: 100, cmp_total_cents: 0 }),
      ...totals(150000, 100).map((r) => ({ ...r, cmp_total_cents: r.key === "income_total" ? 100000 : r.key === "net_income" ? 100000 : 0 })),
    ], { from: "2026-01-01", to: "2026-03-31" }, { from: "2025-01-01", to: "2025-03-31" });
    const doc: ReportDocument = {
      businessName: "+Acme", title: "Profit & Loss", period: "Jan 1, 2026 – Mar 31, 2026", basis: "Cash", generatedAt: "now",
      columns: { main: "2026", cmp: "2025" }, statement, filename: () => "x",
    };
    expect(toCsv(doc).split("\r\n")).toEqual([
      "'+Acme", "Profit & Loss", '"Jan 1, 2026 – Mar 31, 2026"', "Basis: Cash", "Generated now", "",
      "Account,2026,2025,$ change,% change",
      "Income,,,,",
      "\"'=HYPERLINK(\"\"x\"\")\",1500.00,1000.00,500.00,+50.0%",
      "Total income,1500.00,1000.00,500.00,+50.0%",
      "Expenses,,,,",
      "Parent,,,,",
      '"  Child",1.00,0.00,1.00,',
      "Total Parent,1.00,,,",
      "Total expenses,1.00,0.00,1.00,",
      "Net income,1499.00,1000.00,499.00,+49.9%",
      "",
    ]);
  });
});

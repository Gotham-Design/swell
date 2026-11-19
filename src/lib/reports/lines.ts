// Report rows from SQL -> the lines a statement shows (screen, PDF, CSV, XLSX all use these).
// No arithmetic on amounts here: every figure, subtotal and total comes from the report
// functions in Postgres. This only lays them out: headings, parents above their children,
// "Total <parent>" after them, and where each amount drills to.
import type { Cents } from "@/lib/money";
import type { Range } from "./periods";

export interface ReportRow {
  sort_order: number;
  line_type: string;          // account | total
  section: string | null;
  key: string;
  account_id: string | null;
  parent_id: string | null;
  depth: number;
  name: string;
  subtype?: string | null;
  is_money_account?: boolean | null;
  is_uncategorized?: boolean | null;
  has_children: boolean;
  subtree_ids: string[] | null;
  own_cents: number;
  total_cents: number;
  cmp_own_cents: number | null;
  cmp_total_cents: number | null;
}

/** Where an amount links to in the transaction list (or, for earnings, the P&L). */
export type Drill =
  | { to: "transactions"; categories?: string[]; uncategorized?: boolean; from: string | null; to_date: string }
  | { to: "pnl"; from: string; to_date: string };

export type LineKind = "heading" | "account" | "parent" | "subtotal" | "total" | "grand";

export interface ReportLine {
  key: string;
  kind: LineKind;
  label: string;
  depth: number;
  cents: Cents | null;
  cmpCents: Cents | null;
  drill?: Drill;
  cmpDrill?: Drill;
  /** Uncategorized: shown with a warning. */
  warn?: boolean;
  /** Which part of the statement the line belongs to (screens colour changes by it). */
  section?: "income" | "expense" | "asset" | "liability" | "equity";
}

export interface Statement {
  lines: ReportLine[];
  hasComparison: boolean;
  /** Balance sheet only: assets - (liabilities + equity), each column. */
  difference?: { cents: Cents; cmpCents: Cents | null };
  /** P&L only: the Uncategorized amount, if any. */
  uncategorized?: { cents: Cents; cmpCents: Cents | null; drill: Drill };
}

const n = (v: number | null | undefined): Cents | null => (v === null || v === undefined ? null : Number(v));

/**
 * Lay out account rows (already in display order, parents before their subtrees) for one
 * section: a parent shows as a label, its own transactions as a line under it, its children,
 * then "Total <name>".
 */
function layoutSection(
  rows: ReportRow[], hasCmp: boolean,
  drill: (r: ReportRow, ids: string[], cmp: boolean) => Drill | undefined,
): ReportLine[] {
  const out: ReportLine[] = [];
  const open: ReportRow[] = [];
  const close = (until: number) => {
    while (open.length && open[open.length - 1].depth >= until) {
      const p = open.pop()!;
      out.push({
        key: `${p.key}:total`, kind: "subtotal", label: `Total ${p.name}`, depth: p.depth,
        cents: n(p.total_cents), cmpCents: hasCmp ? n(p.cmp_total_cents) : null,
        drill: drill(p, p.subtree_ids ?? [], false), cmpDrill: hasCmp ? drill(p, p.subtree_ids ?? [], true) : undefined,
      });
    }
  };
  for (const r of rows) {
    close(r.depth);
    const own = [r.account_id!];
    if (r.has_children) {
      out.push({ key: r.key, kind: "parent", label: r.name, depth: r.depth, cents: null, cmpCents: null });
      if (Number(r.own_cents) !== 0 || (hasCmp && Number(r.cmp_own_cents) !== 0)) {
        out.push({
          key: `${r.key}:own`, kind: "account", label: r.name, depth: r.depth + 1,
          cents: n(r.own_cents), cmpCents: hasCmp ? n(r.cmp_own_cents) : null,
          drill: drill(r, own, false), cmpDrill: hasCmp ? drill(r, own, true) : undefined,
        });
      }
      open.push(r);
    } else {
      out.push({
        key: r.key, kind: "account", label: r.name, depth: r.depth,
        cents: n(r.total_cents), cmpCents: hasCmp ? n(r.cmp_total_cents) : null,
        drill: drill(r, own, false), cmpDrill: hasCmp ? drill(r, own, true) : undefined,
        warn: r.is_uncategorized || undefined,
      });
    }
  }
  close(0);
  return out;
}

const total = (rows: ReportRow[], key: string, kind: LineKind, hasCmp: boolean): ReportLine => {
  const r = rows.find((x) => x.key === key);
  if (!r) throw new Error(`Report is missing its ${key} row`);
  return { key, kind, label: r.name, depth: 0, cents: n(r.total_cents), cmpCents: hasCmp ? n(r.cmp_total_cents) : null };
};

export function pnlStatement(rows: ReportRow[], range: Range, cmp: Range | null): Statement {
  const hasCmp = cmp !== null;
  const drill = (r: ReportRow, ids: string[], isCmp: boolean): Drill => {
    const p = isCmp ? cmp! : range;
    return r.is_uncategorized
      ? { to: "transactions", uncategorized: true, from: p.from, to_date: p.to }
      : { to: "transactions", categories: ids, from: p.from, to_date: p.to };
  };
  const accounts = rows.filter((r) => r.line_type === "account");
  const tag = (section: ReportLine["section"], ls: ReportLine[]) => ls.map((l) => ({ ...l, section }));
  const lines: ReportLine[] = [
    ...tag("income", [
      { key: "income", kind: "heading", label: "Income", depth: 0, cents: null, cmpCents: null },
      ...layoutSection(accounts.filter((r) => r.section === "income"), hasCmp, drill),
      { ...total(rows, "income_total", "total", hasCmp), label: "Total income" },
    ]),
    ...tag("expense", [
      { key: "expense", kind: "heading", label: "Expenses", depth: 0, cents: null, cmpCents: null },
      ...layoutSection(accounts.filter((r) => r.section === "expense"), hasCmp, drill),
      total(rows, "expense_total", "total", hasCmp),
    ]),
    total(rows, "net_income", "grand", hasCmp),
  ];
  const u = accounts.find((r) => r.is_uncategorized);
  return {
    lines, hasComparison: hasCmp,
    uncategorized: u && (Number(u.total_cents) !== 0 || (hasCmp && Number(u.cmp_total_cents) !== 0))
      ? { cents: Number(u.total_cents), cmpCents: hasCmp ? n(u.cmp_total_cents) : null, drill: drill(u, [], false) }
      : undefined,
  };
}

export function balanceSheetStatement(rows: ReportRow[], asOf: string, cmpAsOf: string | null, fyStart: (d: string) => string): Statement {
  const hasCmp = cmpAsOf !== null;
  const drill = (r: ReportRow, ids: string[], isCmp: boolean): Drill | undefined => {
    const date = isCmp ? cmpAsOf! : asOf;
    // Current Year Earnings is this fiscal year's P&L.
    if (r.key === "current_year_earnings") return { to: "pnl", from: fyStart(date), to_date: date };
    // Money accounts (and their headers) hold both sides of transfers, which a category
    // filter can't show; the money accounts page has their activity.
    if (!r.account_id || r.is_money_account || r.subtype === "retained_earnings") return undefined;
    if (["checking", "savings", "cash", "credit_card"].includes(r.subtype ?? "")) return undefined;
    return { to: "transactions", categories: ids, from: null, to_date: date };
  };
  const accounts = rows.filter((r) => r.line_type === "account");
  const section = (key: "asset" | "liability" | "equity", label: string, totalKey: string): ReportLine[] => [
    { key, kind: "heading" as const, label, depth: 0, cents: null, cmpCents: null },
    ...layoutSection(accounts.filter((r) => r.section === key), hasCmp, drill),
    total(rows, totalKey, "total", hasCmp),
  ].map((l) => ({ ...l, section: key }));
  const lines = [
    ...section("asset", "Assets", "total_assets"),
    ...section("liability", "Liabilities", "total_liabilities"),
    ...section("equity", "Equity", "total_equity"),
    total(rows, "total_liabilities_equity", "grand", hasCmp),
  ];
  // The CYE row has no account id; give it its P&L drill.
  for (const l of lines) {
    if (l.key === "current_year_earnings") {
      const r = rows.find((x) => x.key === l.key)!;
      l.drill = drill(r, [], false);
      l.cmpDrill = hasCmp ? drill(r, [], true) : undefined;
    }
  }
  const d = rows.find((r) => r.key === "difference");
  return {
    lines, hasComparison: hasCmp,
    difference: d ? { cents: Number(d.total_cents), cmpCents: hasCmp ? n(d.cmp_total_cents) : null } : undefined,
  };
}

/** Percent change from `before` to `now`, one decimal; null when there's no base. */
export function percentChange(now: Cents, before: Cents): string | null {
  if (before === 0) return null;
  // Integer math in tenths of a percent, rounded half away from zero.
  const diff = now - before;
  const tenths = Math.round((Math.abs(diff) * 1000) / Math.abs(before));
  const sign = diff < 0 ? "-" : diff > 0 ? "+" : "";
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

// Report periods <-> URL. Pure functions: no I/O, no clock (pass `today`).
// P&L: a date range from a preset (fiscal-aware, via resolveRange) plus an optional
// comparison range. Balance sheet: an as-of date plus an optional comparison date.
import { dayBefore, fromIso, monthStart, resolveRange, toIso } from "@/lib/transactions/filters";

export const PNL_PRESETS = ["this_month", "last_month", "this_quarter", "ytd", "last_year", "custom"] as const;
export type PnlPreset = (typeof PNL_PRESETS)[number];
export const PNL_PRESET_LABEL: Record<PnlPreset, string> = {
  this_month: "This month", last_month: "Last month", this_quarter: "This quarter",
  ytd: "Year to date", last_year: "Last fiscal year", custom: "Custom range",
};

export const PNL_COMPARE = ["none", "prev", "yoy"] as const;
export type PnlCompare = (typeof PNL_COMPARE)[number];
export const PNL_COMPARE_LABEL: Record<PnlCompare, string> = {
  none: "No comparison", prev: "Previous period", yoy: "Same period last year",
};

export const BS_COMPARE = ["none", "fy_end", "yoy", "custom"] as const;
export type BsCompare = (typeof BS_COMPARE)[number];
export const BS_COMPARE_LABEL: Record<BsCompare, string> = {
  none: "No comparison", fy_end: "End of last fiscal year", yoy: "Same date last year", custom: "Another date",
};

export interface Range { from: string; to: string }

type Params = Record<string, string | string[] | undefined> | URLSearchParams;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function get(params: Params, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
  return Array.isArray(v) ? v[0] : v;
}
function isDate(v: string | undefined): v is string {
  if (!v || !ISO_DATE.test(v)) return false;
  const { y, m, d } = fromIso(v);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T) =>
  (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

// ---------------------------------------------------------------------------
// Date math (calendar dates as YYYY-MM-DD)
// ---------------------------------------------------------------------------
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isMonthEnd = (iso: string) => { const { y, m, d } = fromIso(iso); return d === daysInMonth(y, m); };

/** The same day n months later; the 31st becomes the month's last day, and so does a month end. */
export function addMonths(iso: string, n: number): string {
  const { y, m, d } = fromIso(iso);
  const s = monthStart(y, m, n);
  const last = daysInMonth(s.y, s.m);
  return toIso({ y: s.y, m: s.m, d: isMonthEnd(iso) ? last : Math.min(d, last) });
}
export function addDays(iso: string, n: number): string {
  const { y, m, d } = fromIso(iso);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => {
  const t = (iso: string) => { const { y, m, d } = fromIso(iso); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
};

/** First day of the fiscal year containing `iso`. */
export function fiscalYearStart(iso: string, fiscalYearStartMonth: number): string {
  const { y, m } = fromIso(iso);
  return toIso(monthStart(m >= fiscalYearStartMonth ? y : y - 1, fiscalYearStartMonth));
}

/**
 * The period before `r`: whole months shift back by their count (a quarter compares with
 * the previous quarter); anything else shifts back by its length in days.
 */
export function previousPeriod(r: Range): Range {
  const f = fromIso(r.from);
  if (f.d === 1 && isMonthEnd(r.to)) {
    const t = fromIso(r.to);
    const months = (t.y * 12 + t.m) - (f.y * 12 + f.m) + 1;
    const from = toIso(monthStart(f.y, f.m, -months));
    return { from, to: toIso(dayBefore(fromIso(r.from))) };
  }
  const len = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}
export function sameRangeLastYear(r: Range): Range {
  return { from: addMonths(r.from, -12), to: addMonths(r.to, -12) };
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------
export interface PnlParams {
  preset: PnlPreset;
  from: string | null; // as typed, for custom
  to: string | null;
  compare: PnlCompare;
  range: Range;
  cmp: Range | null;
  /** Why the custom range was replaced by the default. */
  problem: string | null;
}

export function parsePnlParams(params: Params, today: string, fiscalYearStartMonth: number): PnlParams {
  // Default view: this month against last month (the MVP design).
  const preset = pick(get(params, "date"), PNL_PRESETS, "this_month");
  const from = isDate(get(params, "from")) ? get(params, "from")! : null;
  const to = isDate(get(params, "to")) ? get(params, "to")! : null;
  const compare = pick(get(params, "cmp"), PNL_COMPARE, "prev");
  let problem: string | null = null;
  let range: Range;
  if (preset === "custom" && (!from || !to)) {
    problem = "Pick both a start and an end date.";
    range = resolveRange({ preset: "ytd", from: null, to: null }, today, fiscalYearStartMonth) as Range;
  } else if (preset === "custom" && from! > to!) {
    problem = "The start date is after the end date.";
    range = resolveRange({ preset: "ytd", from: null, to: null }, today, fiscalYearStartMonth) as Range;
  } else {
    range = resolveRange({ preset, from, to }, today, fiscalYearStartMonth) as Range;
  }
  const cmp = compare === "prev" ? previousPeriod(range) : compare === "yoy" ? sameRangeLastYear(range) : null;
  return { preset, from, to, compare, range, cmp, problem };
}

export function pnlQuery(p: Pick<PnlParams, "preset" | "from" | "to" | "compare">): string {
  const q = new URLSearchParams();
  if (p.preset !== "this_month") q.set("date", p.preset);
  if (p.preset === "custom") {
    if (p.from) q.set("from", p.from);
    if (p.to) q.set("to", p.to);
  }
  if (p.compare !== "prev") q.set("cmp", p.compare);
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------
export interface BsParams {
  asOf: string;
  compare: BsCompare;
  /** As typed, for custom. */
  cmpDate: string | null;
  cmpAsOf: string | null;
}

export function parseBsParams(params: Params, today: string, fiscalYearStartMonth: number): BsParams {
  const asOf = isDate(get(params, "asof")) ? get(params, "asof")! : today;
  const compare = pick(get(params, "cmp"), BS_COMPARE, "none");
  const cmpDate = isDate(get(params, "cmp_date")) ? get(params, "cmp_date")! : null;
  const cmpAsOf =
    compare === "fy_end" ? addDays(fiscalYearStart(asOf, fiscalYearStartMonth), -1)
    : compare === "yoy" ? addMonths(asOf, -12)
    : compare === "custom" ? cmpDate
    : null;
  return { asOf, compare, cmpDate, cmpAsOf };
}

export function bsQuery(p: Pick<BsParams, "asOf" | "compare" | "cmpDate">, today: string): string {
  const q = new URLSearchParams();
  if (p.asOf !== today) q.set("asof", p.asOf);
  if (p.compare !== "none") q.set("cmp", p.compare);
  if (p.compare === "custom" && p.cmpDate) q.set("cmp_date", p.cmpDate);
  const s = q.toString();
  return s ? `?${s}` : "";
}

// The overview's period and comparison <-> URL (?period=…&cmp=…), like QuickBooks' report
// dates: months, quarters, rolling 30/90 days and 12 months, year to date, last year, compared
// with the period before or the same period a year earlier. Pure: pass `today`.
// The old ?month=YYYY-MM still works.
import { addDays, addMonths, fiscalYearStart, previousPeriod, sameRangeLastYear, type Range } from "@/lib/reports/periods";
import { dayBefore, fromIso, monthStart, toIso } from "@/lib/transactions/filters";

export const PERIOD_PRESETS = [
  "this_month", "last_month", "last_30", "last_90", "this_quarter", "last_quarter", "ytd", "last_12", "last_year",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  this_month: "This month", last_month: "Last month", last_30: "Last 30 days", last_90: "Last 90 days",
  this_quarter: "This quarter", last_quarter: "Last quarter", ytd: "Year to date", last_12: "Last 12 months",
  last_year: "Last year",
};

export const COMPARES = ["none", "prev", "yoy"] as const;
export type Compare = (typeof COMPARES)[number];
export const COMPARE_LABEL: Record<Compare, string> = { prev: "Previous period", yoy: "Same period last year", none: "No comparison" };

export interface OverviewPeriod {
  /** "this_month", "last_30", … or "2026-09" for a chosen month. */
  key: string;
  from: string;
  to: string;
  /** For the picker button: "Sep 2026", "Last 30 days", "Q3 2026". */
  short: string;
  /** In sentences: "September", "the last 30 days", "Q3 2026". */
  name: string;
  compare: Compare;
  cmp: (Range & { name: string }) | null;
  /** The chart: months ending with the period's last month (at least 7). */
  chartMonths: number;
  /** Recent months for the picker, newest first ("2026-10"). */
  months: string[];
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthName = (y: number, m: number, style: "long" | "short", withYear: boolean) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", withYear ? { month: style, year: "numeric", timeZone: "UTC" } : { month: style, timeZone: "UTC" });
const shortDate = (iso: string) => {
  const d = fromIso(iso);
  return new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const quarterOf = (m: number) => Math.floor((m - 1) / 3);
const monthsSpanned = (r: Range) => { const a = fromIso(r.from); const b = fromIso(r.to); return (b.y * 12 + b.m) - (a.y * 12 + a.m) + 1; };

/** A range's name in a sentence: a whole month, a whole quarter, a whole year, or the dates. */
export function rangeName(r: Range): string {
  const a = fromIso(r.from);
  const b = fromIso(r.to);
  const lastDay = toIso(dayBefore(monthStart(b.y, b.m, 1)));
  if (a.d === 1 && r.to === lastDay) {
    const n = monthsSpanned(r);
    if (n === 1) return monthName(a.y, a.m, "long", true);
    if (n === 3 && (a.m - 1) % 3 === 0) return `Q${quarterOf(a.m) + 1} ${a.y}`;
    if (n === 12 && a.m === 1) return String(a.y);
  }
  return `${shortDate(r.from)} – ${shortDate(r.to)}`;
}

export function resolveOverviewPeriod(params: Params, today: string, fiscalYearStartMonth = 1): OverviewPeriod {
  const t = fromIso(today);
  const thisMonth = `${t.y}-${String(t.m).padStart(2, "0")}`;
  const months = Array.from({ length: 12 }, (_, i) => { const s = monthStart(t.y, t.m, -i); return `${s.y}-${String(s.m).padStart(2, "0")}`; });
  const wanted = one(params.period) ?? one(params.month);
  const key = wanted && ((PERIOD_PRESETS as readonly string[]).includes(wanted) || MONTH_KEY.test(wanted)) ? wanted : "this_month";

  const month = (y: number, m: number): Range => ({ from: toIso(monthStart(y, m)), to: toIso(dayBefore(monthStart(y, m, 1))) });
  let range: Range;
  let short: string;
  let name: string;
  if (MONTH_KEY.test(key) || key === "this_month" || key === "last_month") {
    const [y, m] = (key === "this_month" ? thisMonth : key === "last_month" ? toIso(monthStart(t.y, t.m, -1)).slice(0, 7) : key).split("-").map(Number);
    range = month(y, m);
    short = monthName(y, m, "short", true);
    name = monthName(y, m, "long", y !== t.y);
  } else if (key === "last_30" || key === "last_90") {
    const days = key === "last_30" ? 30 : 90;
    range = { from: addDays(today, -(days - 1)), to: today };
    short = PERIOD_LABEL[key];
    name = `the last ${days} days`;
  } else if (key === "this_quarter" || key === "last_quarter") {
    const q = quarterOf(t.m) - (key === "last_quarter" ? 1 : 0);
    const y = q < 0 ? t.y - 1 : t.y;
    const qq = (q + 4) % 4;
    range = { from: toIso(monthStart(y, qq * 3 + 1)), to: toIso(dayBefore(monthStart(y, qq * 3 + 1, 3))) };
    short = name = `Q${qq + 1} ${y}`;
  } else if (key === "ytd") {
    range = { from: fiscalYearStart(today, fiscalYearStartMonth), to: today };
    short = PERIOD_LABEL.ytd;
    name = fiscalYearStartMonth === 1 ? `${t.y} so far` : "this fiscal year so far";
  } else if (key === "last_12") {
    range = { from: toIso(monthStart(t.y, t.m, -11)), to: toIso(dayBefore(monthStart(t.y, t.m, 1))) };
    short = PERIOD_LABEL.last_12;
    name = "the last 12 months";
  } else {
    const start = fiscalYearStart(today, fiscalYearStartMonth);
    range = { from: addMonths(start, -12), to: addDays(start, -1) };
    short = fiscalYearStartMonth === 1 ? String(t.y - 1) : PERIOD_LABEL.last_year;
    name = fiscalYearStartMonth === 1 ? String(t.y - 1) : "last fiscal year";
  }

  const compare = ((COMPARES as readonly string[]).includes(one(params.cmp) ?? "") ? one(params.cmp) : "none") as Compare;
  // "The period before" year to date is last year to date.
  const cmpRange = compare === "none" ? null
    : compare === "yoy" || key === "ytd" ? sameRangeLastYear(range) : previousPeriod(range);
  return {
    key, ...range, short, name, compare,
    cmp: cmpRange ? { ...cmpRange, name: rangeName(cmpRange) } : null,
    chartMonths: Math.min(24, Math.max(7, monthsSpanned(range))),
    months,
  };
}

/** The overview URL for a period and comparison, keeping the recent-transactions tab. */
export function periodHref(base: string, p: { key: string; compare: Compare }, keep: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  if (p.key !== "this_month") q.set("period", p.key);
  if (p.compare !== "none") q.set("cmp", p.compare);
  for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

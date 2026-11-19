// Transaction-list filters <-> URL query string. Every filter lives in the URL so a view
// can be shared, bookmarked and reloaded. Pure functions: no I/O, no clock (pass `today`).
import { tryParseCents, type Cents } from "@/lib/money";

export const DATE_PRESETS = ["all", "this_month", "last_month", "this_quarter", "ytd", "last_year", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];
export const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  all: "All dates", this_month: "This month", last_month: "Last month", this_quarter: "This quarter",
  ytd: "Year to date", last_year: "Last year", custom: "Custom range",
};

export const TYPE_FILTERS = ["income", "expense", "transfer", "equity", "uncategorized"] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];
export const TYPE_FILTER_LABEL: Record<TypeFilter, string> = {
  income: "Income", expense: "Expense", transfer: "Transfer", equity: "Equity", uncategorized: "Uncategorized",
};

export const CATEGORIZED_BY = ["rule", "ai", "hand", "uncategorized"] as const;
export type CategorizedBy = (typeof CATEGORIZED_BY)[number];
export const CATEGORIZED_BY_LABEL: Record<CategorizedBy, string> = { rule: "By rule", ai: "By AI", hand: "By hand", uncategorized: "Not yet" };

export const SOURCES = ["manual", "import", "api"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { manual: "Manual", import: "Import", api: "Bank feed" };

export const PAGE_SIZE = 50;

export interface Filters {
  preset: DatePreset;
  from: string | null; // only for preset = custom
  to: string | null;
  types: TypeFilter[];
  /** Who set the category: a rule, AI, a person (or the import file), or nobody yet. */
  categorizedBy: CategorizedBy[];
  categories: string[];
  accounts: string[];
  /** As typed ("100", "$1,000"); parsed to cents by amountRange(). */
  min: string;
  max: string;
  sources: Source[];
  q: string;
  /** Show only soft-deleted rows (to review or restore them). */
  deleted: boolean;
  /** Only rows from this import batch. */
  batch: string | null;
  page: number;
}

export const EMPTY_FILTERS: Filters = {
  preset: "all", from: null, to: null, types: [], categorizedBy: [], categories: [], accounts: [], min: "", max: "", sources: [], q: "", deleted: false, batch: null, page: 1,
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function get(params: Params, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
  return Array.isArray(v) ? v[0] : v;
}
function list<T extends string>(params: Params, key: string, allowed?: readonly T[]): T[] {
  const raw = (get(params, key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = raw.filter((v) => (allowed ? (allowed as readonly string[]).includes(v) : UUID.test(v))) as T[];
  return [...new Set(ok)];
}
/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isDate(v: string | undefined): v is string {
  if (!v || !ISO_DATE.test(v)) return false;
  const { y, m, d } = fromIso(v);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Read filters from a URL, ignoring anything malformed. */
export function parseFilters(params: Params): Filters {
  const preset = get(params, "date") as DatePreset | undefined;
  const from = get(params, "from");
  const to = get(params, "to");
  const page = Number.parseInt(get(params, "page") ?? "1", 10);
  return {
    preset: preset && DATE_PRESETS.includes(preset) ? preset : "all",
    from: isDate(from) ? from : null,
    to: isDate(to) ? to : null,
    types: list(params, "type", TYPE_FILTERS),
    categorizedBy: list(params, "by", CATEGORIZED_BY),
    categories: list(params, "cat"),
    accounts: list(params, "acct"),
    min: (get(params, "min") ?? "").trim(),
    max: (get(params, "max") ?? "").trim(),
    sources: list(params, "source", SOURCES),
    q: (get(params, "q") ?? "").trim().slice(0, 200),
    deleted: get(params, "deleted") === "1",
    batch: UUID.test(get(params, "batch") ?? "") ? get(params, "batch")! : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Canonical query string (defaults omitted, so equal views have equal URLs). */
export function toQueryString(f: Filters): string {
  const p = new URLSearchParams();
  if (f.preset !== "all") p.set("date", f.preset);
  if (f.preset === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.categorizedBy.length) p.set("by", f.categorizedBy.join(","));
  if (f.categories.length) p.set("cat", f.categories.join(","));
  if (f.accounts.length) p.set("acct", f.accounts.join(","));
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  if (f.sources.length) p.set("source", f.sources.join(","));
  if (f.q) p.set("q", f.q);
  if (f.deleted) p.set("deleted", "1");
  if (f.batch) p.set("batch", f.batch);
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Min/max as cents (size of the amount), or null when blank/unparseable. */
export function amountRange(f: Pick<Filters, "min" | "max">): { min: Cents | null; max: Cents | null } {
  const cents = (v: string) => {
    const c = v ? tryParseCents(v) : null;
    return c === null ? null : Math.abs(c);
  };
  return { min: cents(f.min), max: cents(f.max) };
}

export function hasActiveFilters(f: Filters): boolean {
  return toQueryString({ ...f, page: 1 }) !== "";
}

// ---------------------------------------------------------------------------
// Dates (UTC calendar math on YYYY-MM-DD strings, no time zones involved)
// ---------------------------------------------------------------------------
export function fromIso(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, d: day };
}
export function toIso({ y, m, d }: { y: number; m: number; d: number }) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** First day of the month `offset` months after (y, m). */
export function monthStart(y: number, m: number, offset = 0) {
  const idx = y * 12 + (m - 1) + offset;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1, d: 1 };
}
export function dayBefore(date: { y: number; m: number; d: number }) {
  const t = Date.UTC(date.y, date.m - 1, date.d) - 86_400_000;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * The date range a filter covers. Year-based presets follow the fiscal year (and fiscal
 * quarters), so with a July start "Year to date" begins July 1. null = unbounded.
 */
export function resolveRange(f: Pick<Filters, "preset" | "from" | "to">, today: string, fiscalYearStartMonth = 1) {
  const t = fromIso(today);
  const fyStart = monthStart(t.m >= fiscalYearStartMonth ? t.y : t.y - 1, fiscalYearStartMonth);
  const range = (start: { y: number; m: number; d: number }, months: number) =>
    ({ from: toIso(start), to: toIso(dayBefore(monthStart(start.y, start.m, months))) });

  switch (f.preset) {
    case "this_month":
      return range(monthStart(t.y, t.m), 1);
    case "last_month":
      return range(monthStart(t.y, t.m, -1), 1);
    case "this_quarter": {
      const monthsIn = (t.y * 12 + t.m) - (fyStart.y * 12 + fyStart.m);
      return range(monthStart(fyStart.y, fyStart.m, Math.floor(monthsIn / 3) * 3), 3);
    }
    case "ytd":
      return { from: toIso(fyStart), to: today };
    case "last_year":
      return range(monthStart(fyStart.y, fyStart.m, -12), 12);
    case "custom":
      return { from: f.from, to: f.to };
    default:
      return { from: null, to: null };
  }
}

/**
 * The period just before [from, to], for "vs. last period". Whole calendar months shift by
 * the same number of months (Oct → Sep, Q3 → Q2); any other range shifts by its length in days.
 */
export function previousRange(from: string, to: string): { from: string; to: string; months: number | null } {
  const f = fromIso(from);
  const next = (() => { const t = fromIso(to); const d = new Date(Date.UTC(t.y, t.m - 1, t.d + 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; })();
  if (f.d === 1 && next.d === 1) {
    const months = (next.y * 12 + next.m) - (f.y * 12 + f.m);
    const start = monthStart(f.y, f.m, -months);
    return { from: toIso(start), to: toIso(dayBefore(f)), months };
  }
  const days = Math.round((Date.UTC(next.y, next.m - 1, next.d) - Date.UTC(f.y, f.m - 1, f.d)) / 86_400_000);
  const startT = Date.UTC(f.y, f.m - 1, f.d) - days * 86_400_000;
  const s = new Date(startT);
  return { from: toIso({ y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, d: s.getUTCDate() }), to: toIso(dayBefore(f)), months: null };
}

/** "This month" by default for the period select's label: "October 2026", "Q3 2026", or the dates. */
export function periodLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "All dates";
  const f = fromIso(from);
  const p = previousRange(from, to);
  const month = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  if (p.months === 1) return month(f.y, f.m);
  const short = (iso: string) => { const d = fromIso(iso); return new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
  return `${short(from)} – ${short(to)}`;
}

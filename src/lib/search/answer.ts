// Answers for the Ask bar, as the signed-in user (RLS applies). Every money figure comes
// from summarize_transactions / monthly_income_expense / overview_notes (SQL); this file only
// shapes them into a sentence, a few bars, the matching rows and what to do next.
import { accountFreshness } from "@/lib/accounts/freshness";
import "server-only";
import {
  getAiState, getBusiness, getLastImports, getPickerOptions, getSuggestionsFor, getSupabase,
  todayIso, type SuggestionChipData,
} from "@/lib/dal";
import { noteHref, resolveMonth } from "@/lib/dal-overview";
import { centsToInput, formatCents, sumCents, type Cents } from "@/lib/money";
import { findMerchant } from "@/lib/transactions/merchants";
import { EMPTY_FILTERS, fromIso, monthStart, dayBefore, previousRange, toIso, toQueryString, type Filters } from "@/lib/transactions/filters";
import type { AskQuery, AskRange, AskVocabulary } from "./parse";

/** Money accounts by name only (no balances: those cost a pass over every journal line). */
async function moneyAccountNames(businessId: string) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").select("id, name, last4, archived_at")
    .eq("business_id", businessId).eq("is_money_account", true).order("name");
  if (error) throw new Error(error.message);
  return data.map((a) => ({ id: a.id, name: a.name, last4: a.last4, archived: !!a.archived_at }));
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Vendors (most used first), categories and money accounts: what typed words can name. */
export async function getAskVocabulary(businessId: string): Promise<AskVocabulary> {
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const [txns, options, accounts] = await Promise.all([
    supabase.from("transactions").select("vendor_normalized, description_clean")
      .eq("business_id", business.id).is("deleted_at", null).not("vendor_normalized", "is", null)
      .order("date", { ascending: false }).limit(20_000),
    getPickerOptions(business.id),
    moneyAccountNames(business.id),
  ]);
  if (txns.error) throw new Error(txns.error.message);
  // One entry per vendor; a well-known merchant's lines group under its own name.
  const vendors = new Map<string, { key: string; label: string; count: number; labels: Map<string, number> }>();
  for (const t of txns.data) {
    const known = findMerchant(t.description_clean ?? "") ?? findMerchant(t.vendor_normalized ?? "");
    const key = known?.vendor ?? t.vendor_normalized!;
    const v = vendors.get(key) ?? { key, label: known?.name ?? "", count: 0, labels: new Map() };
    v.count++;
    if (!known && t.description_clean && !/\d{3,}/.test(t.description_clean)) v.labels.set(t.description_clean, (v.labels.get(t.description_clean) ?? 0) + 1);
    vendors.set(key, v);
  }
  return {
    vendors: [...vendors.values()].map((v) => ({
      key: v.key, count: v.count,
      // The way the vendor's name is most often written, else the key in title case.
      label: v.label || [...v.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || titleCase(v.key),
    })).sort((a, b) => b.count - a.count).slice(0, 3000),
    categories: options.filter((o) => !o.is_money_account).map((o) => ({ id: o.id, name: o.name, type: o.type })),
    accounts: accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, last4: a.last4 })),
  };
}

export interface AskHomeItem { kind: "review" | "import" | "pnl" | "note"; title: string; detail: string; href: string; cta: string; warn?: boolean }

/** "Pick up where you left off": suggestions waiting, an account behind on imports, this month, one note. */
export async function getAskHome(businessId: string): Promise<AskHomeItem[]> {
  const { business, canWrite } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const base = `/b/${business.id}`;
  const month = resolveMonth(undefined);
  const [ai, accounts, imports, monthly, notes, toReview] = await Promise.all([
    getAiState(business.id),
    moneyAccountNames(business.id),
    getLastImports(business.id),
    supabase.rpc("monthly_income_expense", { p_business_id: business.id, p_months: 1, p_through: month.to }),
    supabase.rpc("overview_notes", { p_business_id: business.id, p_from: month.from, p_to: month.to }),
    supabase.from("transactions").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).is("deleted_at", null).is("category_account_id", null),
  ]);
  const items: AskHomeItem[] = [];
  const uncategorized = toReview.count ?? 0;
  if (uncategorized > 0) {
    const waiting = ai.pending;
    items.push({
      kind: "review", href: `${base}/transactions?type=uncategorized`, cta: "Review",
      title: waiting > 0 ? `Review ${waiting} suggestion${waiting === 1 ? "" : "s"}` : `${uncategorized} transaction${uncategorized === 1 ? "" : "s"} need a category`,
      detail: waiting > 0
        ? `${ai.confident} ready to accept · ${Math.max(0, waiting - ai.confident)} need a look`
        : "Pick a category and matching ones follow",
    });
  }
  const through = (id: string) => imports.get(id)?.statementDate ?? imports.get(id)?.at ?? "";
  const stale = accounts.filter((a) => !a.archived).map((a) => ({ a, f: accountFreshness(imports.get(a.id)) }))
    .filter((x) => x.f.stale).sort((x, y) => through(x.a.id).localeCompare(through(y.a.id)))[0];
  if (stale && canWrite) {
    items.push({
      kind: "import", href: `${base}/import?account=${stale.a.id}`, cta: "Import", warn: true,
      title: `Import a statement for ${stale.a.name}`,
      detail: stale.f.label,
    });
  }
  const m = monthly.data?.[0];
  if (m) {
    const income = Number(m.income_cents);
    const expense = Number(m.expense_cents);
    items.push({
      kind: "pnl", href: `${base}/reports`, cta: "Open",
      title: `${month.name} profit & loss`,
      detail: income || expense ? `Net income ${formatCents(sumCents([income, -expense]))} so far` : "Nothing posted this month yet",
    });
  }
  const note = notes.data?.find((n) => n.kind !== "to_review");
  if (note) {
    items.push({
      kind: "note", href: noteHref(business.id, note.link_params as Record<string, string>, month), cta: "See why",
      title: note.headline, detail: note.detail,
    });
  }
  return items.slice(0, 4);
}

export interface AskRow {
  id: string; date: string; description: string; vendor: string | null; amount: Cents;
  money_account_id: string; category_account_id: string | null; category_source: string | null; locked: boolean;
}
export interface AskAnswer {
  /** "$4,916.72 at Restaurant Depot in the last 90 days" */
  headline: string;
  /** "14 purchases on Business Visa", "up 18% on the 90 days before", "2 still uncategorized" */
  details: string[];
  bars: { label: string; cents: Cents }[];
  count: number;
  rows: AskRow[];
  suggestions: Record<string, SuggestionChipData>;
  href: string;
  exportHref: string;
  vendor?: { label: string; count: number; avg: Cents };
  category?: { id: string; name: string; type: string; yearCents: Cents };
  rule?: { vendorKey: string; vendorLabel: string; categoryId: string; categoryName: string };
  accept: { ids: string[]; categoryNames: string[] };
  /** No rows at all: the answer says so and offers a wider look. */
  empty: boolean;
  /** For "each month", "largest", "top vendors": totals by month, category or vendor. */
  breakdown?: { kind: "month" | "category" | "vendor"; rows: BreakdownRow[] };
}
export interface BreakdownRow {
  key: string; label: string; detail?: string; cents: Cents; top?: boolean;
  /** Clicking a row asks about just that month, category or vendor. */
  refine: AskQuery; refineLabel: string;
}

const ROWS = 25;

function filtersFor(q: AskQuery): Filters {
  return {
    ...EMPTY_FILTERS,
    preset: q.range ? "custom" : "all",
    from: q.range?.from ?? null,
    to: q.range?.to ?? null,
    categorizedBy: q.uncategorized ? ["uncategorized"] : [],
    categories: q.category ? [q.category.id] : [],
    accounts: q.account ? [q.account.id] : [],
    min: q.min !== undefined ? centsToInput(q.min) : "",
    max: q.max !== undefined ? centsToInput(q.max) : "",
    q: q.vendor?.key ?? q.search ?? "",
  };
}

function args(businessId: string, q: AskQuery, range?: { from: string; to: string } | null) {
  const r = range === undefined ? q.range : range;
  return {
    p_business_id: businessId,
    p_from: r?.from ?? undefined,
    p_to: r?.to ?? undefined,
    p_categorized_by: q.uncategorized ? ["uncategorized"] : undefined,
    p_category_ids: q.category ? [q.category.id] : undefined,
    p_money_account_ids: q.account ? [q.account.id] : undefined,
    p_amount_min: q.min ?? undefined,
    p_amount_max: q.max ?? undefined,
    p_query: q.vendor?.key ?? q.search ?? undefined,
  };
}

/** Money for the question's measure from a summary row: spend and earn as positive amounts. */
function measured(q: AskQuery, s: { total_in: number; total_out: number; net: number }): Cents {
  if (q.measure === "spend") return Math.abs(Number(s.total_out));
  if (q.measure === "earn") return Number(s.total_in);
  return Number(s.net);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const whenText = (r?: AskRange) => (r ? (r.label.startsWith("the ") || r.label.startsWith("since") ? r.label : `in ${r.label}`) : "all time");
const monthLabel = (iso: string, long = false) => {
  const d = fromIso(iso);
  return new Date(Date.UTC(d.y, d.m - 1, 1)).toLocaleDateString("en-US", long ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" });
};

/** Totals by month, category or vendor, every figure from SQL. */
async function answerBreakdown(businessId: string, q: AskQuery): Promise<AskAnswer> {
  const supabase = await getSupabase();
  const range = q.range!;
  const out = q.measure !== "earn";
  const verb = out ? "spent" : "came in";
  const filtered = !!(q.vendor || q.category || q.account || q.search || q.uncategorized || q.min !== undefined || q.max !== undefined);
  const who = q.vendor ? ` at ${q.vendor.label}` : q.category ? ` on ${q.category.name}` : q.search ? ` on “${q.search}”` : "";
  const base: Omit<AskAnswer, "headline" | "details" | "breakdown"> = {
    bars: [], count: 0, rows: [], suggestions: {}, accept: { ids: [], categoryNames: [] }, empty: false,
    href: `/b/${businessId}/transactions${toQueryString(filtersFor({ ...q, group: undefined }))}`,
    exportHref: `/b/${businessId}/transactions/export${toQueryString(filtersFor({ ...q, group: undefined }))}`,
  };
  let rows: BreakdownRow[] = [];

  if (q.group === "month") {
    // Every month in the range, oldest first (at most 24).
    const start = fromIso(range.from);
    const end = fromIso(range.to);
    const count = Math.min(24, (end.y * 12 + end.m) - (start.y * 12 + start.m) + 1);
    const months = Array.from({ length: Math.max(1, count) }, (_, i) => {
      const m = monthStart(start.y, start.m, i);
      const from = toIso(m);
      const last = toIso(dayBefore(monthStart(m.y, m.m, 1)));
      return { from: i === 0 ? range.from : from, to: last > range.to ? range.to : last, key: from };
    });
    let totals: Cents[];
    if (!filtered) {
      // The P&L's own month totals: transfers and owner draws aren't spending.
      const { data, error } = await supabase.rpc("monthly_income_expense", { p_business_id: businessId, p_months: months.length, p_through: range.to });
      if (error) throw new Error(error.message);
      const byMonth = new Map(data.map((m) => [m.month.slice(0, 7), out ? Number(m.expense_cents) : Number(m.income_cents)]));
      totals = months.map((m) => byMonth.get(m.key.slice(0, 7)) ?? 0);
    } else {
      const res = await Promise.all(months.map((m) => supabase.rpc("summarize_transactions", args(businessId, q, m)).single()));
      for (const r of res) if (r.error) throw new Error(r.error.message);
      totals = res.map((r) => (out ? Math.abs(Number(r.data!.total_out)) : Number(r.data!.total_in)));
    }
    rows = months.map((m, i) => ({
      key: m.key, label: monthLabel(m.key), cents: totals[i],
      refine: { ...q, group: undefined, rank: undefined, range: { from: m.from, to: m.to, label: monthLabel(m.key, true) } },
      refineLabel: `${q.vendor?.label ?? q.category?.name ?? (out ? "spending" : "income")} in ${monthLabel(m.key, true)}`,
    }));
    const active = rows.filter((r) => r.cents !== 0);
    if (!active.length) return { ...base, empty: true, headline: `Nothing ${verb}${who} ${whenText(range)}`, details: [], breakdown: { kind: "month", rows } };
    const top = active.reduce((a, b) => (b.cents > a.cents ? b : a));
    top.top = true;
    // An average for display: one division of SQL totals, rounded to whole cents.
    const average = Math.round(sumCents(active.map((r) => r.cents)) / active.length);
    const headline = q.rank
      ? `${monthLabel(top.key, true).split(" ")[0]} was the biggest month: ${formatCents(top.cents)} ${verb}${who}`
      : `${formatCents(average)} a month${who} on average`;
    const details = [
      q.rank ? `${formatCents(average)} a month on average` : `highest was ${monthLabel(top.key, true)} at ${formatCents(top.cents)}`,
      `${plural(active.length, "month")} with activity ${whenText(range)}`,
    ];
    return { ...base, headline, details, breakdown: { kind: "month", rows: [...rows].reverse() } };
  }

  if (q.group === "category") {
    const [stats, options] = await Promise.all([
      supabase.rpc("category_period_stats", { p_business_id: businessId, p_from: range.from, p_to: range.to }),
      getPickerOptions(businessId),
    ]);
    if (stats.error) throw new Error(stats.error.message);
    const names = new Map(options.map((o) => [o.id, o.name]));
    const wanted = stats.data.filter((r) => r.grp === (out ? "expense" : "income") || (out && r.grp === "uncategorized"));
    rows = wanted.filter((r) => Number(r.total_cents) > 0).sort((a, b) => Number(b.total_cents) - Number(a.total_cents)).slice(0, 10).map((r) => {
      const name = r.category_account_id ? names.get(r.category_account_id) ?? "Category" : "Uncategorized";
      return {
        key: r.category_account_id ?? "uncategorized", label: name, detail: plural(Number(r.tx_count), "transaction"), cents: Number(r.total_cents),
        refine: r.category_account_id
          ? { measure: q.measure, category: { id: r.category_account_id, name }, range }
          : { measure: q.measure, uncategorized: true, range },
        refineLabel: `${name} ${whenText(range)}`,
      };
    });
  } else {
    const { data, error } = await supabase.rpc("vendor_totals", {
      p_business_id: businessId, p_from: range.from, p_to: range.to, p_direction: out ? "out" : "in", p_limit: 10,
    });
    if (error) throw new Error(error.message);
    rows = data.map((v) => {
      const known = findMerchant(v.label ?? "") ?? findMerchant(v.vendor_normalized);
      const label = known?.name ?? (/\d{3,}/.test(v.label ?? "") ? titleCase(v.vendor_normalized) : v.label || titleCase(v.vendor_normalized));
      return {
        key: v.vendor_normalized, label, detail: plural(Number(v.tx_count), out ? "payment" : "deposit"), cents: Number(v.total_cents),
        refine: { measure: q.measure, vendor: { key: v.vendor_normalized, label }, range },
        refineLabel: `${label} ${whenText(range)}`,
      };
    });
  }
  if (!rows.length) return { ...base, empty: true, headline: `Nothing ${verb} ${whenText(range)}`, details: [], breakdown: { kind: q.group!, rows } };
  rows[0].top = true;
  const total = sumCents(rows.map((r) => r.cents));
  const share = total > 0 ? Math.round((rows[0].cents / total) * 100) : 0;
  const headline = q.group === "vendor"
    ? (out ? `You pay ${rows[0].label} the most: ${formatCents(rows[0].cents)} ${whenText(range)}` : `${rows[0].label} brings in the most: ${formatCents(rows[0].cents)} ${whenText(range)}`)
    : `${rows[0].label} is the biggest ${out ? "expense" : "source of income"}: ${formatCents(rows[0].cents)} ${whenText(range)}`;
  return { ...base, headline, details: [`${share}% of the top ${rows.length} shown`], breakdown: { kind: q.group!, rows } };
}

export async function answerAsk(businessId: string, q: AskQuery): Promise<AskAnswer> {
  if (q.group) return answerBreakdown((await getBusiness(businessId)).business.id, q);
  const { business } = await getBusiness(businessId);
  const supabase = await getSupabase();
  const today = todayIso();

  // The three months ending with the question's range (or this month), for the bars.
  const end = fromIso(q.range?.to ?? today);
  const months = [-2, -1, 0].map((o) => {
    const s = monthStart(end.y, end.m, o);
    return { from: toIso(s), to: toIso(dayBefore(monthStart(s.y, s.m, 1))), label: new Date(Date.UTC(s.y, s.m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) };
  });
  const prev = q.range ? previousRange(q.range.from, q.range.to) : null;
  const wantBars = q.measure !== "list" && !!(q.vendor || q.category || q.search);
  const yearFrom = toIso({ y: fromIso(today).y, m: 1, d: 1 });

  const [summary, prevSummary, rows, bars, vendorAll, categoryYear, accounts] = await Promise.all([
    supabase.rpc("summarize_transactions", args(business.id, q)).single(),
    prev ? supabase.rpc("summarize_transactions", args(business.id, q, prev)).single() : Promise.resolve(null),
    (() => {
      const b = supabase.rpc("search_transactions", args(business.id, q))
        .select("id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id, category_account_id, category_source, created_at");
      const signed = q.measure === "spend" ? b.lt("amount_cents", 0) : q.measure === "earn" ? b.gt("amount_cents", 0) : b;
      return signed.order("date", { ascending: false }).order("created_at", { ascending: false }).range(0, ROWS - 1);
    })(),
    wantBars ? Promise.all(months.map((m) => supabase.rpc("summarize_transactions", args(business.id, q, m)).single())) : Promise.resolve([]),
    q.vendor ? supabase.rpc("summarize_transactions", { p_business_id: business.id, p_query: q.vendor.key }).single() : Promise.resolve(null),
    q.category ? supabase.rpc("summarize_transactions", { p_business_id: business.id, p_category_ids: [q.category.id], p_from: yearFrom, p_to: today }).single() : Promise.resolve(null),
    moneyAccountNames(business.id),
  ]);
  for (const r of [summary, prevSummary, rows, vendorAll, categoryYear, ...bars]) if (r && "error" in r && r.error) throw new Error(r.error.message);
  const s = summary.data!;
  const rowData = (rows.data ?? []) as {
    id: string; date: string; description_raw: string; description_clean: string | null; vendor_normalized: string | null;
    amount_cents: number; money_account_id: string; category_account_id: string | null; category_source: string | null;
  }[];

  const total = measured(q, s);
  const count = q.measure === "spend" ? Number(s.count_out) : q.measure === "earn" ? Number(s.count_in) : Number(s.count);
  const who = q.vendor ? q.vendor.label : q.category ? q.category.name : q.search ? `“${q.search}”` : null;
  const when = whenText(q.range);

  let headline: string;
  if (q.uncategorized && q.measure === "list") {
    headline = `${plural(count, "transaction")} still need${count === 1 ? "s" : ""} a category`;
  } else if (q.measure === "spend") {
    headline = `${formatCents(total)} ${q.vendor ? `at ${who}` : who ? `on ${who}` : "spent"} ${when}`;
  } else if (q.measure === "earn") {
    headline = `${formatCents(total)} ${q.vendor ? `from ${who}` : who ? `in ${who}` : "came in"} ${when}`;
  } else {
    headline = `${plural(count, "transaction")}${who ? ` for ${who}` : ""} ${when === "all time" ? "" : when}`.trim();
  }

  const details: string[] = [];
  const accountIds = new Set(rowData.map((r) => r.money_account_id));
  const one = accountIds.size === 1 ? accounts.find((a) => a.id === [...accountIds][0]) : undefined;
  if (q.measure !== "list") details.push(`${plural(count, q.measure === "spend" ? "purchase" : "deposit")}${one ? ` on ${one.name}` : ""}`);
  if (prev && prevSummary?.data) {
    const before = measured(q, prevSummary.data);
    const span = q.range!.label.startsWith("the last ") ? `${q.range!.label.replace(/^the last /, "the ")} before` : prev.months === 1 ? "the month before" : "the period before";
    if (before > 0 && q.measure !== "list") {
      const change = Math.round(((total - before) / before) * 100);
      details.push(change === 0 ? `same as ${span}` : `${change > 0 ? "up" : "down"} ${Math.abs(change)}% on ${span}`);
    } else if (before === 0 && total > 0 && q.measure !== "list") {
      details.push(`nothing ${span}`);
    }
  }
  const uncategorized = Number(s.uncategorized);
  if (uncategorized > 0 && !q.uncategorized) details.push(`${uncategorized} still uncategorized`);

  const suggestions = await getSuggestionsFor(business.id, rowData.filter((r) => !r.category_account_id).map((r) => r.id));
  const acceptable = Object.values(suggestions).filter((x) => !x.flags.length && x.confidence >= 0.5);

  // A rule is worth offering when a vendor's rows agree on one category (filed, or suggested).
  let rule: AskAnswer["rule"];
  if (q.vendor) {
    const tally = new Map<string, number>();
    for (const r of rowData) {
      const cat = r.category_account_id ?? suggestions[r.id]?.category_account_id;
      if (cat) tally.set(cat, (tally.get(cat) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= Math.max(2, Math.ceil(rowData.length * 0.8))) {
      const { data: cat } = await supabase.from("accounts").select("name").eq("business_id", business.id).eq("id", top[0]).maybeSingle();
      const name = cat?.name;
      if (name) rule = { vendorKey: q.vendor.key, vendorLabel: q.vendor.label, categoryId: top[0], categoryName: name };
    }
  }

  const query = toQueryString(filtersFor(q));
  const lock = business.lock_date;
  return {
    headline, details, count,
    bars: (bars as { data: { total_in: number; total_out: number; net: number } | null }[]).map((b, i) => ({
      label: months[i].label, cents: b.data ? measured(q, b.data) : 0,
    })),
    rows: rowData.map((r) => ({
      id: r.id, date: r.date, description: r.description_clean || r.description_raw, vendor: r.vendor_normalized,
      amount: Number(r.amount_cents), money_account_id: r.money_account_id, category_account_id: r.category_account_id,
      category_source: r.category_source, locked: !!lock && r.date <= lock,
    })),
    suggestions,
    href: `/b/${business.id}/transactions${query}`,
    exportHref: `/b/${business.id}/transactions/export${query}`,
    vendor: q.vendor && vendorAll?.data ? (() => {
      const n = Number(vendorAll.data.count_out) || Number(vendorAll.data.count);
      const spent = Math.abs(Number(vendorAll.data.total_out)) || Math.abs(Number(vendorAll.data.net));
      // An average for display: one division of an SQL total, rounded to whole cents.
      return { label: q.vendor.label, count: Number(vendorAll.data.count), avg: n ? Math.round(spent / n) : 0 };
    })() : undefined,
    category: q.category && categoryYear?.data ? {
      id: q.category.id, name: q.category.name, type: "",
      yearCents: Math.abs(Number(categoryYear.data.net)),
    } : undefined,
    rule,
    accept: { ids: acceptable.map((x) => x.id), categoryNames: [...new Set(acceptable.map((x) => x.category_name))] },
    empty: Number(s.count) === 0,
  };
}

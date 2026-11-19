// Reads what someone typed in the Ask bar into a structured question the app can answer
// with its own SQL (no AI): who (vendor, category, account), when (a date range), how much
// (amount limits), and what they want (money spent, money earned, a list, or an action).
// Pure: no I/O, no clock (pass `today`). The AI fallback produces the same AskQuery shape.
import { tryParseCents, type Cents } from "@/lib/money";
import { dayBefore, fromIso, monthStart, toIso } from "@/lib/transactions/filters";

export interface AskVendor { key: string; label: string; count: number }
export interface AskCategory { id: string; name: string; type: string }
export interface AskAccount { id: string; name: string; last4: string | null }
export interface AskVocabulary { vendors: AskVendor[]; categories: AskCategory[]; accounts: AskAccount[] }

export const ASK_ACTIONS = ["import", "add", "report", "review", "request", "rules", "accounts", "categories", "settings", "transactions"] as const;
export type AskAction = (typeof ASK_ACTIONS)[number];

export interface AskRange { from: string; to: string; label: string }

export interface AskQuery {
  /** What the answer leads with: money out, money in, or just the matching rows. */
  measure: "spend" | "earn" | "list";
  vendor?: { key: string; label: string };
  category?: { id: string; name: string };
  account?: { id: string; name: string };
  range?: AskRange;
  min?: Cents;
  max?: Cents;
  uncategorized?: boolean;
  /** Words left over after everything else is read: searched in descriptions. */
  search?: string;
  /** Totals broken down by month, category or vendor instead of a list of rows. */
  group?: "month" | "category" | "vendor";
  /** "largest", "top", "most": lead with the biggest. */
  rank?: boolean;
}

export interface AskParse {
  query: AskQuery;
  /** A page or tool the words ask for ("import", "p&l", "rules"). */
  action?: AskAction;
  /** True when the words read as a question we can answer (not just a stray word). */
  understood: boolean;
}

const STOP = new Set(("a an the at on in to for of from by with and or my our we us i me you your it its is was were be "
  + "been how much many what whats which who when where did do does have has had spent spend spending paid pay paying "
  + "cost costs earn earned made make income revenue received deposits show me list find all any every total "
  + "transactions transaction purchases purchase charges charge payments payment money lately recently last this "
  + "past since over under above below more less than between greater at least most about our so far year month "
  + "week weeks months days day quarter whats what's biggest largest top highest each per every by much").split(" "));

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const words = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&$.,\- ]+/g, " ").replace(/\s+/g, " ").trim();
const monthIndex = (name: string) => MONTHS.findIndex((m) => m.startsWith(name.slice(0, 3))) + 1;
const longDate = (iso: string) => {
  const d = fromIso(iso);
  return new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const monthName = (y: number, m: number, withYear: boolean) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", withYear ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "long", timeZone: "UTC" });
const addDays = (iso: string, days: number) => {
  const d = fromIso(iso);
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d) + days * 86_400_000);
  return toIso({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
};
const monthRange = (y: number, m: number, months = 1) => {
  const s = monthStart(y, m);
  return { from: toIso(s), to: toIso(dayBefore(monthStart(s.y, s.m, months))) };
};

/** The date range the words name, and the words with it removed. */
export function readRange(text: string, today: string): { range?: AskRange; rest: string } {
  const t = fromIso(today);
  const tries: [RegExp, (m: RegExpMatchArray) => AskRange | undefined][] = [
    [/\b(?:in the |over the |for the )?(?:last|past|previous) (\d{1,3}) (day|week|month)s?\b/, (m) => {
      const n = Number(m[1]);
      const days = m[2] === "day" ? n : m[2] === "week" ? n * 7 : n * 30;
      return { from: addDays(today, -(days - 1)), to: today, label: `the last ${n} ${m[2]}${n === 1 ? "" : "s"}` };
    }],
    [/\b(?:lately|recently|these days)\b/, () => ({ from: addDays(today, -89), to: today, label: "the last 90 days" })],
    [/\b(?:this|current) month\b|\bmonth to date\b|\bmtd\b/, () => ({ ...monthRange(t.y, t.m), to: today, label: monthName(t.y, t.m, false) })],
    [/\blast month\b/, () => { const s = monthStart(t.y, t.m, -1); return { ...monthRange(s.y, s.m), label: monthName(s.y, s.m, s.y !== t.y) }; }],
    [/\b(?:this|current) quarter\b|\bqtd\b/, () => {
      const q = Math.floor((t.m - 1) / 3);
      return { from: monthRange(t.y, q * 3 + 1).from, to: today, label: `Q${q + 1} ${t.y}` };
    }],
    [/\blast quarter\b/, () => {
      const q = Math.floor((t.m - 1) / 3) - 1;
      const y = q < 0 ? t.y - 1 : t.y;
      const qq = (q + 4) % 4;
      return { ...monthRange(y, qq * 3 + 1, 3), label: `Q${qq + 1} ${y}` };
    }],
    [/\bq([1-4])(?:\s*(?:of\s*)?(20\d\d))?\b/, (m) => {
      const q = Number(m[1]);
      let y = m[2] ? Number(m[2]) : t.y;
      if (!m[2] && (q - 1) * 3 + 1 > t.m) y -= 1;
      const r = monthRange(y, (q - 1) * 3 + 1, 3);
      return { ...r, to: r.to > today ? today : r.to, label: `Q${q} ${y}` };
    }],
    [/\b(?:this year|year to date|ytd|so far this year)\b/, () => ({ from: toIso({ y: t.y, m: 1, d: 1 }), to: today, label: `${t.y} so far` })],
    [/\blast year\b/, () => ({ from: toIso({ y: t.y - 1, m: 1, d: 1 }), to: toIso({ y: t.y - 1, m: 12, d: 31 }), label: String(t.y - 1) })],
    [new RegExp(`\\bsince ${MONTH_RE}(?:\\s+(20\\d\\d))?\\b`), (m) => {
      const mm = monthIndex(m[1]);
      let y = m[2] ? Number(m[2]) : t.y;
      if (!m[2] && mm > t.m) y -= 1;
      return { from: toIso({ y, m: mm, d: 1 }), to: today, label: `since ${monthName(y, mm, y !== t.y)}` };
    }],
    [new RegExp(`\\b${MONTH_RE}(?:\\s+(20\\d\\d))?\\b`), (m) => {
      // "may" is also a word: only read it as a month next to a year or "in".
      if (m[1] === "may" && !m[2] && !/\b(?:in|for|during) may\b/.test(text)) return undefined;
      const mm = monthIndex(m[1]);
      let y = m[2] ? Number(m[2]) : t.y;
      if (!m[2] && mm > t.m) y -= 1;
      const r = monthRange(y, mm);
      return { ...r, to: r.to > today ? today : r.to, label: monthName(y, mm, y !== t.y) };
    }],
    [/\b(?:in |for |during )?(20\d\d)\b/, (m) => {
      const y = Number(m[1]);
      if (y > t.y) return undefined;
      return { from: toIso({ y, m: 1, d: 1 }), to: y === t.y ? today : toIso({ y, m: 12, d: 31 }), label: y === t.y ? `${y} so far` : String(y) };
    }],
  ];
  for (const [re, make] of tries) {
    const m = text.match(re);
    if (!m) continue;
    const range = make(m);
    if (range) return { range, rest: text.replace(m[0], " ") };
  }
  return { rest: text };
}

/** "over $500", "under 50", "between 100 and 250". */
export function readAmounts(text: string): { min?: Cents; max?: Cents; rest: string } {
  const amt = "\\$?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)(k)?";
  const cents = (n: string, k?: string) => {
    const c = tryParseCents(n.replace(/,/g, ""));
    if (c === null) return undefined;
    return Math.abs(k ? c * 1000 : c) as Cents;
  };
  let rest = text;
  let min: Cents | undefined;
  let max: Cents | undefined;
  const between = rest.match(new RegExp(`\\bbetween ${amt} and ${amt}`));
  if (between) {
    min = cents(between[1], between[2]);
    max = cents(between[3], between[4]);
    rest = rest.replace(between[0], " ");
  }
  const over = rest.match(new RegExp(`(?:\\bover|\\babove|\\bmore than|\\bgreater than|\\bat least|>=?)\\s*${amt}`));
  if (over) { min = cents(over[1], over[2]); rest = rest.replace(over[0], " "); }
  const under = rest.match(new RegExp(`(?:\\bunder|\\bbelow|\\bless than|\\bat most|<=?)\\s*${amt}`));
  if (under) { max = cents(under[1], under[2]); rest = rest.replace(under[0], " "); }
  return { min, max, rest };
}

const ACTION_WORDS: [RegExp, AskAction][] = [
  [/^(?:import|upload)\b/, "import"],
  [/^(?:add|new)(?: a)?(?: transaction| expense| deposit)?$/, "add"],
  [/^(?:report|reports|p&l|p and l|profit and loss|profit & loss|balance sheet|run (?:a )?report)\b/, "report"],
  [/^(?:review|suggestions|to review|needs review)$/, "review"],
  [/^(?:request|send link|request statements?)\b/, "request"],
  [/^rules?$/, "rules"],
  [/^(?:accounts|money accounts|banks?)$/, "accounts"],
  [/^categories$/, "categories"],
  [/^settings$/, "settings"],
  [/^transactions$/, "transactions"],
];

/** The longest vocabulary entry whose words all appear, in order, in the text. */
function longestMatch<T>(text: string, items: T[], names: (t: T) => string[]): T | undefined {
  let best: { item: T; len: number } | undefined;
  const padded = ` ${text} `;
  for (const item of items) {
    for (const raw of names(item)) {
      const name = words(raw);
      if (name.length < 3) continue;
      if (padded.includes(` ${name} `) && (!best || name.length > best.len)) best = { item, len: name.length };
    }
  }
  return best?.item;
}

/** Read typed words into a question. */
export function parseAsk(input: string, vocab: AskVocabulary, today: string): AskParse {
  const raw = words(input);
  const action = ACTION_WORDS.find(([re]) => re.test(raw))?.[1];
  const query: AskQuery = { measure: "list" };

  // Amounts first, so "over 2000" isn't read as the year 2000.
  const amounts = readAmounts(raw);
  if (amounts.min !== undefined) query.min = amounts.min;
  if (amounts.max !== undefined) query.max = amounts.max;
  const dates = readRange(amounts.rest, today);
  if (dates.range) query.range = dates.range;
  let text = ` ${dates.rest.replace(/\s+/g, " ").trim()} `;

  // Breakdowns: "each month", "largest", "top vendors", "who do we pay the most".
  const MONTHLY = /\b(?:each|every|per|a|by) month\b|\bmonthly\b|\bmonth (?:by|over|to) month\b|\bmonths\b/g;
  const RANK = /\b(?:largest|biggest|top|most|highest|main|major|greatest)\b/g;
  const VENDORS = /\b(?:vendors?|merchants?|payees?|suppliers?|companies|who)\b/g;
  const CATEGORIES = /\b(?:categor(?:y|ies)|expenses|costs|bills)\b/g;
  const monthly = MONTHLY.test(text);
  const rank = RANK.test(text);
  const byVendor = VENDORS.test(text);
  const byCategory = CATEGORIES.test(text);
  if (monthly) query.group = "month";
  else if (byVendor && (rank || /\bwho\b/.test(text))) query.group = "vendor";
  else if (rank && (byCategory || /\b(?:spen[dt]|spending|expense|cost)\b/.test(text))) query.group = "category";
  if (rank) query.rank = true;
  if (query.group) text = text.replace(MONTHLY, " ").replace(RANK, " ").replace(VENDORS, " ").replace(CATEGORIES, " ");

  if (/\b(?:uncategori[sz]ed|need(?:s)? a category|not categori[sz]ed|unfiled|to review|needs review)\b/.test(text)) {
    query.uncategorized = true;
    text = text.replace(/\b(?:uncategori[sz]ed|need(?:s)? a category|not categori[sz]ed|unfiled|to review|needs review)\b/g, " ");
  }
  if (/\b(?:spen[dt]|spending|paid|pay|paying|cost|costs|bought|expenses?|charged)\b/.test(text)) query.measure = "spend";
  else if (/\b(?:earn(?:ed)?|made|income|revenue|deposits?|received|sales|brought in|came in|got paid)\b/.test(text)) query.measure = "earn";

  const account = longestMatch(text, vocab.accounts, (a) => [a.name, ...(a.last4 ? [a.last4] : [])]);
  if (account) {
    query.account = { id: account.id, name: account.name };
    for (const n of [account.name, account.last4 ?? ""]) if (n) text = text.replace(words(n), " ");
  }
  const vendor = longestMatch(text, vocab.vendors, (v) => [v.label, v.key]);
  // A category by its full name, or by its first word when only one category starts that way
  // ("software" for Software & Subscriptions).
  const category = longestMatch(text, vocab.categories, (c) => [c.name]) ?? (() => {
    const lead = (c: AskCategory) => words(c.name).split(" ")[0];
    const hits = vocab.categories.filter((c) => lead(c).length >= 4 && text.includes(` ${lead(c)} `));
    return hits.length === 1 ? hits[0] : undefined;
  })();
  // A name that is both (a vendor called "Insurance Co" vs. the Insurance category): the longer match wins.
  const vLen = vendor ? Math.max(...[vendor.label, vendor.key].map((n) => (text.includes(` ${words(n)} `) ? words(n).length : 0))) : 0;
  const cLen = category ? words(category.name).length : 0;
  if (vendor && vLen >= cLen) {
    query.vendor = { key: vendor.key, label: vendor.label };
    text = text.replace(` ${words(vendor.label)} `, " ").replace(` ${words(vendor.key)} `, " ");
  } else if (category) {
    query.category = { id: category.id, name: category.name };
    text = text.replace(` ${words(category.name)} `, " ").replace(` ${words(category.name).split(" ")[0]} `, " ");
    if (category.type === "income" && query.measure === "list") query.measure = "earn";
    if (category.type === "expense" && query.measure === "list") query.measure = "spend";
  }

  const leftover = text.split(" ").filter((w) => w && !STOP.has(w) && !/^[$.,\-&]+$/.test(w));
  if (!query.vendor && !query.category && leftover.length && !action) query.search = leftover.join(" ");

  if (query.group) {
    if (query.measure === "list") query.measure = "spend";
    // A breakdown with no dates covers the last 12 months.
    if (!query.range) {
      const t = fromIso(today);
      query.range = { from: toIso(monthStart(t.y, t.m, -11)), to: today, label: "the last 12 months" };
    }
    // Words like "spend" or "our" don't make a description search.
    if (query.search && !query.vendor && !query.category) delete query.search;
  }

  const understood = !!(query.group || query.vendor || query.category || query.account || query.range || query.uncategorized
    || query.min !== undefined || query.max !== undefined || query.search);
  return { query, action, understood };
}

export type AskSuggestion =
  | { kind: "vendor"; vendor: AskVendor }
  | { kind: "category"; category: AskCategory }
  | { kind: "account"; account: AskAccount };

/**
 * What the last words typed could be finishing ("restaurant d" → Restaurant Depot), for the
 * live list under the bar. Matches at word starts, most-used vendors first.
 */
export function suggestEntities(input: string, vocab: AskVocabulary, limit = 6): AskSuggestion[] {
  const tokens = words(input).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const startsWord = (name: string, frag: string) => {
    const n = words(name);
    return n.startsWith(frag) || n.includes(` ${frag}`);
  };
  for (let take = Math.min(4, tokens.length); take >= 1; take--) {
    const frag = tokens.slice(-take).join(" ");
    if (frag.length < 2 || (take === 1 && STOP.has(frag))) continue;
    const out: AskSuggestion[] = [
      ...vocab.vendors.filter((v) => startsWord(v.label, frag) || startsWord(v.key, frag))
        .sort((a, b) => b.count - a.count).map((vendor) => ({ kind: "vendor" as const, vendor })),
      ...vocab.categories.filter((c) => startsWord(c.name, frag)).map((category) => ({ kind: "category" as const, category })),
      ...vocab.accounts.filter((a) => startsWord(a.name, frag) || (a.last4 ?? "") === frag).map((account) => ({ kind: "account" as const, account })),
    ];
    if (out.length) return out.slice(0, limit);
  }
  return [];
}

/** "Oct 1 – Oct 23, 2026", for an answer's small print. */
export function rangeText(r: AskRange) {
  return `${longDate(r.from)} – ${longDate(r.to)}`;
}

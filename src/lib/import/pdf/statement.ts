// Turning the text of a bank or card statement PDF into a table of transactions, without
// knowing the bank. Pure: input is positioned text (as pdf.js gives it), output is rows of text
// in the same shape a CSV gives, so the mapping, verify and commit steps are shared.
//
// How the layout is worked out:
//  1. Text is grouped into lines by height on the page, left to right.
//  2. A transaction is a line that starts with a date (10/3, 10/03/26, Oct 3, 3 Oct 2026,
//     2026-10-03) and ends in one or more amounts, with some words in between.
//  3. Amount columns are found by where amounts line up (their right edges), across all
//     pages, and named from the column headings above them (deposits / withdrawals / balance).
//  4. A statement with one amount column split into sections ("Deposits and additions",
//     "Electronic withdrawals"...) takes each row's sign from its section.
//  5. Wrapped descriptions (a line under a transaction, starting where descriptions start,
//     with no date and no amount) join the transaction above.
//  6. The year comes from the statement period; a December row in a January statement is the
//     year before.

export type TextItem = { str: string; x: number; y: number; width: number; height?: number };

export type StatementAccount = {
  /** "Wells Fargo Everyday Checking ··0001" */
  label: string;
  last4: string | null;
  /** The statement's own beginning and ending balance for this account, as plain signed text. */
  opening: string | null;
  closing: string | null;
};

export type StatementTable = {
  headers: string[];
  rows: string[][];
  /** The accounts a combined statement covers; each row's account is rowAccount[i]. */
  accounts: StatementAccount[];
  rowAccount: number[];
  /** Lines worth showing above the table: the statement period and balances found. */
  notes: string[];
};

type Token = { text: string; x: number; x2: number };
type Line = { page: number; y: number; h: number; tokens: Token[]; text: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthOf = (s: string) => {
  const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  return i < 0 ? null : i + 1;
};

// ---------------------------------------------------------------------------
// Lines and tokens
// ---------------------------------------------------------------------------

/** Words of an item, each with an x range estimated from its share of the item's characters. */
function wordsOf(item: TextItem): Token[] {
  const s = item.str;
  if (!s.trim()) return [];
  const per = item.width / Math.max(1, s.length);
  const out: Token[] = [];
  for (const m of s.matchAll(/\S+/g)) {
    const x = item.x + m.index! * per;
    out.push({ text: m[0], x, x2: x + m[0].length * per });
  }
  return out;
}

export function toLines(pages: TextItem[][]): Line[] {
  const lines: Line[] = [];
  pages.forEach((items, page) => {
    const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: { y: number; h: number; items: TextItem[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const tokens = cur.items.sort((a, b) => a.x - b.x).flatMap(wordsOf);
      lines.push({ page, y: cur.y, h: cur.h, tokens, text: tokens.map((t) => t.text).join(" ") });
    };
    for (const it of sorted) {
      const h = it.height || 8;
      if (cur && Math.abs(cur.y - it.y) <= Math.max(2, Math.min(cur.h, h) * 0.45)) cur.items.push(it);
      else { flush(); cur = { y: it.y, h, items: [it] }; }
    }
    flush();
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Dates and amounts
// ---------------------------------------------------------------------------

const AMOUNT = /^(?:[-−–]\s?)?\(?[-−]?\$?\s?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:-|CR|DR|cr|dr)?$/;
export const isAmount = (s: string) => AMOUNT.test(s);

/** "1,234.56" "(12.00)" "12.00-" "-$5.00" "45.00CR" -> signed plain text "-12.00". */
export function amountText(s: string): string {
  const neg = /^[-−–(]|\)$|-$|DR$/i.test(s.replace(/\$/g, "")) && !/CR$/i.test(s);
  const digits = s.replace(/[^\d.]/g, "");
  return neg ? `-${digits}` : digits;
}

type DatePart = { month: number; day: number; year: number | null; used: number };

/** A date at the start of the tokens, and how many tokens it took. */
export function leadingDate(tokens: Token[]): DatePart | null {
  const t = tokens.map((k) => k.text.replace(/,$/, ""));
  if (!t.length) return null;
  let m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(t[0]);
  if (m) {
    const month = Number(m[1]), day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null;
    return { month, day, year: y, used: 1 };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t[0]);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), used: 1 };
  // "Oct 3" / "Oct 3 2026" / "October 03, 2026"
  const mon = monthOf(t[0]);
  if (mon && /^[A-Za-z]{3,9}\.?$/.test(t[0]) && t[1] && /^\d{1,2}$/.test(t[1])) {
    const year = t[2] && /^\d{4}$/.test(t[2]) ? Number(t[2]) : null;
    return { month: mon, day: Number(t[1]), year, used: year ? 3 : 2 };
  }
  // "3 Oct" / "03 Oct 2026" / "03-Oct-26"
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(t[0]);
  if (m && monthOf(m[2])) return { day: Number(m[1]), month: monthOf(m[2])!, year: Number(m[3].length === 2 ? `20${m[3]}` : m[3]), used: 1 };
  if (/^\d{1,2}$/.test(t[0]) && t[1] && monthOf(t[1]) && /^[A-Za-z]{3,9}\.?$/.test(t[1])) {
    const year = t[2] && /^\d{4}$/.test(t[2]) ? Number(t[2]) : null;
    return { day: Number(t[0]), month: monthOf(t[1])!, year, used: year ? 3 : 2 };
  }
  return null;
}

const FULL_DATES = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{1,2}),? (\d{4})\b/gi,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

/** Every full date written in the text, as [year, month, day]. */
function fullDates(text: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of text.matchAll(FULL_DATES[0])) out.push([Number(m[3]), monthOf(m[1])!, Number(m[2])]);
  for (const m of text.matchAll(FULL_DATES[1])) out.push([Number(m[3]), Number(m[1]), Number(m[2])]);
  for (const m of text.matchAll(FULL_DATES[2])) out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  return out.filter(([, mo, d]) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31);
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

type ColumnKind = "in" | "out" | "balance" | "amount";
const KIND_LABEL: Record<ColumnKind, string> = { in: "Deposits", out: "Withdrawals", balance: "Balance", amount: "Amount" };

function headingKind(word: string): ColumnKind | null {
  const w = word.toLowerCase();
  if (/balance/.test(w)) return "balance";
  if (/deposit|credit|addition/.test(w)) return "in";
  if (/withdraw|debit|subtraction|charge|payment|purchase/.test(w)) return "out";
  if (/amount/.test(w)) return "amount";
  return null;
}

/** Which way a section heading points ("Deposits and additions" -> in). Both or neither -> null. */
function sectionKind(text: string): "in" | "out" | null {
  const t = text.toLowerCase();
  const inn = /deposit|credits?\b|addition|payments? and (other )?credits/.test(t);
  const out = /withdrawal|debits?\b|checks? paid|\bfees?\b|purchases?|subtraction|charges|payments? (made|sent)|card transactions|atm/.test(t);
  if (inn && out) return /payments? and (other )?credits/.test(t) && !/withdrawal|debit/.test(t) ? "in" : null;
  return inn ? "in" : out ? "out" : null;
}

const STOP = /\b(total|totals|subtotal|ending balance|beginning balance|daily balance|page \d+|continued)\b/i;

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

type Txn = { line: Line; date: DatePart; desc: string; amounts: Token[]; section: "in" | "out" | null; account: number };

const ACCOUNT_NUMBER = /account\s*(?:number|no\.?|#)\s*:?\s*((?:[\dXx*•.-]\s?){4,})/i;
const ACCOUNT_TITLE = /checking|savings|money market|credit card|visa|mastercard|amex|business|card account|line of credit/i;

export function readStatement(pages: TextItem[][], today = new Date()): StatementTable {
  const lines = toLines(pages);

  // Statement period: the latest full date on the first pages is the end.
  const head = lines.filter((l) => l.page <= 1).map((l) => l.text).join("\n");
  const dates = fullDates(head).sort((a, b) => iso(...a).localeCompare(iso(...b)));
  const end = dates.length ? dates[dates.length - 1] : [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()] as [number, number, number];

  // Accounts (combined statements list several) and transactions, with their section.
  const accounts: (StatementAccount & { firstLine: number })[] = [];
  let account = -1;
  const txns: Txn[] = [];
  let section: "in" | "out" | null = null;
  let lastTxn: Txn | null = null;
  for (const [li, line] of lines.entries()) {
    const num = ACCOUNT_NUMBER.exec(line.text);
    if (num) {
      const digits = num[1].replace(/\D/g, "");
      const last4 = digits.length >= 4 ? digits.slice(-4) : null;
      const known = accounts.findIndex((a) => a.last4 && a.last4 === last4);
      if (known >= 0) account = known;
      else {
        // The account's name: the nearest line above on the page that reads like one.
        const title = lines.slice(Math.max(0, li - 6), li).reverse()
          .find((l) => l.page === line.page && ACCOUNT_TITLE.test(l.text) && !/\d{5,}/.test(l.text) && l.text.length < 60);
        accounts.push({ label: `${title?.text ?? "Account"}${last4 ? ` ··${last4}` : ""}`, last4, opening: null, closing: null, firstLine: li });
        account = accounts.length - 1;
      }
      section = null;
    }
    const a = accounts[account];
    if (a) {
      if (a.opening === null && /(beginning|opening|previous|starting) balance/i.test(line.text)) a.opening = lastAmount(line);
      if (a.closing === null && /(ending|closing|new) balance\b(?! last)/i.test(line.text) && !/daily/i.test(line.text)) a.closing = lastAmount(line);
    }
    const date = leadingDate(line.tokens);
    const rest = date ? line.tokens.slice(date.used) : line.tokens;
    // A second date right after the first (transaction + posting date on cards): skip it.
    const afterDates = date && leadingDate(rest) ? rest.slice(leadingDate(rest)!.used) : rest;
    let k = afterDates.length;
    while (k > 0 && isAmount(afterDates[k - 1].text)) k--;
    const amounts = afterDates.slice(k);
    const words = afterDates.slice(0, k);
    const desc = words.map((w) => w.text).join(" ");

    if (date && amounts.length && /[A-Za-z]/.test(desc)) {
      lastTxn = { line, date, desc: desc.replace(/(^|\s)[<>*]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim(), amounts, section, account: Math.max(0, account) };
      txns.push(lastTxn);
      continue;
    }
    if (!date && !amounts.length) {
      const kind = sectionKind(line.text);
      // A heading: short, no digits-heavy content. It ends the previous transaction's run.
      if (kind && line.tokens.length <= 8) { section = kind; lastTxn = null; continue; }
      // A wrapped description: directly under the last transaction, starting where its words start.
      if (lastTxn && lastTxn.line.page === line.page && !STOP.test(line.text)) {
        const gap = lastTxn.line.y - line.y;
        const descX = lastTxn.amounts.length ? (wordsStart(lastTxn) ?? 0) : 0;
        if (gap > 0 && gap < lastTxn.line.h * 2.6 && line.tokens[0].x >= descX - 4 && line.tokens[0].x2 < lastTxn.amounts[0].x) {
          lastTxn.desc += ` ${line.text}`;
          lastTxn.line = { ...lastTxn.line, y: line.y };
          continue;
        }
      }
      if (STOP.test(line.text)) lastTxn = null;
      continue;
    }
    lastTxn = null;
  }

  function wordsStart(t: Txn): number | null {
    const toks = t.line.tokens.slice(t.date.used);
    const second = leadingDate(toks);
    const w = second ? toks.slice(second.used) : toks;
    return w.length ? w[0].x : null;
  }

  // Amount columns by right edge, across all rows.
  const edges = txns.flatMap((t) => t.amounts.map((a) => a.x2)).sort((a, b) => a - b);
  const centers: number[] = [];
  let group: number[] = [];
  for (const e of edges) {
    if (group.length && e - group[group.length - 1] > 14) { centers.push(median(group)); group = []; }
    group.push(e);
  }
  if (group.length) centers.push(median(group));
  // Columns used by fewer than 2% of rows are noise (a stray number at the end of a description).
  const counts = centers.map((c) => txns.filter((t) => t.amounts.some((a) => Math.abs(a.x2 - c) <= 14)).length);
  const cols = centers.filter((_, i) => counts[i] >= Math.max(1, Math.ceil(txns.length * 0.02)));

  // Name each column from heading words above the first rows (any page).
  // Heading lines: two or more column words and no amounts (not the legal small print).
  const VOCAB = /^(date|description|details|transaction|check|number|amount|deposits?|withdrawals?|credits?|debits?|additions|subtractions|subtra|ctions|balance|payments?|charges?|ending|daily|posted|posting|post|trans|reference|type|and|other|&)\W*$/i;
  const headingTokens = lines.filter((l) => !leadingDate(l.tokens) && !l.tokens.some((t) => isAmount(t.text))
    && ((n) => n >= 2 && n >= l.tokens.length * 0.6)(l.tokens.filter((t) => t.text.split("/").some((w) => VOCAB.test(w))).length))
    .flatMap((l) => l.tokens.map((t) => ({ ...t, kind: headingKind(t.text) })).filter((t) => t.kind));
  const kinds: ColumnKind[] = cols.map((c) => {
    const near = headingTokens.map((t) => ({ t, d: Math.min(Math.abs(t.x2 - c), Math.abs(t.x - c), t.x <= c && c <= t.x2 + 20 ? 0 : Infinity) }))
      .filter((n) => n.d < 70).sort((a, b) => a.d - b.d);
    return (near[0]?.t.kind as ColumnKind) ?? "amount";
  });
  // Unnamed columns: a rightmost column that runs as a balance is the balance.
  if (cols.length >= 2 && kinds[kinds.length - 1] === "amount" && looksLikeBalance(txns, cols)) kinds[kinds.length - 1] = "balance";
  // Two columns both read as the same kind: keep the first, number the rest.
  const labels = kinds.map((k, i) => {
    const same = kinds.filter((x, j) => x === k && j < i).length;
    return same ? `${KIND_LABEL[k]} ${same + 1}` : KIND_LABEL[k];
  });

  const signed = cols.length > 0 && !kinds.includes("in") && !kinds.includes("out");
  const useSections = signed && txns.some((t) => t.section);

  const headers = ["Date", "Description", ...labels];
  const rows = txns.map((t) => {
    const year = t.date.year ?? (t.date.month > end[1] + 1 || (t.date.month > end[1] && end[1] === 1) ? end[0] - 1 : end[0]);
    const cells = cols.map((c, i) => {
      const a = t.amounts.find((x) => Math.abs(x.x2 - c) <= 14);
      if (!a) return "";
      let v = amountText(a.text);
      if (useSections && kinds[i] === "amount" && t.section === "out" && !v.startsWith("-")) v = `-${v}`;
      return v;
    });
    return [iso(year, t.date.month, t.date.day), t.desc.trim(), ...cells];
  });

  // Statements that never name an account number still have one account.
  const used = [...new Set(txns.map((t) => t.account))].sort((a, b) => a - b);
  const list: StatementAccount[] = used.map((i) => {
    const a = accounts[i];
    return a ? { label: a.label, last4: a.last4, opening: a.opening, closing: a.closing }
      : { label: "Account", last4: null, opening: firstBalance(lines, /(beginning|opening|previous|starting) balance/i), closing: firstBalance(lines, /(ending|closing|new) balance/i) };
  });
  const rowAccount = txns.map((t) => used.indexOf(t.account));

  const start = dates.length ? iso(...dates[0]) : null;
  const notes = [start && start !== iso(...end) ? `Statement period: ${start} to ${iso(...end)}` : `Statement date: ${iso(...end)}`];
  return { headers, rows, accounts: list, rowAccount, notes };
}

function lastAmount(line: Line): string | null {
  const t = [...line.tokens].reverse().find((k) => isAmount(k.text));
  if (!t) return null;
  // "- 11,982.42": a sign printed as its own word.
  const i = line.tokens.indexOf(t);
  const signed = i > 0 && /^[-−–]$/.test(line.tokens[i - 1].text) ? `-${t.text}` : t.text;
  return amountText(signed);
}

function firstBalance(lines: Line[], phrase: RegExp): string | null {
  for (const l of lines) if (phrase.test(l.text) && !/daily/i.test(l.text)) { const a = lastAmount(l); if (a) return a; }
  return null;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Does the rightmost column move by the other amounts, row to row? (A running balance.) */
function looksLikeBalance(txns: Txn[], cols: number[]): boolean {
  const last = cols[cols.length - 1];
  const val = (t: Txn, c: number) => {
    const a = t.amounts.find((x) => Math.abs(x.x2 - c) <= 14);
    return a ? Math.round(Number(amountText(a.text)) * 100) : null;
  };
  let checks = 0, ok = 0, prev: number | null = null;
  for (const t of txns) {
    const bal = val(t, last);
    const amt = cols.slice(0, -1).map((c) => val(t, c)).find((v) => v !== null) ?? null;
    if (bal !== null && prev !== null && amt !== null) {
      checks++;
      if (Math.abs(prev + amt - bal) <= 1 || Math.abs(prev - amt - bal) <= 1) ok++;
    }
    if (bal !== null) prev = bal;
  }
  return checks >= 2 && ok / checks >= 0.6;
}

const BANKS = [
  "Wells Fargo", "Chase", "Bank of America", "Capital One", "Citibank", "Citi", "PNC", "Truist", "U.S. Bank", "US Bank",
  "TD Bank", "American Express", "Discover", "Navy Federal", "Ally", "Fifth Third", "Regions", "Huntington", "KeyBank",
  "Citizens", "Santander", "BMO", "Mercury", "Novo", "Bluevine", "First Citizens", "USAA", "Synchrony", "Barclays",
];

/** The bank's name if the statement's first page says it. */
export function bankName(pages: TextItem[][]): string | null {
  const text = (pages[0] ?? []).map((i) => i.str).join(" ");
  return BANKS.find((b) => new RegExp(`\\b${b.replace(/[.]/g, "\\.")}\\b`, "i").test(text)) ?? null;
}

const cents = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = /^(-)?(\d+)\.(\d{2})$/.exec(s);
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3])) : null;
};

/**
 * Did we read this statement cleanly? Every account needs its beginning and ending balance,
 * every row an amount, and the rows must carry the beginning balance to the ending one to the
 * cent (either sign convention: cards print what's owed). Anything less and we'd rather ask
 * for the CSV than import something slightly wrong.
 */
export function statementReconciles(t: StatementTable): { ok: boolean; reason?: string } {
  const col = (label: string) => t.headers.indexOf(label);
  const din = col("Deposits"), dout = col("Withdrawals"), amt = col("Amount");
  if (din < 0 && dout < 0 && amt < 0) return { ok: false, reason: "no amount column" };
  if (t.rows.length === 0) return { ok: false, reason: "no rows" };
  for (const [i, a] of t.accounts.entries()) {
    const open = cents(a.opening), close = cents(a.closing);
    if (open === null || close === null) return { ok: false, reason: `no balances for account ${i + 1}` };
    let net = 0;
    for (const [ri, r] of t.rows.entries()) {
      if (t.rowAccount[ri] !== i) continue;
      const vals = [din, dout, amt].map((c) => (c < 0 || !r[c] ? null : cents(r[c])));
      if (vals.every((v) => v === null)) return { ok: false, reason: "a row with no amount" };
      net += (vals[0] ?? 0) - Math.abs(vals[1] ?? 0) + (vals[2] ?? 0);
    }
    if (open + net !== close && open - net !== close) return { ok: false, reason: `account ${i + 1} does not add up` };
  }
  return { ok: true };
}

// Column mapping: which CSV column feeds which transaction field, suggested from the header
// names, and applied to rows. Columns are referenced by index (names can repeat); a saved
// mapping is tied to the exact header layout by its signature.
import { tryParseCents, type Cents } from "@/lib/money";
import { detectDateFormat, parseDate, type DateFormat } from "./dates";

export type AmountMode = "signed" | "split";
export type SignConvention = "positive_in" | "positive_out";
export const SIGN_LABEL: Record<SignConvention, string> = {
  positive_in: "Positive amounts are money in",
  positive_out: "Positive amounts are money out",
};

export interface Mapping {
  date: number | null;
  dateFormat: DateFormat | null;
  amountMode: AmountMode;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  signConvention: SignConvention;
  description: number | null;
  /** Optional second column joined onto the description. */
  description2: number | null;
  category: number | null;
  reference: number | null;
  memo: number | null;
  balance: number | null;
}
export type ColumnField = "date" | "amount" | "debit" | "credit" | "description" | "description2" | "category" | "reference" | "memo" | "balance";
export type GuessedField = ColumnField | "dateFormat" | "amountMode" | "signConvention";

export const EMPTY_MAPPING: Mapping = {
  date: null, dateFormat: null, amountMode: "signed", amount: null, debit: null, credit: null,
  signConvention: "positive_in", description: null, description2: null, category: null, reference: null, memo: null, balance: null,
};

// Header names each field answers to, best first. Matched on a normalized header.
const SYNONYMS: Record<Exclude<ColumnField, "description2">, string[]> = {
  date: ["transaction date", "trans date", "trans. date", "date", "posted date", "posting date", "post date", "value date", "booking date"],
  amount: ["amount", "transaction amount", "amt", "amount (usd)", "value"],
  debit: ["debit", "debits", "debit amount", "withdrawal", "withdrawals", "withdrawal amount", "money out", "paid out"],
  credit: ["credit", "credits", "credit amount", "deposit", "deposits", "deposit amount", "money in", "paid in"],
  description: ["description", "payee", "merchant", "name", "transaction description", "details", "narrative", "merchant name", "original description"],
  category: ["category"],
  reference: ["reference", "ref", "reference number", "check number", "check or slip #", "check #", "cheque number", "transaction id"],
  memo: ["memo", "notes", "note", "extended details", "extended description"],
  balance: ["balance", "running bal.", "running balance", "available balance", "running bal"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

function findColumn(headers: string[], names: string[], taken: Set<number>): number | null {
  const normalized = headers.map(norm);
  for (const name of names) {
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h === name);
    if (i >= 0) return i;
  }
  // Looser: header contains the word ("Posting Date" for "date").
  for (const name of names) {
    const i = normalized.findIndex((h, idx) => !taken.has(idx) && h.split(/[^a-z#]+/).includes(name));
    if (i >= 0) return i;
  }
  return null;
}

/**
 * Best-guess mapping from the header names and a sample of rows. Cards and loans default
 * to "positive amounts are money out" (statements show charges as positive).
 */
export function suggestMapping(headers: string[], rows: string[][], accountKind?: string | null): { mapping: Mapping; guessed: GuessedField[] } {
  const m: Mapping = { ...EMPTY_MAPPING };
  const guessed = new Set<GuessedField>();
  const taken = new Set<number>();
  const take = (field: Exclude<ColumnField, "description2">) => {
    const i = findColumn(headers, SYNONYMS[field], taken);
    if (i !== null) { m[field] = i; taken.add(i); guessed.add(field); }
  };

  take("date");
  take("balance"); // before amount, so "Running Bal." never reads as an amount
  take("debit");
  take("credit");
  take("amount");
  if (m.amount === null && m.debit !== null && m.credit !== null) {
    m.amountMode = "split";
  } else {
    // A signed amount column wins; debit/credit guesses only matter in split mode.
    if (m.debit !== null) { taken.delete(m.debit); guessed.delete("debit"); m.debit = null; }
    if (m.credit !== null) { taken.delete(m.credit); guessed.delete("credit"); m.credit = null; }
  }
  guessed.add("amountMode");
  take("description");
  take("category");
  take("reference");
  take("memo");

  if (m.date !== null) {
    m.dateFormat = detectDateFormat(rows.map((r) => r[m.date!] ?? "")).format;
    if (m.dateFormat) guessed.add("dateFormat");
  }
  m.signConvention = accountKind === "credit_card" || accountKind === "loan" ? "positive_out" : "positive_in";
  guessed.add("signConvention");
  return { mapping: m, guessed: [...guessed] };
}

/** Required fields still missing, as messages. Empty when the mapping can be used. */
export function mappingProblems(m: Mapping): string[] {
  const out: string[] = [];
  if (m.date === null) out.push("Pick the date column.");
  if (m.date !== null && !m.dateFormat) out.push("Pick the date format.");
  if (m.amountMode === "signed" && m.amount === null) out.push("Pick the amount column.");
  if (m.amountMode === "split" && (m.debit === null || m.credit === null)) out.push("Pick both the debit and credit columns.");
  if (m.description === null) out.push("Pick the description column.");
  return out;
}

/** Which cell a problem is about, so the verify screen can highlight it. */
export type ProblemField = "date" | "amount" | "debit" | "credit" | "description";
export interface RowProblem { field: ProblemField; message: string }

export interface MappedRow {
  /** 0-based index among the file's data rows. */
  index: number;
  date: string | null;
  amount_cents: Cents | null;
  description: string;
  category: string | null;
  reference: string | null;
  memo: string | null;
  balance_cents: Cents | null;
  problems: RowProblem[];
}

const cell = (r: string[], i: number | null) => (i === null ? "" : (r[i] ?? "").trim());

/** Apply a mapping to data rows: dates to YYYY-MM-DD, amounts to signed cents (in > 0). */
export function applyMapping(rows: string[][], m: Mapping): MappedRow[] {
  return rows.map((r, index) => {
    const problems: RowProblem[] = [];
    const add = (field: ProblemField, message: string) => problems.push({ field, message });
    const rawDate = cell(r, m.date);
    const date = rawDate && m.dateFormat ? parseDate(rawDate, m.dateFormat) : null;
    if (!date) add("date", rawDate ? `Can't read the date "${rawDate}"` : "No date");

    let amount: Cents | null = null;
    if (m.amountMode === "signed") {
      const raw = cell(r, m.amount);
      const c = raw ? tryParseCents(raw) : null;
      if (c === null) add("amount", raw ? `Can't read the amount "${raw}"` : "No amount");
      else amount = m.signConvention === "positive_in" ? c : -c || 0;
    } else {
      const d = cell(r, m.debit);
      const c = cell(r, m.credit);
      const dc = d ? tryParseCents(d) : 0;
      const cc = c ? tryParseCents(c) : 0;
      if (dc === null) add("debit", `Can't read the debit "${d}"`);
      else if (cc === null) add("credit", `Can't read the credit "${c}"`);
      else if (dc && cc) { add("debit", "Both debit and credit are filled"); add("credit", "Both debit and credit are filled"); }
      else if (!d && !c) add("amount", "No amount");
      else amount = Math.abs(cc) - Math.abs(dc);
    }
    if (amount === 0) { add(m.amountMode === "signed" ? "amount" : "debit", "Amount is zero"); amount = null; }

    const description = [cell(r, m.description), cell(r, m.description2)].filter(Boolean).join(" · ");
    if (!description) add("description", "No description");
    const bal = cell(r, m.balance);
    return {
      index, date, amount_cents: amount, description,
      category: cell(r, m.category) || null,
      reference: cell(r, m.reference) || null,
      memo: cell(r, m.memo) || null,
      balance_cents: bal ? tryParseCents(bal) : null,
      problems,
    };
  });
}

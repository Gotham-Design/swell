// Money is integer cents everywhere: a JS number that is always a safe integer, and a
// bigint column in Postgres. Nothing here ever goes through a float: parsing works on
// the digit string, sums use BigInt, and formatting splits cents with integer math.

/** Integer cents. Positive = money in, negative = money out (at the money-account level). */
export type Cents = number;

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function isCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: unknown, what = "Amount"): asserts value is Cents {
  if (!isCents(value)) throw new MoneyError(`${what} must be a whole number of cents, got ${String(value)}`);
}

// ---------------------------------------------------------------------------
// Parsing user input
// ---------------------------------------------------------------------------

const SYMBOLS = ["$", "€", "£"];
const CODES = /^(usd|us\$)\s*|\s*(usd)$/i;
const DIGITS = /^(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$/;

/**
 * Parse what a person typed (or a CSV cell) into integer cents.
 *
 * Accepts: `1234.56`, `1,234.56`, `$1,234.56`, `-45`, `-$45`, `$-45`, `(45.00)`,
 * `($45.00)`, `.5`, `5.`, `USD 10`, `10 USD`, `€10`, `£10`, surrounding spaces.
 * Parentheses mean negative (accounting style).
 *
 * Rounds to the cent half away from zero: `10.005` → 1001, `-10.005` → -1001,
 * `10.0049` → 1000.
 *
 * Rejects: empty input, letters, more than one sign (`--5`, `(-5)`), unbalanced
 * parentheses, misplaced commas (`12,34`, `1,23,456`), more than one decimal point, and
 * amounts too large to hold exactly.
 */
export function parseCents(input: string): Cents {
  const original = input;
  let s = input.trim();
  if (!s) throw new MoneyError("Enter an amount.");

  let negative = false;
  const fail = () => new MoneyError(`"${original}" isn't an amount.`);

  if (s.startsWith("(") || s.endsWith(")")) {
    if (!(s.startsWith("(") && s.endsWith(")"))) throw fail();
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Sign and currency symbol may come in either order: -$45, $-45.
  let sawSymbol = false;
  let sawSign = negative;
  for (let i = 0; i < 2; i++) {
    if (s.startsWith("-") || s.startsWith("+")) {
      if (sawSign) throw fail();
      sawSign = true;
      negative = s[0] === "-";
      s = s.slice(1).trim();
    }
    const sym = SYMBOLS.find((x) => s.startsWith(x));
    if (sym && !sawSymbol) {
      sawSymbol = true;
      s = s.slice(sym.length).trim();
    }
  }
  if (!sawSymbol) {
    const code = s.match(CODES);
    if (code) s = s.replace(CODES, "").trim();
  }

  const m = s.match(DIGITS);
  if (!m || (!m[1] && !m[2])) throw fail();
  const whole = (m[1] ?? "0").replace(/,/g, "");
  const frac = m[2] ?? "";

  // cents = whole*100 + first two fraction digits, +1 if the third digit is 5 or more.
  let cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  if (frac.length > 2 && frac.charCodeAt(2) >= "5".charCodeAt(0)) cents += 1n;
  if (negative) cents = -cents;

  return fromBigInt(cents, original);
}

/** parseCents, but returns null instead of throwing (for live form validation). */
export function tryParseCents(input: string): Cents | null {
  try {
    return parseCents(input);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export interface FormatOptions {
  /** `minus` → -$45.00 (default), `parens` → ($45.00) for statements. */
  negative?: "minus" | "parens";
  /** Include the $ sign (default true). */
  symbol?: boolean;
  /** Prefix positive amounts with + (for showing changes). */
  signPositive?: boolean;
}

/** Format cents for display: 123456 → "$1,234.56", -4500 → "-$45.00". */
export function formatCents(cents: Cents, opts: FormatOptions = {}): string {
  assertCents(cents);
  const { negative = "minus", symbol = true, signPositive = false } = opts;
  const abs = Math.abs(cents);
  const dollars = String((abs - (abs % 100)) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `${symbol ? "$" : ""}${dollars}.${String(abs % 100).padStart(2, "0")}`;
  if (cents < 0) return negative === "parens" ? `(${body})` : `-${body}`;
  return signPositive && cents > 0 ? `+${body}` : body;
}

/** Cents as an editable input value: -123456 → "-1234.56" (no symbol, no commas). */
export function centsToInput(cents: Cents): string {
  return formatCents(cents, { symbol: false }).replace(/,/g, "");
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Sum cents exactly. Throws if any value isn't integer cents (a float slipped in) or the
 * total can't be held exactly.
 */
export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  let i = 0;
  for (const v of values) {
    assertCents(v, `Item ${i}`);
    total += BigInt(v);
    i++;
  }
  return fromBigInt(total, "total");
}

function fromBigInt(value: bigint, what: string): Cents {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${what === "total" ? "Total" : `"${what}"`} is too large.`);
  }
  // `|| 0` turns -0 into 0.
  return Number(value) || 0;
}

/**
 * Cents as a screen reader should say them: -4500 → "minus 45 dollars",
 * 123456 → "1,234 dollars and 56 cents", 1 → "1 cent". Use as an amount's aria-label.
 */
export function spokenCents(cents: Cents): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const dollars = (abs - (abs % 100)) / 100;
  const rest = abs % 100;
  const parts: string[] = [];
  if (dollars || !rest) parts.push(`${dollars.toLocaleString("en-US")} dollar${dollars === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} cent${rest === 1 ? "" : "s"}`);
  return `${cents < 0 ? "minus " : ""}${parts.join(" and ")}`;
}

import { describe, expect, it } from "vitest";
import { MoneyError, centsToInput, formatCents, parseCents, sumCents, tryParseCents } from "./money";

describe("parseCents", () => {
  it.each([
    ["0", 0],
    ["45", 4500],
    ["45.6", 4560],
    ["45.67", 4567],
    [".5", 50],
    ["5.", 500],
    ["0.01", 1],
    ["  12.30  ", 1230],
    ["+12", 1200],
  ])("plain numbers: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([
    ["-45", -4500],
    ["-0.01", -1],
    ["-.5", -50],
    ["- 45", -4500],
    ["-0", 0],
    ["-0.00", 0],
  ])("negatives: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseCents("-0"), 0)).toBe(true);
    expect(Object.is(parseCents("(0.00)"), 0)).toBe(true);
  });

  it.each([
    ["10.005", 1001],
    ["10.004", 1000],
    ["10.0049999", 1000],
    ["10.0050", 1001],
    ["10.995", 1100],
    ["0.005", 1],
    ["0.0049", 0],
    ["-10.005", -1001],
    ["-10.004", -1000],
    ["(10.005)", -1001],
    ["1,999.999", 200000],
  ])("rounds half away from zero: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([
    ["1,234", 123400],
    ["1,234.56", 123456],
    ["12,345,678.90", 1234567890],
    ["-1,234.56", -123456],
    ["$1,234.56", 123456],
  ])("thousands commas: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([
    ["(45.00)", -4500],
    ["(45)", -4500],
    ["( 45.00 )", -4500],
    ["($45.00)", -4500],
    ["(1,234.56)", -123456],
    ["(0.01)", -1],
  ])("parentheses mean negative: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([
    ["$45", 4500],
    ["$ 45.00", 4500],
    ["-$45.00", -4500],
    ["$-45.00", -4500],
    ["- $45", -4500],
    ["€12.50", 1250],
    ["£3", 300],
    ["USD 10", 1000],
    ["10 USD", 1000],
    ["usd10", 1000],
    ["US$10", 1000],
  ])("currency symbols and codes: %j → %d", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["12abc"],
    ["."],
    ["$"],
    ["-"],
    ["()"],
    ["1.2.3"],
    ["12,34"],
    ["1,23,456"],
    ["1234,567"],
    [",123"],
    ["--5"],
    ["+-5"],
    ["-+5"],
    ["(-45)"],
    ["-(45)"],
    ["(45"],
    ["45)"],
    ["$$45"],
    ["45-"],
    ["1 234"],
    ["1e3"],
    ["0x10"],
    ["Infinity"],
    ["NaN"],
  ])("rejects %j", (input) => {
    expect(() => parseCents(input)).toThrow(MoneyError);
    expect(tryParseCents(input)).toBeNull();
  });

  it("accepts the largest exact amount and rejects anything bigger", () => {
    expect(parseCents("90,071,992,547,409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseCents("-90071992547409.91")).toBe(Number.MIN_SAFE_INTEGER);
    expect(() => parseCents("90071992547409.92")).toThrow(/too large/);
    expect(() => parseCents("99999999999999999999")).toThrow(/too large/);
  });

  it("does not lose precision the way float parsing would", () => {
    // parseFloat("1.005") * 100 = 100.49999999999999 → rounds to 100. We get 101.
    expect(parseCents("1.005")).toBe(101);
    expect(parseCents("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996
    expect(parseCents("4.35")).toBe(435); // 4.35 * 100 = 434.99999999999994
  });
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [10, "$0.10"],
    [4500, "$45.00"],
    [123456, "$1,234.56"],
    [100000000, "$1,000,000.00"],
    [-1, "-$0.01"],
    [-4500, "-$45.00"],
    [-123456, "-$1,234.56"],
    [Number.MAX_SAFE_INTEGER, "$90,071,992,547,409.91"],
  ])("%d → %j", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("supports accounting parentheses", () => {
    expect(formatCents(-4500, { negative: "parens" })).toBe("($45.00)");
    expect(formatCents(4500, { negative: "parens" })).toBe("$45.00");
  });

  it("can drop the symbol and sign positives", () => {
    expect(formatCents(-123456, { symbol: false })).toBe("-1,234.56");
    expect(formatCents(4500, { signPositive: true })).toBe("+$45.00");
    expect(formatCents(0, { signPositive: true })).toBe("$0.00");
  });

  it.each([[1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]])("rejects non-cents %d", (v) => {
    expect(() => formatCents(v)).toThrow(MoneyError);
  });

  it("round-trips through parseCents", () => {
    for (const c of [0, 1, -1, 99, -99, 4500, -4500, 123456, -123456, 987654321]) {
      expect(parseCents(formatCents(c))).toBe(c);
      expect(parseCents(formatCents(c, { negative: "parens" }))).toBe(c);
      expect(parseCents(centsToInput(c))).toBe(c);
    }
  });
});

describe("centsToInput", () => {
  it("gives a plain editable number", () => {
    expect(centsToInput(123456)).toBe("1234.56");
    expect(centsToInput(-4500)).toBe("-45.00");
    expect(centsToInput(5)).toBe("0.05");
  });
});

describe("sumCents", () => {
  it("adds integers exactly", () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([4500, -1250, 1])).toBe(3251);
    expect(sumCents([10, 20])).toBe(30); // 0.1 + 0.2 problem doesn't exist in cents
  });

  it("balances to zero for a journal entry", () => {
    expect(sumCents([12345, -12345])).toBe(0);
    expect(Object.is(sumCents([-5, 5]), 0)).toBe(true);
  });

  it("accepts any iterable", () => {
    expect(sumCents(new Set([100, 200]))).toBe(300);
    expect(sumCents((function* () { yield 1; yield 2; })())).toBe(3);
  });

  it("is exact even when an intermediate total passes the safe-integer limit", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(sumCents([max, 1, -1])).toBe(max);
    expect(sumCents([max, max, -max])).toBe(max);
  });

  it("rejects totals that can't be held exactly", () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(/too large/);
  });

  it.each([[0.1], [1.5], [NaN], [Infinity]])("rejects non-integer value %d", (bad) => {
    expect(() => sumCents([100, bad])).toThrow(/Item 1/);
  });

  it("rejects non-number values at runtime", () => {
    expect(() => sumCents(["100" as unknown as number])).toThrow(MoneyError);
  });
});

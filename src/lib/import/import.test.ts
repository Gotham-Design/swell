import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectDateFormat, parseDate } from "./dates";
import { applyMapping, mappingProblems, suggestMapping } from "./mapping";
import { ImportFileError, analyzeFile, decodeBytes, findHeaderRow, headerSignature } from "./parse";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

/** The whole pipeline the browser runs: read, suggest, apply. */
function run(name: string, accountKind?: string) {
  const file = analyzeFile(fixture(name));
  const { mapping, guessed } = suggestMapping(file.headers, file.rows, accountKind);
  return { file, mapping, guessed, rows: applyMapping(file.rows, mapping) };
}
const pick = (rows: ReturnType<typeof applyMapping>) => rows.map((r) => [r.date, r.amount_cents, r.description]);

describe("five real-world bank formats map correctly", () => {
  it("1. signed amount (Chase checking)", () => {
    const { file, mapping, rows } = run("chase-checking.csv", "checking");
    expect(file).toMatchObject({ encoding: "utf-8", delimiter: ",", preamble: [] });
    expect(file.headers).toEqual(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]);
    expect(mapping).toMatchObject({ date: 1, dateFormat: "MM/DD/YYYY", amountMode: "signed", amount: 3, description: 2,
      balance: 5, reference: 6, signConvention: "positive_in" });
    expect(mappingProblems(mapping)).toEqual([]);
    expect(pick(rows)).toEqual([
      ["2026-10-14", -475, "SQ *BLUE BOTTLE COFFEE Oakland CA"],
      ["2026-10-13", 250000, "ACME CORP PAYROLL PPD ID: 1234567890"],
      ["2026-10-12", -15000, "CHECK 1042"],
      ["2026-10-10", -8999, "AMAZON.COM*2K4LM8Q90 AMZN.COM/BILLWA"],
      ["2026-10-09", -1200, "MONTHLY SERVICE FEE"],
    ]);
    expect(rows[2].reference).toBe("1042");
    expect(rows.every((r) => r.problems.length === 0)).toBe(true);
  });

  it("2. separate debit and credit columns (credit union, UTF-8 with BOM)", () => {
    const { file, mapping, rows } = run("credit-union-split.csv", "checking");
    expect(file.encoding).toBe("utf-8-bom");
    expect(file.headers[0]).toBe("Date"); // no BOM left on the first header
    expect(mapping).toMatchObject({ date: 0, dateFormat: "YYYY-MM-DD", amountMode: "split", amount: null, debit: 3, credit: 4,
      description: 1, memo: 2, balance: 5 });
    expect(pick(rows)).toEqual([
      ["2026-10-01", 100000, "OPENING DEPOSIT"],
      ["2026-10-02", -2350, "TST* JOES DINER 1234 SEATTLE WA"],
      ["2026-10-03", -125000, "ACH DEBIT GUSTO PAYROLL 123456"],
      ["2026-10-05", 200000, "ONLINE TRANSFER FROM SAVINGS"],
    ]);
    expect(rows[2].memo).toBe("Payroll run 41");
    expect(rows[2].balance_cents).toBe(-27350);
  });

  it("3. DD/MM dates (UK bank, semicolons, Windows-1252)", () => {
    const { file, mapping, rows } = run("uk-bank-ddmm.csv", "checking");
    expect(file).toMatchObject({ encoding: "windows-1252", delimiter: ";" });
    expect(mapping).toMatchObject({ date: 0, dateFormat: "DD/MM/YYYY", amount: 2, description: 1, balance: 3 });
    expect(detectDateFormat(file.rows.map((r) => r[0])).ambiguous).toBe(false);
    expect(pick(rows)).toEqual([
      ["2026-09-25", -320, "CAFÉ NERO LONDON"],
      ["2026-09-26", -4215, "TESCO STORES 3021"],
      ["2026-09-30", 210000, "SALARY ACME LTD"],
      ["2026-10-01", -95000, "RENT STANDING ORDER"],
    ]);
    expect(rows[0].balance_cents).toBe(149680);
  });

  it("4. preamble rows above the header (Bank of America)", () => {
    const { file, mapping, rows } = run("bofa-preamble.csv", "checking");
    expect(file.preamble).toHaveLength(5);
    expect(file.preamble[0]).toBe("Description Summary Amt.");
    expect(file.headers).toEqual(["Date", "Description", "Amount", "Running Bal."]);
    expect(mapping).toMatchObject({ date: 0, dateFormat: "MM/DD/YYYY", amount: 2, description: 1, balance: 3 });
    expect(pick(rows)).toEqual([
      ["2026-10-01", null, "Beginning balance as of 10/01/2026"],
      ["2026-10-03", 200000, "ZELLE PAYMENT FROM JANE DOE"],
      ["2026-10-05", -50000, "PURCHASE AUTHORIZED ON 10/04 TARGET T-1234 MINNEAPOLIS MN CARD 4321"],
    ]);
    // The bank's "beginning balance" line has no amount; verification (Prompt 7) flags it.
    expect(rows[0].problems).toEqual([{ field: "amount", message: "No amount" }]);
  });

  it("5. credit card with charges as positive amounts (Amex)", () => {
    const { mapping, guessed, rows } = run("amex-card.csv", "credit_card");
    expect(mapping).toMatchObject({ date: 0, amount: 4, description: 1, signConvention: "positive_out" });
    expect(guessed).toContain("signConvention");
    expect(pick(rows)).toEqual([
      ["2026-10-15", -2418, "UBER *TRIP HELP.UBER.COM CA"],
      ["2026-10-14", 50000, "AUTOPAY PAYMENT - THANK YOU"],
      ["2026-10-12", -5499, "ADOBE *CREATIVE CLOUD 408-536-6000 CA"],
      ["2026-10-11", 9500, "RETURN: ALLBIRDS"],
    ]);
  });

  it("the same Amex file in a checking account defaults the other way", () => {
    expect(run("amex-card.csv", "checking").mapping.signConvention).toBe("positive_in");
  });
});

describe("reading files", () => {
  it("decodes UTF-8, UTF-8 BOM and Windows-1252", () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ text: "A", encoding: "utf-8-bom" });
    expect(decodeBytes(new TextEncoder().encode("Café"))).toEqual({ text: "Café", encoding: "utf-8" });
    expect(decodeBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35]))).toEqual({ text: "Café £5", encoding: "windows-1252" });
  });

  it("detects tab-delimited files", () => {
    const f = analyzeFile(new TextEncoder().encode("Date\tDescription\tAmount\n2026-01-02\tCoffee\t-4.50\n2026-01-03\tTea\t-3.00\n"));
    expect(f.delimiter).toBe("\t");
    expect(f.headers).toEqual(["Date", "Description", "Amount"]);
  });

  it("finds the header without help from known names, skipping a preamble", () => {
    expect(findHeaderRow([["Account", "12345"], ["Exported", "2026-10-01"], ["When", "What", "How much"], ["2026-01-01", "x", "1.00"], ["2026-01-02", "y", "2.00"]])).toBe(2);
  });

  it("refuses empty, oversized and header-only files with a clear message", () => {
    expect(() => analyzeFile(new Uint8Array())).toThrow(ImportFileError);
    expect(() => analyzeFile(new Uint8Array(10 * 1024 * 1024 + 1))).toThrow(/10 MB/);
    expect(() => analyzeFile(new TextEncoder().encode("Date,Description,Amount\n"))).toThrow(/no transactions under it/);
    expect(() => analyzeFile(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toThrow(/doesn't look like a CSV or Excel file/);
  });

  it("refuses more than 50,000 rows", () => {
    const body = "Date,Description,Amount\n" + "2026-01-01,x,1\n".repeat(50_001);
    expect(() => analyzeFile(new TextEncoder().encode(body))).toThrow(/50,000/);
  });

  it("gives equal layouts equal signatures", () => {
    expect(headerSignature([" Date", "Description ", "AMOUNT"])).toBe(headerSignature(["date", "description", "amount"]));
    expect(headerSignature(["Date", "Amount"])).not.toBe(headerSignature(["Amount", "Date"]));
  });
});

describe("dates", () => {
  it("flags ambiguity when every day value is 12 or less", () => {
    const d = detectDateFormat(["01/02/2026", "03/04/2026", "12/11/2026"]);
    expect(d).toMatchObject({ format: "MM/DD/YYYY", ambiguous: true });
    expect(d.candidates).toEqual(expect.arrayContaining(["MM/DD/YYYY", "DD/MM/YYYY"]));
    expect(detectDateFormat(["01/02/2026", "03/13/2026"])).toMatchObject({ format: "MM/DD/YYYY", ambiguous: false });
    expect(detectDateFormat(["13/02/2026", "03/04/2026"])).toMatchObject({ format: "DD/MM/YYYY", ambiguous: false });
  });

  it("isn't thrown off by a stray bad date, but needs a majority", () => {
    expect(detectDateFormat(["10/31/2026", "13/45/2026", "11/02/2026"]).format).toBe("MM/DD/YYYY");
    expect(detectDateFormat(["10/31/2026", "nonsense", "garbage"]).format).toBeNull();
  });

  it.each([
    ["10/31/2026", "MM/DD/YYYY", "2026-10-31"],
    ["31/10/2026", "DD/MM/YYYY", "2026-10-31"],
    ["10/31/26", "MM/DD/YY", "2026-10-31"],
    ["31.10.2026", "DD.MM.YYYY", "2026-10-31"],
    ["2026/10/31", "YYYY/MM/DD", "2026-10-31"],
    ["31-Oct-2026", "DD-MMM-YYYY", "2026-10-31"],
    ["31 October 2026", "DD-MMM-YYYY", "2026-10-31"],
    ["Oct 31, 2026", "MMM D, YYYY", "2026-10-31"],
    ["2026-10-31 14:05:00", "YYYY-MM-DD", "2026-10-31"],
    ["10/31/2026 2:05 PM", "MM/DD/YYYY", "2026-10-31"],
  ] as const)("%s as %s", (v, f, expected) => {
    expect(parseDate(v, f)).toBe(expected);
  });

  it("rejects impossible dates", () => {
    expect(parseDate("02/30/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("13/13/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("Foo 3, 2026", "MMM D, YYYY")).toBeNull();
  });
});

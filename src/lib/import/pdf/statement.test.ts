import { describe, expect, it } from "vitest";
import { amountText, bankName, isAmount, readStatement, statementReconciles, type TextItem } from "./statement";

// A page as positioned text: each line is [y, ...[x, text]]. Width is 5pt per character, so a
// right-aligned amount ending at R starts at R - 5 * length.
type Cell = [number, string];
const W = 5;
const page = (...lines: [number, ...Cell[]][]): TextItem[] =>
  lines.flatMap(([y, ...cells]) => cells.map(([x, str]) => ({ str, x, y, width: str.length * W, height: 8 })));
/** Right-align text so it ends at `right`. */
const r = (right: number, str: string): Cell => [right - str.length * W, str];

describe("Wells Fargo-style statement (combined, split deposit/withdrawal columns)", () => {
  const p1 = page(
    [750, [36, "Combined Statement of Accounts"]],
    [738, [36, "September 24, 2026"], [200, "Page 1 of 2"]],
    [432, [36, "Everyday Checking"]],
    [408, [356, "Account number: 5550001110001"]],
    [392, [65, "Beginning balance on 8/26"], r(327, "$1,000.00")],
    [354, [65, "Ending balance on 9/24"], r(327, "$2,371.50")],
    [245, [36, "Transaction history"]],
    [225, [124, "Check"], r(434, "Deposits/"), r(502, "Withdrawals/"), [525, "Ending daily"]],
    [215, [63, "Date"], [117, "Number"], [150, "Description"], r(434, "Additions"), r(503, "Subtractions"), r(566, "balance")],
    [206, [62, "8/26"], [150, "Recurring Payment authorized on 08/25 Bark Technologies,"], r(503, "70.38")],
    [197, [150, "Bark.US NC S100000000000001 Card 1111"]],
    [188, [62, "8/26"], [150, "Online Transfer From Acme Studio Ref #Ib0Ab"], r(434, "1,500.00"), r(566, "2,429.62")],
    [179, [62, "9/2"], [139, "<"], [150, "ACH Debit Rocket Money"], r(503, "11.00")],
    [160, [62, "9/24"], [150, "Purchase authorized on 09/23 Food Lion"], r(503, "47.12"), r(566, "2,371.50")],
    [140, [62, "Totals"], r(434, "$1,500.00"), r(503, "$128.50")],
    [120, [61, "The Ending Daily Balance does not reflect any pending withdrawals or holds on deposited funds that may have been posted"]],
  );
  const p2 = page(
    [738, [36, "September 24, 2026"], [200, "Page 2 of 2"]],
    [680, [36, "Way2Save Savings"]],
    [656, [356, "Account number: 5550002220002"]],
    [641, [65, "Beginning balance on 8/26"], r(326, "$500.00")],
    [602, [65, "Ending balance on 9/24"], r(328, "$501.14")],
    [437, r(428, "Deposits/"), r(497, "Withdrawals/Subtra"), [522, "Ending daily"]],
    [428, [62, "Date"], [101, "Description"], r(428, "Additions"), r(498, "ctions"), r(563, "balance")],
    [418, [61, "8/26"], [101, "Save As You Go Transfer Credit"], r(429, "1.00"), r(562, "501.00")],
    [409, [61, "9/24"], [101, "Interest Payment"], r(429, "0.14"), r(562, "501.14")],
  );
  const t = readStatement([p1, p2]);

  it("finds the columns by position and names them from the headings", () => {
    expect(t.headers).toEqual(["Date", "Description", "Deposits", "Withdrawals", "Balance"]);
  });
  it("reads each row, joins wrapped descriptions and drops stray marks", () => {
    const checking = t.rows.filter((_, i) => t.rowAccount[i] === 0);
    expect(checking).toEqual([
      ["2026-08-26", "Recurring Payment authorized on 08/25 Bark Technologies, Bark.US NC S100000000000001 Card 1111", "", "70.38", ""],
      ["2026-08-26", "Online Transfer From Acme Studio Ref #Ib0Ab", "1500.00", "", "2429.62"],
      ["2026-09-02", "ACH Debit Rocket Money", "", "11.00", ""],
      ["2026-09-24", "Purchase authorized on 09/23 Food Lion", "", "47.12", "2371.50"],
    ]);
  });
  it("splits a combined statement by account, with each account's balances", () => {
    expect(t.accounts).toEqual([
      { label: "Everyday Checking ··0001", last4: "0001", opening: "1000.00", closing: "2371.50" },
      { label: "Way2Save Savings ··0002", last4: "0002", opening: "500.00", closing: "501.14" },
    ]);
    expect(t.rowAccount).toEqual([0, 0, 0, 0, 1, 1]);
  });
});

describe("Sectioned statement (one amount column; sign from the section)", () => {
  const t = readStatement([page(
    [760, [40, "Statement period: September 01, 2026 through September 30, 2026"]],
    [700, [40, "DEPOSITS AND ADDITIONS"]],
    [690, [40, "DATE"], [100, "DESCRIPTION"], r(560, "AMOUNT")],
    [680, [40, "09/03"], [100, "Square Inc Deposit"], r(560, "$2,273.55")],
    [670, [40, "Total Deposits and Additions"], r(560, "$2,273.55")],
    [640, [40, "ELECTRONIC WITHDRAWALS"]],
    [630, [40, "DATE"], [100, "DESCRIPTION"], r(560, "AMOUNT")],
    [620, [40, "09/05"], [100, "Gusto Payroll"], r(560, "$3,600.00")],
    [610, [40, "09/09"], [100, "Refund adjustment"], r(560, "-$12.00")],
  )]);
  it("signs withdrawals negative and keeps printed signs", () => {
    expect(t.headers).toEqual(["Date", "Description", "Amount"]);
    expect(t.rows).toEqual([
      ["2026-09-03", "Square Inc Deposit", "2273.55"],
      ["2026-09-05", "Gusto Payroll", "-3600.00"],
      ["2026-09-09", "Refund adjustment", "-12.00"],
    ]);
  });
});

describe("Credit card statement crossing New Year", () => {
  const t = readStatement([page(
    [760, [40, "Opening/Closing Date 12/15/26 - 01/14/27"], [300, "January 14, 2027"]],
    [700, [40, "Trans Date"], [100, "Post Date"], [160, "Description"], r(560, "Amount")],
    [690, [40, "Dec 28"], [100, "Dec 29"], [160, "AMAZON MKTPL*5Q5Z2"], r(560, "55.20")],
    [680, [40, "Jan 03"], [100, "Jan 03"], [160, "PAYMENT THANK YOU"], r(560, "-500.00")],
  )]);
  it("puts December rows in the year before and skips the posting date", () => {
    expect(t.rows).toEqual([
      ["2026-12-28", "AMAZON MKTPL*5Q5Z2", "55.20"],
      ["2027-01-03", "PAYMENT THANK YOU", "-500.00"],
    ]);
  });
});

describe("amounts", () => {
  it("recognises the ways banks print money", () => {
    for (const s of ["1,234.56", "$5.00", "(12.00)", "12.00-", "-$5.00", "45.00CR", "0.14"]) expect(isAmount(s)).toBe(true);
    for (const s of ["1234", "08/25", "#0101", "S100000000000001", "2026"]) expect(isAmount(s)).toBe(false);
  });
  it("writes them as plain signed text", () => {
    expect(amountText("$1,234.56")).toBe("1234.56");
    expect(amountText("(12.00)")).toBe("-12.00");
    expect(amountText("12.00-")).toBe("-12.00");
    expect(amountText("45.00CR")).toBe("45.00");
  });
});

describe("only clean reads are imported", () => {
  const base = (closing: string) => readStatement([page(
    [760, [40, "Wells Fargo Business Checking"], [300, "October 31, 2026"]],
    [740, [40, "Account number: 5550001110001"]],
    [730, [40, "Beginning balance on 10/1"], r(300, "$100.00")],
    [720, [40, "Ending balance on 10/31"], r(300, closing)],
    [700, [40, "Date"], [100, "Description"], r(434, "Deposits"), r(503, "Withdrawals")],
    [690, [40, "10/3"], [100, "Square Deposit"], r(434, "50.00")],
    [680, [40, "10/9"], [100, "Gusto Payroll"], r(503, "30.00")],
  )]);
  it("passes when the rows carry the beginning balance to the ending one", () => {
    expect(statementReconciles(base("$120.00"))).toEqual({ ok: true });
  });
  it("fails when a row is missing or misread", () => {
    expect(statementReconciles(base("$125.00")).ok).toBe(false);
  });
  it("fails without the statement's balances", () => {
    const t = base("$120.00");
    expect(statementReconciles({ ...t, accounts: t.accounts.map((a) => ({ ...a, closing: null })) }).ok).toBe(false);
  });
  it("names the bank for the message", () => {
    expect(bankName([page([760, [40, "Wells Fargo Business Checking"]])])).toBe("Wells Fargo");
    expect(bankName([page([760, [40, "Some Credit Union"]])])).toBe(null);
  });
});

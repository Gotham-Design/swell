import { describe, expect, it } from "vitest";
import { categoryCreateSchema, isOwedKind, moneyAccountCreateSchema } from "./accounts";

describe("moneyAccountCreateSchema", () => {
  const base = { name: "Operating", kind: "checking", last4: "", opening_balance: "", opening_date: "" };

  it("treats a blank opening balance as zero, with no date needed", () => {
    expect(moneyAccountCreateSchema.parse(base)).toEqual({
      name: "Operating", kind: "checking", last4: null, opening_balance: 0, opening_date: null,
    });
  });

  it("parses opening balances as integer cents", () => {
    const r = moneyAccountCreateSchema.parse({ ...base, opening_balance: "$12,345.67", opening_date: "2026-01-01" });
    expect(r.opening_balance).toBe(1234567);
    expect(moneyAccountCreateSchema.parse({ ...base, opening_balance: "(45.00)", opening_date: "2026-01-01" }).opening_balance).toBe(-4500);
  });

  it("needs a date when there is a balance", () => {
    const r = moneyAccountCreateSchema.safeParse({ ...base, opening_balance: "100" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["opening_date"]);
  });

  it.each([
    [{ opening_balance: "abc", opening_date: "2026-01-01" }],
    [{ last4: "12a4" }],
    [{ last4: "12345" }],
    [{ kind: "brokerage" }],
    [{ name: " " }],
  ])("rejects %j", (patch) => {
    expect(moneyAccountCreateSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe("categoryCreateSchema", () => {
  it("turns blanks into null", () => {
    expect(categoryCreateSchema.parse({ name: " Coworking ", type: "expense", parent_id: "", description: "" }))
      .toEqual({ name: "Coworking", type: "expense", parent_id: null, description: null, tax_line_id: null });
  });
  it("rejects unknown types and bad parent ids", () => {
    expect(categoryCreateSchema.safeParse({ name: "X", type: "revenue", parent_id: "", description: "" }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: "X", type: "expense", parent_id: "nope", description: "" }).success).toBe(false);
  });
});

describe("isOwedKind", () => {
  it("is true for cards and loans only", () => {
    expect(["checking", "savings", "cash", "credit_card", "loan"].map(isOwedKind)).toEqual([false, false, false, true, true]);
  });
});

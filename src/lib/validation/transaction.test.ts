import { describe, expect, it } from "vitest";
import { fromPosting, toPosting, transactionSchema } from "./transaction";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const base = { mode: "out", date: "2026-05-01", money_account_id: A, to_account_id: "", amount: "45.99",
  description: " Lunch ", category_account_id: C, memo: "", reference: "" };

describe("transactionSchema", () => {
  it("parses money out as a negative posting", () => {
    const v = transactionSchema.parse(base);
    expect(toPosting(v)).toEqual({ date: "2026-05-01", money_account_id: A, amount_cents: -4599,
      category_account_id: C, description_raw: "Lunch", memo: null, reference: null });
  });

  it("accepts a form without the fields its mode doesn't show", () => {
    const { to_account_id, memo, reference, ...rest } = base;
    void to_account_id; void memo; void reference;
    expect(toPosting(transactionSchema.parse(rest))).toMatchObject({ amount_cents: -4599, memo: null, reference: null });
  });

  it("parses money in as positive, with $ and commas", () => {
    expect(toPosting(transactionSchema.parse({ ...base, mode: "in", amount: "$1,250.00" })).amount_cents).toBe(125000);
  });

  it("turns a transfer into one posting on the from account, categorized to the to account", () => {
    const p = toPosting(transactionSchema.parse({ ...base, mode: "transfer", to_account_id: B, amount: "500" }));
    expect(p).toMatchObject({ money_account_id: A, amount_cents: -50000, category_account_id: B });
  });

  it.each([
    [{ amount: "0" }, "amount"],
    [{ amount: "-5" }, "amount"],
    [{ amount: "abc" }, "amount"],
    [{ description: "  " }, "description"],
    [{ date: "2026-13-01" }, "date"],
    [{ money_account_id: "" }, "money_account_id"],
    [{ mode: "transfer", to_account_id: "" }, "to_account_id"],
    [{ mode: "transfer", to_account_id: A }, "to_account_id"],
    [{ reference: "x".repeat(101) }, "reference"],
  ])("rejects %j", (patch, field) => {
    const r = transactionSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });
});

describe("fromPosting", () => {
  const money = new Set([A, B]);
  it("round-trips out, in and transfer", () => {
    for (const input of [base, { ...base, mode: "in" }, { ...base, mode: "transfer", to_account_id: B, category_account_id: "" }]) {
      const posting = toPosting(transactionSchema.parse(input));
      const form = fromPosting(posting, money);
      expect(form.mode).toBe(input.mode);
      expect(form.amount_cents).toBe(4599);
    }
  });
  it("shows an incoming transfer as from the other account", () => {
    const f = fromPosting({ date: "2026-05-01", money_account_id: A, amount_cents: 1000, category_account_id: B,
      description_raw: "From savings", memo: null, reference: null }, money);
    expect(f).toMatchObject({ mode: "transfer", money_account_id: B, to_account_id: A, amount_cents: 1000 });
  });
});

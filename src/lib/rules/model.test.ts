import { describe, expect, it } from "vitest";
import {
  EMPTY_RULE, OPERATORS_FOR, conditionProblem, defaultValue, describeActions, describeConditions, regexProblem, ruleProblem,
  type Condition, type RuleDraft,
} from "./model";

const names = { chk: "Ops Checking", office: "Office Supplies" };

describe("plain words", () => {
  it("summarizes conditions the way people say them", () => {
    expect(describeConditions({ match_mode: "all", conditions: [
      { field: "description_clean", operator: "contains", value: "AMZN" },
      { field: "amount", operator: "lt", value: 5000 },
    ] })).toBe("Description contains AMZN and amount under $50.00");
    expect(describeConditions({ match_mode: "any", conditions: [
      { field: "vendor_normalized", operator: "in", value: ["uber", "lyft"] },
      { field: "direction", operator: "equals", value: "out" },
      { field: "money_account_id", operator: "equals", value: "chk" },
    ] }, names)).toBe("Vendor is one of “uber”, “lyft” or money out or account is Ops Checking");
    expect(describeConditions({ match_mode: "all", conditions: [
      { field: "amount", operator: "between", value: [1000, 2500] },
      { field: "date", operator: "lt", value: "2026-01-01" },
      { field: "source", operator: "equals", value: "import" },
      { field: "description_raw", operator: "regex", value: "^SQ \\*" },
    ] })).toBe("Amount between $10.00 and $25.00 and date before 2026-01-01 and imported and bank description matches pattern /^SQ \\*/");
  });
  it("summarizes actions", () => {
    expect(describeActions([
      { action: "set_category", account_id: "office" }, { action: "append_memo", value: { text: "#amazon" } }, { action: "skip_ai" },
    ], names)).toBe("Category: Office Supplies · Add “#amazon” to memo · Don't suggest a category");
  });
});

describe("validation", () => {
  it("mirrors the database's checks", () => {
    const ok: Condition[] = [
      { field: "description_clean", operator: "contains", value: "amzn" },
      { field: "amount", operator: "between", value: [100, 5000] },
      { field: "direction", operator: "equals", value: "in" },
      { field: "money_account_id", operator: "in", value: ["11111111-1111-4111-8111-111111111111"] },
      { field: "date", operator: "between", value: ["2026-01-01", "2026-03-31"] },
      { field: "source", operator: "in", value: ["manual", "api"] },
    ];
    for (const c of ok) expect(conditionProblem(c)).toBeNull();
    expect(conditionProblem({ field: "amount", operator: "contains", value: 1 })).toMatch(/can't use/);
    expect(conditionProblem({ field: "description_clean", operator: "contains", value: "  " })).toMatch(/text/);
    expect(conditionProblem({ field: "amount", operator: "between", value: [5000, 100] })).toMatch(/larger/);
    expect(conditionProblem({ field: "amount", operator: "lt", value: 49.5 })).toMatch(/amount/);
    expect(conditionProblem({ field: "date", operator: "gt", value: "May 1" })).toMatch(/date/);
    expect(conditionProblem({ field: "vendor_normalized", operator: "in", value: [] })).toMatch(/at least one/);
  });
  it("rejects invalid and slow regexes", () => {
    expect(regexProblem("amzn(")).toMatch(/not a valid/);
    expect(regexProblem("(a+)+$")).toMatch(/slow/);
    expect(regexProblem("(\\w+)\\1")).toMatch(/slow/);
    expect(regexProblem("x".repeat(201))).toMatch(/200/);
    expect(regexProblem("^amzn mktp us\\*[0-9a-z]+")).toBeNull();
  });
  it("whole rules", () => {
    expect(ruleProblem({ ...EMPTY_RULE, name: "" })).toMatch(/name/);
    expect(ruleProblem({ ...EMPTY_RULE, name: "x" })).toMatch(/text/);
    const good: RuleDraft = { ...EMPTY_RULE, name: "Amazon", conditions: [{ field: "vendor_normalized", operator: "equals", value: "amazon" }],
      actions: [{ action: "set_category", account_id: "office" }] };
    expect(ruleProblem(good)).toBeNull();
    expect(ruleProblem({ ...good, actions: [{ action: "set_category", account_id: "a" }, { action: "mark_transfer_to_account", account_id: "b" }] }))
      .toMatch(/one category/);
    expect(ruleProblem({ ...good, actions: [{ action: "append_memo", value: { text: " " } }] })).toMatch(/memo/);
  });
  it("every field has operators and a default value for each", () => {
    for (const [field, ops] of Object.entries(OPERATORS_FOR)) {
      expect(ops.length).toBeGreaterThan(0);
      for (const op of ops) expect(defaultValue(field as Condition["field"], op)).not.toBeUndefined();
    }
  });
});

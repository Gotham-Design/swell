import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, amountRange, hasActiveFilters, parseFilters, resolveRange, toQueryString } from "./filters";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseFilters / toQueryString", () => {
  it("defaults to everything, page 1", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
    expect(toQueryString(EMPTY_FILTERS)).toBe("");
  });

  it("round-trips every filter", () => {
    const qs = `?date=custom&from=2026-01-01&to=2026-03-31&type=income,uncategorized&by=rule,hand&cat=${A},${B}&acct=${A}&min=100&max=%241%2C000&source=import&q=coffee+shop&deleted=1&batch=${B}&page=3`;
    const f = parseFilters(new URLSearchParams(qs));
    expect(f).toEqual({
      preset: "custom", from: "2026-01-01", to: "2026-03-31", types: ["income", "uncategorized"], categorizedBy: ["rule", "hand"], categories: [A, B],
      accounts: [A], min: "100", max: "$1,000", sources: ["import"], q: "coffee shop", deleted: true, batch: B, page: 3,
    });
    expect(parseFilters(new URLSearchParams(toQueryString(f)))).toEqual(f);
  });

  it("drops anything malformed instead of failing", () => {
    const f = parseFilters({ date: "someday", from: "2026-02-30", type: "income,bogus,income", cat: "not-a-uuid," + A, source: "fax", page: "-2" });
    expect(f.preset).toBe("all");
    expect(f.from).toBeNull();
    expect(f.types).toEqual(["income"]);
    expect(f.categories).toEqual([A]);
    expect(f.sources).toEqual([]);
    expect(f.page).toBe(1);
  });

  it("only keeps from/to for a custom range", () => {
    expect(toQueryString({ ...EMPTY_FILTERS, preset: "ytd", from: "2026-01-01" })).toBe("?date=ytd");
  });

  it("knows when filters are active (page alone doesn't count)", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, page: 4 })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, deleted: true })).toBe(true);
  });
});

describe("amountRange", () => {
  it("parses as cents by size", () => {
    expect(amountRange({ min: "100", max: "$1,000.50" })).toEqual({ min: 10000, max: 100050 });
    expect(amountRange({ min: "(45)", max: "" })).toEqual({ min: 4500, max: null });
    expect(amountRange({ min: "abc", max: "" })).toEqual({ min: null, max: null });
  });
});

describe("resolveRange (calendar year)", () => {
  const today = "2026-05-14";
  it.each([
    ["all", { from: null, to: null }],
    ["this_month", { from: "2026-05-01", to: "2026-05-31" }],
    ["last_month", { from: "2026-04-01", to: "2026-04-30" }],
    ["this_quarter", { from: "2026-04-01", to: "2026-06-30" }],
    ["ytd", { from: "2026-01-01", to: "2026-05-14" }],
    ["last_year", { from: "2025-01-01", to: "2025-12-31" }],
  ] as const)("%s", (preset, expected) => {
    expect(resolveRange({ preset, from: null, to: null }, today)).toEqual(expected);
  });

  it("handles January, February and leap years", () => {
    expect(resolveRange({ preset: "last_month", from: null, to: null }, "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange({ preset: "this_month", from: null, to: null }, "2028-02-03")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(resolveRange({ preset: "this_quarter", from: null, to: null }, "2026-12-31")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("passes a custom range through", () => {
    expect(resolveRange({ preset: "custom", from: "2026-01-05", to: null }, today)).toEqual({ from: "2026-01-05", to: null });
  });
});

describe("resolveRange (fiscal year starting July)", () => {
  it.each([
    ["2026-05-14", "ytd", { from: "2025-07-01", to: "2026-05-14" }],
    ["2026-05-14", "last_year", { from: "2024-07-01", to: "2025-06-30" }],
    ["2026-05-14", "this_quarter", { from: "2026-04-01", to: "2026-06-30" }],
    ["2026-07-01", "ytd", { from: "2026-07-01", to: "2026-07-01" }],
    ["2026-08-20", "this_quarter", { from: "2026-07-01", to: "2026-09-30" }],
    ["2026-08-20", "last_year", { from: "2025-07-01", to: "2026-06-30" }],
  ] as const)("on %s, %s", (today, preset, expected) => {
    expect(resolveRange({ preset, from: null, to: null }, today, 7)).toEqual(expected);
  });

  it("fiscal quarters follow the start month (April start)", () => {
    expect(resolveRange({ preset: "this_quarter", from: null, to: null }, "2026-03-15", 4)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(resolveRange({ preset: "this_quarter", from: null, to: null }, "2026-05-15", 4)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
});

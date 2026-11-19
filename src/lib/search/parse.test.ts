import { describe, expect, it } from "vitest";
import { parseAsk, readAmounts, readRange, suggestEntities, type AskVocabulary } from "./parse";

const TODAY = "2026-10-23";
const vocab: AskVocabulary = {
  vendors: [
    { key: "restaurant depot", label: "Restaurant Depot", count: 14 },
    { key: "gusto", label: "Gusto", count: 9 },
    { key: "square", label: "Square", count: 40 },
    { key: "state farm", label: "State Farm", count: 6 },
    { key: "restoration hardware", label: "Restoration Hardware", count: 1 },
  ],
  categories: [
    { id: "ing", name: "Ingredients", type: "expense" },
    { id: "ins", name: "Insurance", type: "expense" },
    { id: "rev", name: "Service Revenue", type: "income" },
  ],
  accounts: [{ id: "visa", name: "Business Visa", last4: "1007" }, { id: "chk", name: "Bakery Checking", last4: "4821" }],
};
const ask = (s: string) => parseAsk(s, vocab, TODAY);

describe("dates", () => {
  it.each([
    ["lately", "2026-07-26", "2026-10-23", "the last 90 days"],
    ["last 30 days", "2026-09-24", "2026-10-23", "the last 30 days"],
    ["this month", "2026-10-01", "2026-10-23", "October"],
    ["last month", "2026-09-01", "2026-09-30", "September"],
    ["in q3", "2026-07-01", "2026-09-30", "Q3 2026"],
    ["q4 2025", "2025-10-01", "2025-12-31", "Q4 2025"],
    ["last quarter", "2026-07-01", "2026-09-30", "Q3 2026"],
    ["in september", "2026-09-01", "2026-09-30", "September"],
    ["in november", "2025-11-01", "2025-11-30", "November 2025"],
    ["since june", "2026-06-01", "2026-10-23", "since June"],
    ["this year", "2026-01-01", "2026-10-23", "2026 so far"],
    ["last year", "2025-01-01", "2025-12-31", "2025"],
    ["in 2025", "2025-01-01", "2025-12-31", "2025"],
  ])("%s", (text, from, to, label) => {
    expect(readRange(text, TODAY).range).toEqual({ from, to, label });
  });
  it("leaves 'may' alone unless it reads as the month", () => {
    expect(readRange("we may have paid", TODAY).range).toBeUndefined();
    expect(readRange("in may", TODAY).range?.from).toBe("2026-05-01");
  });
});

describe("amounts", () => {
  it("reads limits in cents", () => {
    expect(readAmounts("over $500")).toMatchObject({ min: 50000 });
    expect(readAmounts("under 49.99")).toMatchObject({ max: 4999 });
    expect(readAmounts("between $100 and 1,250")).toMatchObject({ min: 10000, max: 125000 });
    expect(readAmounts("more than 2k")).toMatchObject({ min: 200000 });
  });
});

describe("questions", () => {
  it("how much have we spent at restaurant depot lately", () => {
    const { query, understood } = ask("how much have we spent at restaurant depot lately");
    expect(understood).toBe(true);
    expect(query).toMatchObject({ measure: "spend", vendor: { key: "restaurant depot" }, range: { label: "the last 90 days" } });
    expect(query.search).toBeUndefined();
  });
  it("How much did we spend on ingredients in Q3?", () => {
    expect(ask("How much did we spend on ingredients in Q3?").query)
      .toMatchObject({ measure: "spend", category: { id: "ing" }, range: { label: "Q3 2026" } });
  });
  it("What did we pay Gusto in September?", () => {
    expect(ask("What did we pay Gusto in September?").query).toMatchObject({ measure: "spend", vendor: { label: "Gusto" }, range: { from: "2026-09-01" } });
  });
  it("Uncategorized over $500", () => {
    expect(ask("Uncategorized over $500").query).toMatchObject({ uncategorized: true, min: 50000 });
  });
  it("Square deposits vs. last month", () => {
    expect(ask("Square deposits vs. last month").query).toMatchObject({ measure: "earn", vendor: { key: "square" }, range: { label: "September" } });
  });
  it("the Try asking examples", () => {
    const v = { ...vocab, categories: [...vocab.categories, { id: "soft", name: "Software & Subscriptions", type: "expense" }] };
    expect(parseAsk("How much did we spend on software this year?", v, TODAY).query).toMatchObject({ measure: "spend", category: { id: "soft" }, range: { label: "2026 so far" } });
    expect(parseAsk("What came in last month?", v, TODAY).query).toMatchObject({ measure: "earn", range: { label: "September" } });
    expect(parseAsk("Insurance in Q3", v, TODAY).query).toMatchObject({ measure: "spend", category: { id: "ins" }, range: { label: "Q3 2026" } });
  });
  it("a category of income reads as money in", () => {
    expect(ask("service revenue this year").query).toMatchObject({ measure: "earn", category: { id: "rev" } });
  });
  it("an account by name or last four", () => {
    expect(ask("spending on business visa last month").query).toMatchObject({ measure: "spend", account: { id: "visa" } });
    expect(ask("charges on 4821").query.account?.id).toBe("chk");
  });
  it("unknown words become a description search", () => {
    expect(ask("verizon").query).toEqual({ measure: "list", search: "verizon" });
    expect(ask("over 2000").query).toEqual({ measure: "list", min: 200000 });
  });
  it("actions", () => {
    expect(ask("import").action).toBe("import");
    expect(ask("p&l").action).toBe("report");
    expect(ask("add transaction").action).toBe("add");
    expect(ask("rules").action).toBe("rules");
    expect(ask("hello").action).toBeUndefined();
  });
});

describe("suggestions as you type", () => {
  it("finishes the last words", () => {
    expect(suggestEntities("how much have we spent at restaurant d", vocab).map((s) => s.kind === "vendor" && s.vendor.label))
      .toEqual(["Restaurant Depot"]);
    const res = suggestEntities("spent at res", vocab);
    expect(res.map((s) => s.kind === "vendor" ? s.vendor.label : "")).toEqual(["Restaurant Depot", "Restoration Hardware"]);
    expect(suggestEntities("ins", vocab).map((s) => s.kind)).toEqual(["category"]);
    expect(suggestEntities("the", vocab)).toEqual([]);
  });
});

describe("breakdowns", () => {
  it.each([
    ["whats our largest monthly spend", { group: "month", rank: true, measure: "spend" }],
    ["whats our largest monthly cost?", { group: "month", rank: true, measure: "spend" }],
    ["how much are we spending each month at vercel", { group: "month", measure: "spend" }],
    ["who do we pay the most", { group: "vendor", rank: true, measure: "spend" }],
    ["top vendors this year", { group: "vendor", rank: true, measure: "spend" }],
    ["biggest expenses last quarter", { group: "category", rank: true, measure: "spend" }],
    ["largest categories", { group: "category", rank: true }],
    ["income by month", { group: "month", measure: "earn" }],
  ])("%s", (text, want) => {
    const { query, understood } = ask(text);
    expect(understood).toBe(true);
    expect(query).toMatchObject(want);
    expect(query.search).toBeUndefined();
  });
  it("covers the last 12 months unless dates are given", () => {
    expect(ask("top vendors").query.range).toEqual({ from: "2025-11-01", to: "2026-10-23", label: "the last 12 months" });
    expect(ask("top vendors this year").query.range?.label).toBe("2026 so far");
  });
  it("a vendor named in a monthly question stays the filter", () => {
    expect(ask("how much are we spending each month at gusto").query).toMatchObject({ group: "month", vendor: { key: "gusto" } });
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { toQuery } from "./ai";
import type { AskVocabulary } from "./parse";

const vocab: AskVocabulary = {
  vendors: [{ key: "restaurant depot", label: "Restaurant Depot", count: 14 }],
  categories: [{ id: "ing", name: "Ingredients", type: "expense" }],
  accounts: [{ id: "visa", name: "Business Visa", last4: "1007" }],
};
const blank = { measure: "list" as const, vendor: null, category: null, account: null, from: null, to: null, min: null, max: null, uncategorized: false, search: null };

describe("reading the model's reply", () => {
  it("matches names against this business's own lists", () => {
    expect(toQuery({ ...blank, measure: "spend", vendor: "restaurant depot", account: "1007", from: "2026-07-01", to: "2026-09-30", min: "$1,000" }, vocab, "2026-10-23"))
      .toEqual({ measure: "spend", vendor: { key: "restaurant depot", label: "Restaurant Depot" }, account: { id: "visa", name: "Business Visa" },
        range: { from: "2026-07-01", to: "2026-09-30", label: "Jul 1, 2026 – Sep 30, 2026" }, min: 100000 });
  });
  it("an unknown vendor becomes a description search; bad dates and categories are dropped", () => {
    expect(toQuery({ ...blank, vendor: "Lowes", category: "Made Up", from: "yesterday" }, vocab, "2026-10-23"))
      .toEqual({ measure: "list", search: "Lowes" });
  });
  it("never runs past today", () => {
    expect(toQuery({ ...blank, from: "2026-10-01", to: "2026-12-31" }, vocab, "2026-10-23").range?.to).toBe("2026-10-23");
  });
});

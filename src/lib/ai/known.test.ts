import { describe, expect, it } from "vitest";
import { KNOWN_CONFIDENCE, knownSuggestions } from "./known";
import type { AiCandidate, AiContext } from "./prompt";

const ctx: AiContext = {
  enabled: true, model: null, share_memos: false, examples: [], rejections: [],
  categories: [
    { id: "ins", name: "Insurance", type: "expense", description: null },
    { id: "util", name: "Utilities", type: "expense", description: null },
    { id: "rev", name: "Service Revenue", type: "income", description: null },
  ],
};
const row = (over: Partial<AiCandidate>): AiCandidate => ({
  id: "t", date: "2026-07-01", description_clean: "State Farm", vendor_normalized: "state farm", amount_cents: -21_800,
  money_account_kind: "checking", memo: null, recurring_cadence: "monthly", is_large: false, vendor_categories: [], ...over,
});

describe("known merchants", () => {
  it("files an insurer's payment under Insurance with high confidence", () => {
    const { suggestions, rest } = knownSuggestions(ctx, [
      row({ id: "a" }),
      row({ id: "b", description_clean: "State Farm Ro 27 Cpc-Client 27 S", vendor_normalized: "state farm ro 27 cpc client 27 s" }),
      row({ id: "c", description_clean: "Verizon", vendor_normalized: "verizon" }),
    ]);
    expect(rest).toEqual([]);
    expect(suggestions.map((s) => [s.transaction_id, s.category_id, s.confidence]))
      .toEqual([["a", "ins", KNOWN_CONFIDENCE], ["b", "ins", KNOWN_CONFIDENCE], ["c", "util", KNOWN_CONFIDENCE]]);
  });

  it("leaves deposits, unknown vendors, missing categories and taught vendors to the model", () => {
    const { suggestions, rest } = knownSuggestions(ctx, [
      row({ id: "deposit", amount_cents: 50_000 }),
      row({ id: "unknown", description_clean: "Gotham Llc Ach Pmt", vendor_normalized: "gotham llc ach pmt" }),
      row({ id: "no-category", description_clean: "Adobe", vendor_normalized: "adobe" }),
      row({ id: "taught", vendor_categories: ["Rent"] }),
    ]);
    expect(suggestions).toEqual([]);
    expect(rest.map((r) => r.id)).toEqual(["deposit", "unknown", "no-category", "taught"]);
  });
});

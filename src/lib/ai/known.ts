// Tier 1b of category suggestions: well-known merchants (State Farm, Verizon, Adobe, Shell...)
// whose category is unambiguous for a small business. No outside call, and confident enough
// to be filed automatically. Only money going out: a deposit from an insurer is a claim or a
// refund, which the model or the user should look at. When the business has filed this
// vendor some other way, its own history wins and the row goes on to the model.
import { findMerchant } from "@/lib/transactions/merchants";
import type { AiCandidate, AiContext, Suggestion } from "./prompt";

export const KNOWN_MODEL = "known-merchant";
export const KNOWN_VERSION = "known-merchant-2026-10-23";
export const KNOWN_CONFIDENCE = 0.95;

export function knownSuggestions(ctx: AiContext, candidates: AiCandidate[]) {
  const byName = new Map(ctx.categories.filter((c) => c.type === "expense").map((c) => [c.name.toLowerCase(), c]));
  const suggestions: Suggestion[] = [];
  const rest: AiCandidate[] = [];
  for (const c of candidates) {
    const merchant = c.amount_cents < 0 ? (findMerchant(c.description_clean) ?? (c.vendor_normalized ? findMerchant(c.vendor_normalized) : undefined)) : undefined;
    const category = merchant?.category?.map((n) => byName.get(n.toLowerCase())).find((x) => !!x);
    const taughtOtherwise = !!category && c.vendor_categories.length > 0
      && !c.vendor_categories.some((n) => n.toLowerCase() === category.name.toLowerCase());
    if (category && !taughtOtherwise) {
      suggestions.push({ transaction_id: c.id, category_id: category.id, confidence: KNOWN_CONFIDENCE, reason: "", flags: [] });
    } else {
      rest.push(c);
    }
  }
  return { suggestions, rest };
}

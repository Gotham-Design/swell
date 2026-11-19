// The status shown on rows, chips, tabs and counts. One rule everywhere:
// - Suggested: a pending suggestion at 85% or more.
// - Needs review: a pending suggestion under 85%, or uncategorized with no suggestion.
// - Auto-filed: categorized automatically from a confident suggestion (category_source 'ai').
// - Categorized: has a category, from any other source.
export const SUGGESTED_AT = 0.85;

export type TxnStatus = "suggested" | "review" | "auto" | "categorized";

export const STATUS_LABEL: Record<TxnStatus, string> = {
  suggested: "Suggested",
  review: "Needs review",
  auto: "Auto-filed",
  categorized: "Categorized",
};

export function txnStatus(categoryId: string | null, suggestionConfidence: number | null | undefined, source?: string | null): TxnStatus {
  if (categoryId) return source === "ai" ? "auto" : "categorized";
  return suggestionConfidence != null && suggestionConfidence >= SUGGESTED_AT ? "suggested" : "review";
}

/** "62%" — whole percent, never rounded up into the Suggested band. */
export function pct(confidence: number): string {
  return `${Math.floor(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

// Tier 1 of category suggestions: the business's own filing history, no outside call.
// When people have filed a vendor the same way every time, and often enough, suggest
// that category directly. Two unanimous filings are enough: the business has shown how it
// files this vendor, and these picks are filed automatically (auto_file_suggestions).
// Confidence is Laplace's rule of succession, (n + 1) / (n + 2): 0.75 after 2, climbing
// toward 1 as the history grows. Anything mixed goes to the model, which also sees the
// vendor's past categories.
import type { AiCandidate, AiContext, Suggestion } from "./prompt";

export const HISTORY_MODEL = "vendor-history";
export const HISTORY_VERSION = "vendor-history-2026-10-22";
/** Unanimous filings needed before history answers on its own. */
export const HISTORY_MIN = 2;

export interface VendorHistoryRow {
  vendor_normalized: string;
  category_account_id: string;
  n: number;
  vendor_total: number;
}

export function historyConfidence(n: number): number {
  return (n + 1) / (n + 2);
}

/** Split candidates into those history can answer and the rest. */
export function historySuggestions(ctx: AiContext, candidates: AiCandidate[], rows: VendorHistoryRow[]) {
  const usable = new Set(ctx.categories.map((c) => c.id));
  const byVendor = new Map<string, VendorHistoryRow[]>();
  for (const r of rows) byVendor.set(r.vendor_normalized, [...(byVendor.get(r.vendor_normalized) ?? []), r]);

  const suggestions: Suggestion[] = [];
  const rest: AiCandidate[] = [];
  for (const c of candidates) {
    const history = c.vendor_normalized ? byVendor.get(c.vendor_normalized) : undefined;
    const only = history?.length === 1 ? history[0] : undefined;
    if (only && only.n === only.vendor_total && only.n >= HISTORY_MIN && usable.has(only.category_account_id)) {
      suggestions.push({
        transaction_id: c.id,
        category_id: only.category_account_id,
        confidence: Math.round(historyConfidence(only.n) * 1000) / 1000,
        reason: "",
        flags: [],
      });
    } else {
      rest.push(c);
    }
  }
  return { suggestions, rest };
}

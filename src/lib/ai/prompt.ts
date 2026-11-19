// The category-suggestion request: instructions, the business context, the transactions,
// and the tool the model answers through. Pure (no I/O), so tests can inspect exactly
// what would be sent. Only fields listed here ever reach the API; the database functions
// ai_context / ai_candidates already leave out account numbers, emails and (unless the
// owner opted in) memos.
import type Anthropic from "@anthropic-ai/sdk";
import { centsToInput } from "@/lib/money";

export const PROMPT_VERSION = "categorize-2026-10-22";
export const TOOL_NAME = "record_category_suggestions";
export const FLAGS = ["possible transfer", "possible owner draw", "personal?", "possible refund"] as const;
export const AI_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export interface AiCategory { id: string; name: string; type: string; description: string | null }
export interface AiContext {
  enabled: boolean;
  model: AiModel | null;
  share_memos: boolean;
  categories: AiCategory[];
  examples: { description: string; category: string }[];
  rejections: { description: string; not_category: string; chosen_category: string | null }[];
}
export interface AiCandidate {
  id: string;
  date: string;
  description_clean: string;
  vendor_normalized: string | null;
  amount_cents: number;
  money_account_kind: string | null;
  memo: string | null;
  recurring_cadence: string | null;
  is_large: boolean;
  vendor_categories: string[];
}

const INSTRUCTIONS = `You categorize bank and card transactions for a small business's bookkeeping. A tax accountant reviews the books later, so accuracy matters more than coverage.

For every transaction you are given, call the ${TOOL_NAME} tool once with one suggestion per transaction:
- category_id: the single best category from the business's list. Use only ids from that list.
- confidence: 0 to 1. Use 0.9 or higher only when the description makes the category clear (or the vendor's past categories agree). Use under 0.5 when you are guessing.
- reason: at most 20 words, plain language, saying what in the transaction points to the category.
- flags: any that apply, otherwise an empty list. "possible transfer" when money seems to move between the business's own accounts (card payments, savings moves). "possible owner draw" when it looks like money taken out for the owner. "personal?" when it looks like a personal purchase. "possible refund" when money comes back for an earlier purchase.

Amounts are from the money account's view: negative is money out, positive is money in. A credit card account's negative amounts are charges. Prefer the categories people already chose for the same vendor. Never use a category listed under "rejected" for that same kind of transaction.`;

/** The business part of the prompt: stable between batches, so it sits in the cached system prefix. */
export function businessBlock(ctx: AiContext): string {
  return JSON.stringify({
    categories: ctx.categories.map((c) => ({ id: c.id, name: c.name, type: c.type, description: c.description })),
    examples: ctx.examples.map((e) => ({ description: e.description, category: e.category })),
    rejected: ctx.rejections.map((r) => ({ description: r.description, not: r.not_category, chosen_instead: r.chosen_category })),
  });
}

/** One transaction as sent: the allowed fields only. */
export function transactionPayload(t: AiCandidate, shareMemos: boolean) {
  return {
    id: t.id,
    date: t.date,
    description: t.description_clean,
    vendor: t.vendor_normalized,
    amount: centsToInput(t.amount_cents),
    account_type: t.money_account_kind,
    ...(shareMemos && t.memo ? { memo: t.memo } : {}),
    patterns: {
      recurring: t.recurring_cadence,
      large: t.is_large,
      vendor_past_categories: t.vendor_categories,
    },
  };
}

export function suggestionTool(categoryIds: string[], transactionIds: string[]): Anthropic.Beta.BetaTool {
  return {
    name: TOOL_NAME,
    description: "Record one category suggestion for each transaction in the request.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              transaction_id: { type: "string", enum: transactionIds },
              category_id: { type: "string", enum: categoryIds },
              confidence: { type: "number" },
              reason: { type: "string" },
              flags: { type: "array", items: { type: "string", enum: [...FLAGS] } },
            },
            required: ["transaction_id", "category_id", "confidence", "reason", "flags"],
            additionalProperties: false,
          },
        },
      },
      required: ["suggestions"],
      additionalProperties: false,
    },
  };
}

export function buildRequest(model: AiModel, ctx: AiContext, candidates: AiCandidate[]): Anthropic.Beta.MessageCreateParamsNonStreaming {
  const categoryIds = ctx.categories.map((c) => c.id);
  return {
    model,
    max_tokens: 16000,
    // Classification: low effort is enough and keeps the token budget down.
    output_config: { effort: "low" },
    system: [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: `Business categories and history:\n${businessBlock(ctx)}`, cache_control: { type: "ephemeral" } },
    ],
    tools: [suggestionTool(categoryIds, candidates.map((c) => c.id))],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: `Suggest a category for each of these ${candidates.length} transactions by calling ${TOOL_NAME}.\n` +
        JSON.stringify(candidates.map((c) => transactionPayload(c, ctx.share_memos))),
    }],
    // Sonnet 5.5: if a safety classifier declines, the API retries on a fallback model.
    ...(model === "claude-sonnet-5-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  };
}

export interface Suggestion {
  transaction_id: string;
  category_id: string;
  confidence: number;
  reason: string;
  flags: string[];
  /** Second most likely category (Jev returns a full distribution; Anthropic doesn't). */
  runner_up_category_id?: string;
  runner_up_confidence?: number;
}

/** Read the tool call; list anything outside the ids we sent. */
export function readSuggestions(content: Anthropic.Beta.BetaContentBlock[], categoryIds: Set<string>, transactionIds: Set<string>) {
  const call = content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!call) return { call: null, valid: [] as Suggestion[], invalid: [] as string[] };
  const raw = (call.input as { suggestions?: unknown }).suggestions;
  const list = Array.isArray(raw) ? raw : [];
  const valid: Suggestion[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of list as Record<string, unknown>[]) {
    const txn = String(item?.transaction_id ?? "");
    const cat = String(item?.category_id ?? "");
    if (!transactionIds.has(txn)) { invalid.push(`transaction_id ${txn} was not in the request`); continue; }
    if (!categoryIds.has(cat)) { invalid.push(`category_id ${cat} for ${txn} is not in the category list`); continue; }
    if (seen.has(txn)) continue;
    seen.add(txn);
    const confidence = Number(item.confidence);
    valid.push({
      transaction_id: txn,
      category_id: cat,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      reason: String(item.reason ?? "").split(/\s+/).filter(Boolean).slice(0, 20).join(" "),
      flags: Array.isArray(item.flags) ? item.flags.filter((f): f is string => (FLAGS as readonly string[]).includes(String(f))) : [],
    });
  }
  return { call, valid, invalid };
}

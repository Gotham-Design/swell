// Tier 2 of category suggestions: Jev (TypeSafe AI). Jev doesn't write text; it answers
// typed questions with a probability for every option. Each transaction gets one choice
// question over the business's categories (plus "none of these") and four yes/no flag
// questions, all answered in one call.
//
// Pure (no I/O), so tests can inspect exactly what would be sent. The fields sent are the
// same ones prompt.ts sends to Anthropic: cleaned description, vendor, amount, date, account
// type, past categories for the vendor, and memos only when the owner opted in.
import { choice, noul, type ChoiceQuestion, type NoulQuestion } from "@typesafe-ai/sdk";
import { centsToInput } from "@/lib/money";
import type { AiCandidate, AiContext, Suggestion } from "./prompt";

export const JEV_PROMPT_VERSION = "jev-categorize-2026-10-23";
export const JEV_DEFAULT_MODEL = "jev-latest";
/** Transactions per Jev call. Calls in one engine batch run in parallel. */
export const JEV_CHUNK = 10;
export const NONE_LABEL = "None of these categories";
/**
 * Transfers between the business's own accounts are filed to a money account, which is not
 * on the category list. Offering this option lets Jev say so instead of forcing the nearest
 * category (a card payment read as Sales). Like NONE_LABEL it is never the pick.
 */
export const TRANSFER_LABEL = "Transfer between the business's own accounts";
/** A row Jev flags as a likely transfer never clears the 0.85 "Suggested" line. */
export const TRANSFER_CONFIDENCE_CAP = 0.5;
/** A flag is attached when Jev's yes-probability reaches this. */
export const FLAG_THRESHOLD = 0.6;

const FLAG_QUESTIONS = {
  "possible transfer": (k: string) =>
    `Does transaction \`${k}\` look like money moving between the business's own accounts, such as a credit card payment or a move to savings?`,
  "possible owner draw": (k: string) => `Does transaction \`${k}\` look like money the owner took out for themselves?`,
  "personal?": (k: string) => `Does transaction \`${k}\` look like a personal purchase rather than a business expense?`,
  "possible refund": (k: string) => `Is transaction \`${k}\` money coming back for an earlier purchase?`,
} as const;
type Flag = keyof typeof FLAG_QUESTIONS;
const FLAGS = Object.keys(FLAG_QUESTIONS) as Flag[];

/** The part of the SDK client we use (lets tests pass a fake). */
export interface JevClient {
  systemOne(
    request: { state: Record<string, unknown>; questions: Record<string, ChoiceQuestion | NoulQuestion>; model?: string },
    options?: { timeout?: number },
  ): Promise<{
    model: string;
    answers: Record<string, { type: string; choice?: string; noul?: number; probabilities?: Record<string, number> }>;
    usage: { input_tokens: number | null; output_tokens: number | null };
  }>;
}

/** Category labels as Jev sees them: the name, made unique if two categories share one. */
export function categoryLabels(ctx: AiContext): Map<string, string> {
  const labelToId = new Map<string, string>();
  const nameCount = new Map<string, number>();
  for (const c of ctx.categories) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  for (const c of ctx.categories) {
    let label = (nameCount.get(c.name) ?? 0) > 1 ? `${c.name} (${c.type})` : c.name;
    for (let i = 2; labelToId.has(label) || label === NONE_LABEL || label === TRANSFER_LABEL; i++) label = `${c.name} (${c.type} ${i})`;
    labelToId.set(label, c.id);
  }
  return labelToId;
}

function transactionState(t: AiCandidate, shareMemos: boolean) {
  return {
    date: t.date,
    description: t.description_clean,
    vendor: t.vendor_normalized,
    amount: centsToInput(t.amount_cents),
    direction: t.amount_cents < 0 ? "money out" : "money in",
    account_type: t.money_account_kind,
    ...(shareMemos && t.memo ? { memo: t.memo } : {}),
    recurring: t.recurring_cadence,
    unusually_large: t.is_large,
    vendor_past_categories: t.vendor_categories,
  };
}

/** One Jev request for up to JEV_CHUNK transactions; keys t1..tN are local to the request. */
export function buildJevRequest(ctx: AiContext, candidates: AiCandidate[], model: string) {
  const labelToId = categoryLabels(ctx);
  const criteria: Record<string, string | null> = {};
  for (const [label, id] of labelToId) {
    const c = ctx.categories.find((x) => x.id === id)!;
    criteria[label] = `${c.type} category${c.description ? `: ${c.description}` : ""}`;
  }
  criteria[TRANSFER_LABEL] = "Money moving between the business's own bank, savings, loan or credit card accounts, such as paying the credit card bill or moving money to savings. Not income or an expense.";
  criteria[NONE_LABEL] = "Use only when no category on the list fits at all.";

  const state: Record<string, unknown> = {
    about:
      "Bank and card transactions for a small business's bookkeeping. Amounts are from the money account's view: " +
      "negative is money out, positive is money in. On a credit card account, negative amounts are charges. " +
      "A tax accountant reviews the books later.",
    how_this_business_files_vendors: ctx.examples.map((e) => ({ description: e.description, category: e.category })),
    past_corrections: ctx.rejections.map((r) => ({ description: r.description, wrong: r.not_category, right: r.chosen_category })),
  };
  const questions: Record<string, ChoiceQuestion | NoulQuestion> = {};
  candidates.forEach((t, i) => {
    const k = `t${i + 1}`;
    state[k] = transactionState(t, ctx.share_memos);
    questions[`${k}_category`] = choice(
      `Which category should transaction \`${k}\` be filed under? Prefer the category this business already uses for the same vendor, and never one listed as wrong in \`past_corrections\` for the same kind of transaction.`,
      criteria,
    );
    FLAGS.forEach((f, j) => { questions[`${k}_flag${j}`] = noul(FLAG_QUESTIONS[f](k)); });
  });
  // Catch-all categories ("Other Expense"): a pick's real rival is the next specific category.
  const catchAll = new Set([...labelToId].filter(([, id]) => {
    const c = ctx.categories.find((x) => x.id === id)!;
    return /^other\b/i.test(c.name) || /fits no other/i.test(c.description ?? "");
  }).map(([label]) => label));
  return { request: { state, questions, model }, labelToId, catchAll };
}

/**
 * Turn Jev's answers into suggestions. The pick is the most likely real category (never
 * "none of these" or the transfer option); its probability is the confidence, so when Jev thinks nothing fits,
 * the pick lands under the 0.85 line in Needs review. The runner-up is the next category.
 */
export function readJevAnswers(
  answers: Awaited<ReturnType<JevClient["systemOne"]>>["answers"],
  candidates: AiCandidate[],
  labelToId: Map<string, string>,
  catchAll: Set<string> = new Set(),
): Suggestion[] {
  const out: Suggestion[] = [];
  candidates.forEach((t, i) => {
    const k = `t${i + 1}`;
    const probs = answers[`${k}_category`]?.probabilities;
    if (!probs) return;
    const ranked = Object.entries(probs)
      .filter(([label, p]) => labelToId.has(label) && Number.isFinite(p))
      .sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return;
    const [best, second] = ranked;
    const flags = FLAGS.filter((_, j) => (answers[`${k}_flag${j}`]?.noul ?? 0) >= FLAG_THRESHOLD);
    // Likely a transfer: the pick stays a guess for review, never "Suggested".
    const transferish = flags.includes("possible transfer") || (probs[TRANSFER_LABEL] ?? 0) >= FLAG_THRESHOLD;
    if (transferish && !flags.includes("possible transfer")) flags.unshift("possible transfer");
    // The closest specific rival: a catch-all ("Other Expense") isn't a competing answer.
    const rival = catchAll.has(best[0]) ? second?.[1] ?? 0 : ranked.slice(1).find(([label]) => !catchAll.has(label))?.[1] ?? 0;
    const confidence = transferish ? Math.min(clamp(best[1]), TRANSFER_CONFIDENCE_CAP) : clamp(pickConfidence(best[1], rival));
    out.push({
      transaction_id: t.id,
      category_id: labelToId.get(best[0])!,
      confidence,
      reason: "",
      flags,
      ...(second && second[1] > 0 ? { runner_up_category_id: labelToId.get(second[0])!, runner_up_confidence: clamp(second[1]) } : {}),
    });
  });
  return out;
}

/** Below this, Jev isn't leaning on any category; its raw probability stands. */
export const DECISIVE_AT = 0.6;

/**
 * How sure the pick is that it's the right category. Jev spreads probability across every
 * option, including "none of these", so an obvious pick like a Claude subscription can land at
 * 80% with the next category at 7%. Once Jev clearly leans one way (60%+), the confidence is the
 * pick's share against its closest specific rival (catch-alls like "Other Expense" don't count):
 * 0.80 vs 0.07 -> 0.92; 0.71 vs 0.18 (an ink subscription:
 * supplies or software?) -> 0.80 and stays a suggestion for review.
 */
export function pickConfidence(best: number, second: number): number {
  if (best < DECISIVE_AT) return best;
  // Never 100% from the ratio alone: no rival at all still leaves room for doubt.
  return Math.max(best, Math.min(0.99, best / (best + Math.max(0, second))));
}

const clamp = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 1000) / 1000;

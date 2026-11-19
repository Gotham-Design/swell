// Runs category suggestions for one business: up to N batches of 50 uncategorized
// transactions (no rule match), one model call each, results recorded through the
// database. Dependencies are injected so tests can mock the SDK and the store.
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODELS, PROMPT_VERSION, TOOL_NAME, buildRequest, readSuggestions,
  type AiCandidate, type AiContext, type AiModel, type Suggestion,
} from "./prompt";
import { HISTORY_MODEL, HISTORY_VERSION, historySuggestions, type VendorHistoryRow } from "./history";
import { KNOWN_MODEL, KNOWN_VERSION, knownSuggestions } from "./known";
import { JEV_CHUNK, JEV_DEFAULT_MODEL, JEV_PROMPT_VERSION, buildJevRequest, readJevAnswers, type JevClient } from "./jev";

export interface AiStore {
  context(): Promise<AiContext>;
  budget(): Promise<{ used: number; budget: number; remaining: number }>;
  candidates(limit: number): Promise<AiCandidate[]>;
  requestDone(key: string): Promise<boolean>;
  /** How people filed these vendors before (tier 1). Optional: without it, every row goes to the model. */
  vendorHistory?(vendors: string[]): Promise<VendorHistoryRow[]>;
  record(r: {
    requestKey: string; model: string; promptVersion: string; latencyMs: number;
    inputTokens: number; outputTokens: number; suggestions: Suggestion[];
  }): Promise<{ inserted: number; skipped: number; auto_applied: number }>;
}

/** The part of the SDK client we use (lets tests pass a fake). */
export interface AiClient {
  beta: { messages: { create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> } };
}

export interface EngineDeps {
  store: AiStore;
  /** Anthropic client. Used when no Jev client is given. */
  client?: AiClient;
  /** Jev (TypeSafe) client. When given, it answers instead of Anthropic. */
  jev?: JevClient;
  jevModel?: string;
  defaultModel?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export type RunStatus = "done" | "disabled" | "budget_exhausted" | "nothing_to_do" | "refused" | "failed";
export interface RunResult { status: RunStatus; batches: number; suggested: number; autoApplied: number; message?: string }

const BATCH = 50;
const MAX_ATTEMPTS = 5;

export function resolveModel(business: string | null, env?: string): AiModel {
  const pick = business ?? env;
  return (AI_MODELS as readonly string[]).includes(pick ?? "") ? (pick as AiModel) : "claude-haiku-5-5";
}

/** Same transactions, same wording, same model and prompt version: same key. */
export function requestKey(model: string, ctx: AiContext, candidates: AiCandidate[]): string {
  const h = createHash("sha256");
  h.update(`${PROMPT_VERSION}|${model}|`);
  h.update(ctx.categories.map((c) => c.id).sort().join(","));
  for (const c of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    h.update(`|${c.id}:${c.description_clean}:${c.amount_cents}`);
  }
  return h.digest("hex");
}

const retryable = (e: unknown) =>
  e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;

/** Exponential backoff with jitter on 429 / 529 (overloaded) / 5xx; honors retry-after. */
export async function callWithBackoff(deps: { client: AiClient; sleep?: EngineDeps["sleep"] }, params: Anthropic.Beta.MessageCreateParamsNonStreaming) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.client.beta.messages.create(params);
    } catch (e) {
      if (!retryable(e) || attempt >= MAX_ATTEMPTS - 1) throw e;
      const header = e instanceof Anthropic.APIError ? Number(e.headers?.get?.("retry-after")) : NaN;
      const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(Number.isFinite(header) && header > 0 ? Math.max(header * 1000, backoff) : backoff);
    }
  }
}

interface Answer { suggestions: Suggestion[]; inputTokens: number; outputTokens: number; refused: boolean; model: string }

/** Anthropic: one tool call per batch, one retry when the answer used ids we didn't send. */
async function askAnthropic(deps: EngineDeps & { client: AiClient }, ctx: AiContext, model: AiModel, candidates: AiCandidate[]): Promise<Answer> {
  const log = deps.log ?? (() => {});
  const categoryIds = new Set(ctx.categories.map((c) => c.id));
  const params = buildRequest(model, ctx, candidates);
  const transactionIds = new Set(candidates.map((c) => c.id));
  let inputTokens = 0;
  let outputTokens = 0;
  let response = await callWithBackoff(deps, params);
  inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
  outputTokens += response.usage.output_tokens;
  if (response.stop_reason === "refusal") return { suggestions: [], inputTokens, outputTokens, refused: true, model };
  let read = readSuggestions(response.content, categoryIds, transactionIds);
  if (!read.call || read.invalid.length) {
    log("ai: retrying batch", { reason: read.call ? "invalid ids" : "no tool call", invalid: read.invalid.slice(0, 5) });
    const followUp: Anthropic.Beta.BetaMessageParam = read.call
      ? { role: "user", content: [{ type: "tool_result", tool_use_id: read.call.id, is_error: true,
          content: `Rejected: ${read.invalid.join("; ")}. Use only the category ids and transaction ids from the request, and call ${TOOL_NAME} again with every transaction.` }] }
      : { role: "user", content: `Call ${TOOL_NAME} with one suggestion per transaction.` };
    response = await callWithBackoff(deps, {
      ...params,
      messages: [...params.messages, { role: "assistant", content: response.content }, followUp],
    });
    inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    outputTokens += response.usage.output_tokens;
    const refused = response.stop_reason === "refusal";
    read = refused ? { call: null, valid: [], invalid: [] } : readSuggestions(response.content, categoryIds, transactionIds);
    return { suggestions: read.valid, inputTokens, outputTokens, refused, model };
  }
  return { suggestions: read.valid, inputTokens, outputTokens, refused: false, model };
}

/** Jev: chunks of JEV_CHUNK transactions, asked in parallel. The SDK owns retries. */
async function askJev(deps: EngineDeps & { jev: JevClient }, ctx: AiContext, model: string, candidates: AiCandidate[]): Promise<Answer> {
  const chunks: AiCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += JEV_CHUNK) chunks.push(candidates.slice(i, i + JEV_CHUNK));
  const results = await Promise.all(chunks.map(async (chunk) => {
    const { request, labelToId, catchAll } = buildJevRequest(ctx, chunk, model);
    const res = await deps.jev.systemOne(request);
    return { suggestions: readJevAnswers(res.answers, chunk, labelToId, catchAll), usage: res.usage, model: res.model };
  }));
  return {
    suggestions: results.flatMap((r) => r.suggestions),
    inputTokens: results.reduce((n, r) => n + (r.usage.input_tokens ?? 0), 0),
    outputTokens: results.reduce((n, r) => n + (r.usage.output_tokens ?? 0), 0),
    refused: false,
    model: results[0]?.model ?? model,
  };
}

export async function suggestCategories(deps: EngineDeps, opts: { maxBatches?: number } = {}): Promise<RunResult> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const result: RunResult = { status: "nothing_to_do", batches: 0, suggested: 0, autoApplied: 0 };

  const ctx = await store.context();
  if (!ctx.enabled) return { ...result, status: "disabled" };
  if (!ctx.categories.length) return result;
  const useJev = !!deps.jev;
  if (!useJev && !deps.client) return { ...result, status: "failed", message: "Suggestions are not set up." };
  const model: string = useJev ? (deps.jevModel || JEV_DEFAULT_MODEL) : resolveModel(ctx.model, deps.defaultModel);
  const promptVersion = useJev ? JEV_PROMPT_VERSION : PROMPT_VERSION;

  const record = async (key: string, answer: Answer, version: string, latencyMs: number) => {
    const recorded = await store.record({
      requestKey: key, model: answer.model, promptVersion: version, latencyMs,
      inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, suggestions: answer.suggestions,
    });
    log("ai: batch recorded", { model: answer.model, promptVersion: version, latencyMs,
      inputTokens: answer.inputTokens, outputTokens: answer.outputTokens, ...recorded });
    result.batches++;
    result.suggested += recorded.inserted;
    result.autoApplied += recorded.auto_applied;
    result.status = "done";
    return recorded.inserted + recorded.auto_applied;
  };

  for (let batch = 0; batch < (opts.maxBatches ?? 4); batch++) {
    const budget = await store.budget();
    if (budget.remaining <= 0) {
      return { ...result, status: "budget_exhausted", message: "This month's AI token budget is used up." };
    }
    const candidates = await store.candidates(BATCH);
    if (!candidates.length) break;
    let progress = 0;

    // Tier 1: the business's own filing history answers what it can, with no outside call.
    let rest = candidates;
    if (store.vendorHistory) {
      const vendors = [...new Set(candidates.map((c) => c.vendor_normalized).filter((v): v is string => !!v))];
      const rows = vendors.length ? await store.vendorHistory(vendors) : [];
      const split = historySuggestions(ctx, candidates, rows);
      rest = split.rest;
      if (split.suggestions.length) {
        const key = requestKey(HISTORY_MODEL, ctx, candidates.filter((c) => split.suggestions.some((s) => s.transaction_id === c.id)));
        if (!(await store.requestDone(key))) {
          progress += await record(key, { suggestions: split.suggestions, inputTokens: 0, outputTokens: 0, refused: false, model: HISTORY_MODEL }, HISTORY_VERSION, 0);
        }
      }
    }

    // Tier 1b: well-known merchants with an unambiguous category.
    {
      const split = knownSuggestions(ctx, rest);
      rest = split.rest;
      if (split.suggestions.length) {
        const key = requestKey(KNOWN_MODEL, ctx, candidates.filter((c) => split.suggestions.some((s) => s.transaction_id === c.id)));
        if (!(await store.requestDone(key))) {
          progress += await record(key, { suggestions: split.suggestions, inputTokens: 0, outputTokens: 0, refused: false, model: KNOWN_MODEL }, KNOWN_VERSION, 0);
        }
      }
    }

    // Tier 2: the model, for everything history and known merchants couldn't answer.
    if (rest.length) {
      const key = requestKey(model, ctx, rest);
      // Already asked (e.g. a retried job): don't pay for it twice.
      if (await store.requestDone(key)) break;
      const started = now();
      let answer: Answer;
      try {
        answer = useJev
          ? await askJev(deps as EngineDeps & { jev: JevClient }, ctx, model, rest)
          : await askAnthropic(deps as EngineDeps & { client: AiClient }, ctx, model as AiModel, rest);
      } catch (e) {
        log("ai: batch failed", { error: e instanceof Error ? e.message : String(e) });
        return { ...result, status: "failed", message: "Suggestions are unavailable right now. Try again later." };
      }
      progress += await record(key, answer, promptVersion, now() - started);
      if (answer.refused) return { ...result, status: "refused", message: "The model declined this batch." };
    }
    // Nothing usable came back: stop rather than ask about the same rows again.
    if (!progress) break;
  }
  return result;
}

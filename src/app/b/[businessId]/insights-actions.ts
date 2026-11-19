"use server";

import { refresh } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAiState, getBusiness, getSupabase } from "@/lib/dal";
import { getInsightsData } from "@/lib/dal-insights";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { callWithBackoff } from "@/lib/ai/engine";
import { EXPLAIN_PROMPT_VERSION, buildExplainRequest, readExplanation } from "@/lib/ai/explain";
import { serverEnv } from "@/lib/env/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const range = z.object({ from: z.iso.date(), to: z.iso.date() }).refine((r) => r.from <= r.to);

/** Summarize a period with Claude from aggregates only, or return the cached summary. */
export async function explainPeriod(businessId: string, from: string, to: string): Promise<Result<{ summary: string; cached: boolean }>> {
  const { canWrite } = await getBusiness(businessId);
  if (!canWrite) return { ok: false, error: "Only owners and editors can ask for an explanation." };
  if (!range.safeParse({ from, to }).success) return { ok: false, error: "Pick a valid period." };
  if (!(await allowForUser(LIMITS.aiPerUser))) return { ok: false, error: TOO_MANY };
  const data = await getInsightsData(businessId, from, to);
  if (!data.business.ai_enabled) return { ok: false, error: "AI features are off. An owner can turn them on in Settings." };
  if (data.explanation && !data.explanation.stale) return { ok: true, summary: data.explanation.summary, cached: true };
  const ai = await getAiState(businessId);
  if (ai.exhausted) return { ok: false, error: "This month's AI token budget is used up." };

  const supabase = await getSupabase();
  const started = Date.now();
  let summary: string | null = null;
  let usage = { input: 0, output: 0 };
  try {
    const client = new Anthropic({ apiKey: serverEnv.anthropicApiKey, maxRetries: 0 });
    const message = await callWithBackoff({ client }, buildExplainRequest(data.model, data.aggregates));
    usage = {
      input: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      output: message.usage.output_tokens,
    };
    summary = readExplanation(message);
  } catch (e) {
    console.error("explainPeriod failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "The explanation is unavailable right now. Try again later." };
  }
  const { error } = await supabase.rpc("record_ai_explanation", {
    p_business_id: businessId, p_from: from, p_to: to, p_input_hash: data.hash, p_summary: summary ?? "",
    p_model: data.model, p_prompt_version: EXPLAIN_PROMPT_VERSION,
    p_input_tokens: usage.input, p_output_tokens: usage.output, p_latency_ms: Date.now() - started,
  });
  if (error) return { ok: false, error: error.message };
  if (!summary) return { ok: false, error: "No explanation came back for this period." };
  refresh();
  return { ok: true, summary, cached: false };
}

// Wiring for the app: the Supabase store (as the signed-in user, so RLS and role checks
// apply) and the real SDK client. Server only: the API key never leaves the server.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { serverEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { suggestCategories, type AiStore, type EngineDeps, type RunResult } from "./engine";
import type { VendorHistoryRow } from "./history";
import type { JevClient } from "./jev";
import type { AiCandidate, AiContext } from "./prompt";

type Supabase = Awaited<ReturnType<typeof createClient>>;

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export function supabaseStore(db: Supabase, businessId: string): AiStore {
  return {
    async context() {
      return must(await db.rpc("ai_context", { p_business_id: businessId })) as unknown as AiContext;
    },
    async budget() {
      const b = must(await db.rpc("ai_budget", { p_business_id: businessId }))?.[0];
      return { used: Number(b?.used ?? 0), budget: Number(b?.budget ?? 0), remaining: Number(b?.remaining ?? 0) };
    },
    async candidates(limit) {
      return must(await db.rpc("ai_candidates", { p_business_id: businessId, p_limit: limit })) as AiCandidate[];
    },
    async requestDone(key) {
      return !!must(await db.rpc("ai_request_done", { p_business_id: businessId, p_request_key: key }));
    },
    async vendorHistory(vendors) {
      return (must(await db.rpc("ai_vendor_history", { p_business_id: businessId, p_vendors: vendors })) ?? []) as VendorHistoryRow[];
    },
    async record(r) {
      return must(await db.rpc("record_ai_suggestions", {
        p_business_id: businessId, p_request_key: r.requestKey, p_model: r.model, p_prompt_version: r.promptVersion,
        p_latency_ms: r.latencyMs, p_input_tokens: r.inputTokens, p_output_tokens: r.outputTokens,
        p_suggestions: r.suggestions as unknown as Json,
      })) as unknown as { inserted: number; skipped: number; auto_applied: number };
    },
  };
}

/** Run suggestions for a business as the current user. Never throws; returns a status. */
export async function runSuggestions(businessId: string, maxBatches = 4): Promise<RunResult> {
  try {
    const db = await createClient();
    const provider: Pick<EngineDeps, "client" | "jev" | "jevModel"> = serverEnv.aiProvider === "jev"
      // Jev: the SDK retries 408/429/5xx with backoff; 15s per attempt.
      ? { jev: new TypeSafeClient({ apiKey: serverEnv.typesafeApiKey, timeout: 15_000 }) as unknown as JevClient, jevModel: serverEnv.jevModel }
      // Anthropic: the SDK's own retries are off; callWithBackoff owns backoff, so it's tested and logged.
      : { client: new Anthropic({ apiKey: serverEnv.anthropicApiKey, maxRetries: 0 }) };
    const result = await suggestCategories({
      store: supabaseStore(db, businessId),
      ...provider,
      defaultModel: serverEnv.anthropicModel,
      log: (msg, data) => console.info(msg, JSON.stringify({ businessId, ...data })),
    }, { maxBatches });
    // File the confident ones (unflagged, 0.9+, or vendor history) so people only see the rest.
    const filed = await db.rpc("auto_file_suggestions", { p_business_id: businessId });
    if (filed.error) console.error("auto-file failed:", filed.error.message);
    return { ...result, autoApplied: result.autoApplied + (filed.data ?? 0) };
  } catch (e) {
    console.error("ai suggestions failed:", e instanceof Error ? e.message : e);
    return { status: "failed", batches: 0, suggested: 0, autoApplied: 0, message: "Suggestions are unavailable right now." };
  }
}

/**
 * Ask for suggestions in the background when uncategorized rows have none (after a re-score, a
 * failed run, or rows added by hand). At most once every 2 minutes per business, so page loads
 * don't stack runs.
 */
export async function maybeRunSuggestions(businessId: string) {
  try {
    const db = await createClient();
    const { data: last } = await db.from("ai_suggestions").select("created_at").eq("business_id", businessId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.created_at) < 120_000) return;
    await runSuggestions(businessId, 2);
  } catch (e) {
    console.error("background suggestions failed:", e instanceof Error ? e.message : e);
  }
}

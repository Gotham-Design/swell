"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { runSuggestions } from "@/lib/ai/run";
import { fileMatchingFor, type Matched } from "./actions";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_ALLOWED = { ok: false as const, error: "Only owners and editors can decide suggestions." };
const uuid = z.uuid();
const pct = z.number().int().min(50).max(100);

async function writer(businessId: string) {
  return (await getBusiness(businessId)).canWrite;
}

/** Accept one suggestion, and file the vendor's other rows the same way. */
export async function acceptSuggestion(businessId: string, suggestionId: string): Promise<Result<{ matched: Matched | null }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!uuid.safeParse(suggestionId).success) return { ok: false, error: "Suggestion not found." };
  const supabase = await getSupabase();
  const { data: s } = await supabase.from("ai_suggestions").select("transaction_id, category_account_id")
    .eq("id", suggestionId).eq("business_id", businessId).maybeSingle();
  const { error } = await supabase.rpc("accept_ai_suggestion", { p_suggestion_id: suggestionId });
  if (error) return { ok: false, error: error.message };
  const matched = s ? await fileMatchingFor(businessId, s.transaction_id, s.category_account_id) : null;
  refresh();
  return { ok: true, matched };
}

export async function rejectSuggestion(businessId: string, suggestionId: string): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!uuid.safeParse(suggestionId).success) return { ok: false, error: "Suggestion not found." };
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("reject_ai_suggestion", { p_suggestion_id: suggestionId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** How many pending suggestions are at or above `percent` (the preview for bulk accept). */
export async function countSuggestionsAbove(businessId: string, percent: number): Promise<Result<{ count: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!pct.safeParse(percent).success) return { ok: false, error: "Pick a percentage." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("count_ai_suggestions_above", { p_business_id: businessId, p_min_confidence: percent / 100 });
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data ?? 0 };
}

export async function acceptSuggestionsAbove(businessId: string, percent: number, expected: number): Promise<Result<{ count: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!pct.safeParse(percent).success) return { ok: false, error: "Pick a percentage." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("accept_ai_suggestions_above", {
    p_business_id: businessId, p_min_confidence: percent / 100, p_expected_count: expected,
  });
  if (error) return { ok: false, error: error.message };
  // Accepted suggestions are people's choices: let them turn into rules now.
  const patterns = await supabase.rpc("refresh_patterns", { p_business_id: businessId });
  if (patterns.error) console.error("refresh_patterns after bulk accept failed:", patterns.error.message);
  refresh();
  return { ok: true, count: data ?? 0 };
}

export interface QueueItem {
  id: string; transaction_id: string; category_account_id: string; category_name: string; confidence: number;
  reason: string | null; flags: string[]; date: string; description: string; amount_cents: number; money_account_id: string;
}

/** Pending suggestions, oldest first, for "Review suggestions". */
export async function listSuggestionQueue(businessId: string): Promise<Result<{ items: QueueItem[] }>> {
  await getBusiness(businessId);
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("ai_suggestion_queue")
    .select("id, transaction_id, category_account_id, category_name, confidence, reason, flags, date, description_raw, description_clean, amount_cents, money_account_id")
    .eq("business_id", businessId).order("date").order("id").limit(200);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    items: data.map((s) => ({
      id: s.id!, transaction_id: s.transaction_id!, category_account_id: s.category_account_id!, category_name: s.category_name ?? "",
      confidence: Number(s.confidence), reason: s.reason, flags: s.flags ?? [], date: s.date!,
      description: s.description_clean ?? s.description_raw ?? "", amount_cents: Number(s.amount_cents), money_account_id: s.money_account_id!,
    })),
  };
}

/** Ask for suggestions now (up to 2 batches of 50). */
export async function getSuggestionsNow(businessId: string): Promise<Result<{ message: string }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!(await allowForUser(LIMITS.aiPerUser))) return { ok: false, error: TOO_MANY };
  const r = await runSuggestions(businessId, 2);
  refresh();
  switch (r.status) {
    case "disabled": return { ok: false, error: "AI suggestions are off. An owner can turn them on in Settings." };
    case "budget_exhausted": if (!r.batches) return { ok: false, error: r.message ?? "This month's AI budget is used up." }; break;
    case "failed": case "refused": return { ok: false, error: r.message ?? "Suggestions are unavailable right now." };
  }
  if (r.status === "nothing_to_do") return { ok: true, message: "Nothing new to suggest." };
  const n = r.suggested + r.autoApplied;
  return { ok: true, message: `${n} suggestion${n === 1 ? "" : "s"} ready${r.autoApplied ? ` (${r.autoApplied} applied automatically)` : ""}` };
}

/** Accept the pending suggestions on the selected rows (the bulk bar's "Accept N suggestions"). */
export async function acceptSuggestions(businessId: string, suggestionIds: string[]): Promise<Result<{ count: number; failed: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const ids = suggestionIds.filter((id) => uuid.safeParse(id).success).slice(0, 500);
  const supabase = await getSupabase();
  let count = 0;
  let failed = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc("accept_ai_suggestion", { p_suggestion_id: id });
    if (error) failed++;
    else count++;
  }
  if (count) {
    const patterns = await supabase.rpc("refresh_patterns", { p_business_id: businessId });
    if (patterns.error) console.error("refresh_patterns after accept failed:", patterns.error.message);
  }
  refresh();
  return { ok: true, count, failed };
}

/** File every pending suggestion that's confident enough (0.9+, unflagged, or vendor history). */
export async function fileConfidentNow(businessId: string): Promise<Result<{ message: string }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("auto_file_suggestions", { p_business_id: businessId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: data ? `Filed ${data} transaction${data === 1 ? "" : "s"} automatically` : "Nothing confident enough to file. The rest need a look." };
}

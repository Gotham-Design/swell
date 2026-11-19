"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import { getTransferCandidates, type TransferCandidates } from "@/lib/dal-transfers";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_ALLOWED = { ok: false as const, error: "Only owners and editors can match transfers." };
const id = z.uuid();

async function writer(businessId: string) {
  return (await getBusiness(businessId)).canWrite;
}

/** Pairs to confirm and one-sided transfers to file, for the review panel. */
export async function loadTransferCandidates(businessId: string): Promise<Result<{ candidates: TransferCandidates }>> {
  try {
    return { ok: true, candidates: await getTransferCandidates(businessId) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't load transfers." };
  }
}

/** Confirm pairs (one or many): each counts once, through Transfer Clearing. */
export async function confirmTransfers(businessId: string, pairs: { outId: string; inId: string }[]): Promise<Result<{ matched: number; failed: number }>> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const valid = pairs.filter((p) => id.safeParse(p.outId).success && id.safeParse(p.inId).success).slice(0, 200);
  const supabase = await getSupabase();
  let matched = 0;
  let failed = 0;
  let lastError = "";
  for (const p of valid) {
    const { error } = await supabase.rpc("confirm_transfer_match", { p_out_transaction_id: p.outId, p_in_transaction_id: p.inId });
    if (error) { failed++; lastError = error.message; } else matched++;
  }
  refresh();
  if (!matched && failed) return { ok: false, error: lastError };
  return { ok: true, matched, failed };
}

export async function unmatchTransfer(businessId: string, matchId: string): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!id.safeParse(matchId).success) return { ok: false, error: "Match not found." };
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("unmatch_transfer", { p_match_id: matchId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** "Not a match" for a pair, or "not a transfer" for one side. */
export async function dismissTransfer(businessId: string, outId: string, inId?: string): Promise<Result> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  if (!id.safeParse(outId).success || (inId && !id.safeParse(inId).success)) return { ok: false, error: "Transaction not found." };
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("dismiss_transfer_candidate", { p_out_transaction_id: outId, p_in_transaction_id: inId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

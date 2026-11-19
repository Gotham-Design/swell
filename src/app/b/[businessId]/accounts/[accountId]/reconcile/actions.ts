"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase } from "@/lib/dal";
import { tryParseCents } from "@/lib/money";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_ALLOWED = { ok: false as const, error: "Only owners and editors can reconcile." };
const uuid = z.uuid();

/** Start (or update) the open reconciliation from the statement's date and ending balance. */
export async function startReconciliation(businessId: string, accountId: string, date: string, balance: string): Promise<Result<{ id: string }>> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Money account not found." };
  if (!z.iso.date().safeParse(date).success) return { ok: false, error: "Enter the statement date." };
  const cents = tryParseCents(balance);
  if (cents === null) return { ok: false, error: "Enter the statement's ending balance, like 1,234.56." };
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc("start_reconciliation", {
    p_money_account_id: accountId, p_statement_date: date, p_statement_balance_cents: cents,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id: data };
}

export async function setCleared(businessId: string, reconciliationId: string, transactionIds: string[], cleared: boolean): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  if (!uuid.safeParse(reconciliationId).success || !transactionIds.every((t) => uuid.safeParse(t).success)) {
    return { ok: false, error: "Transaction not found." };
  }
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_reconciliation_cleared", {
    p_reconciliation_id: reconciliationId, p_transaction_ids: transactionIds, p_cleared: cleared,
  });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function finishReconciliation(businessId: string, reconciliationId: string): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("finish_reconciliation", { p_reconciliation_id: reconciliationId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function discardReconciliation(businessId: string, reconciliationId: string): Promise<Result> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("discard_reconciliation", { p_reconciliation_id: reconciliationId });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

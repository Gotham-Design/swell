"use server";

import { refresh } from "next/cache";
import { getBusiness, getMoneyAccounts, getSupabase } from "@/lib/dal";
import { formatCents } from "@/lib/money";
import { parseForm, type FormState } from "@/lib/validation/business";
import { moneyAccountCreateSchema, moneyAccountEditSchema } from "@/lib/validation/accounts";

const NOT_ALLOWED: FormState = { error: "Only owners and editors can manage money accounts." };

function friendly(error: { code?: string; message: string; hint?: string }, name: string): FormState {
  if (error.code === "23505") {
    return { fieldErrors: { name: [`There's already an account named "${name}". Try something like "Chase ${name}".`] } };
  }
  if (error.hint === "locked_period") return { fieldErrors: { opening_date: [error.message] } };
  return { error: error.message };
}

export async function createMoneyAccount(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  const parsed = parseForm(moneyAccountCreateSchema, formData);
  if (parsed.state) return parsed.state;
  const v = parsed.data;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("create_money_account", {
    p_business_id: businessId,
    p_name: v.name,
    p_kind: v.kind,
    p_last4: v.last4 ?? undefined,
    p_opening_balance_cents: v.opening_balance,
    p_opening_date: v.opening_date ?? undefined,
  });
  if (error) return friendly(error, v.name);
  refresh();
  return { ok: true, message: `Added ${v.name}` };
}

export async function updateMoneyAccount(businessId: string, accountId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  const parsed = parseForm(moneyAccountEditSchema, formData);
  if (parsed.state) return parsed.state;
  const v = parsed.data;
  const current = (await getMoneyAccounts(businessId)).find((a) => a.id === accountId);
  if (!current) return { error: "Account not found." };

  const supabase = await getSupabase();
  const { error } = await supabase.from("accounts").update({ name: v.name, last4: v.last4 })
    .eq("id", accountId).eq("business_id", businessId);
  if (error) return friendly(error, v.name);

  // Only repost the opening balance when it actually changed (each change is audited).
  if (v.opening_balance !== current.opening_balance_cents || (v.opening_balance !== 0 && v.opening_date !== current.opening_date)) {
    const { error: obError } = await supabase.rpc("set_opening_balance", {
      p_account_id: accountId,
      p_balance_cents: v.opening_balance,
      // The date only matters when there's a balance; clearing keeps whatever it was.
      p_date: v.opening_date ?? current.opening_date ?? new Date().toISOString().slice(0, 10),
    });
    if (obError) return friendly(obError, v.name);
  }
  refresh();
  return { ok: true, message: v.opening_balance !== current.opening_balance_cents
    ? `Saved. Opening balance is now ${formatCents(v.opening_balance)}.` : "Saved" };
}

/** Archive (or restore) a money account: it leaves pickers and the overview, its history stays. */
export async function setMoneyAccountArchived(businessId: string, accountId: string, archived: boolean): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", accountId).eq("business_id", businessId).eq("is_money_account", true).select("name");
  if (error) return { error: error.message };
  if (!data.length) return { error: "That account wasn't found." };
  refresh();
  return { ok: true, message: archived ? `Archived ${data[0].name}` : `Restored ${data[0].name}` };
}

"use server";

import { redirect } from "next/navigation";
import { getSupabase, getUser } from "@/lib/dal";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { STARTERS } from "@/lib/onboarding/starters";
import { newBusinessSchema, parseForm, type FormState } from "@/lib/validation/business";

/**
 * Create the business (the caller becomes owner; the standard chart is seeded), set its
 * industry and add that industry's extra categories, create the first money account, then
 * go straight to importing its first statement.
 */
export async function createBusiness(_prev: FormState, formData: FormData): Promise<FormState> {
  await getUser();
  const parsed = parseForm(newBusinessSchema, formData);
  if (parsed.state) return parsed.state;
  if (!(await allowForUser(LIMITS.createBusinessPerUser))) return { error: TOO_MANY };
  const v = parsed.data;

  const supabase = await getSupabase();
  const { data: id, error } = await supabase.rpc("create_business", {
    p_name: v.name, p_fiscal_year_start_month: v.fiscal_year_start_month,
  });
  if (error) return { error: error.message };

  if (v.industry) {
    await supabase.from("businesses").update({ industry: v.industry }).eq("id", id);
    const extras = STARTERS[v.industry].extras;
    if (extras.length) {
      // Skip any name the standard chart already has (names are unique per business).
      const { data: existing } = await supabase.from("accounts").select("name").eq("business_id", id);
      const taken = new Set((existing ?? []).map((a) => a.name.toLowerCase()));
      const rows = extras.filter((x) => !taken.has(x.name.toLowerCase()))
        .map((x) => ({ business_id: id, name: x.name, type: x.type, description: x.description }));
      if (rows.length) await supabase.from("accounts").insert(rows);
    }
  }

  const { data: accountId, error: accountError } = await supabase.rpc("create_money_account", {
    p_business_id: id, p_name: v.account_name, p_kind: v.account_kind, p_opening_balance_cents: 0,
  });
  // The business exists either way; without the account, land on Money accounts to add one.
  if (accountError || !accountId) redirect(`/b/${id}/accounts`);
  redirect(`/b/${id}/import?account=${accountId}`);
}

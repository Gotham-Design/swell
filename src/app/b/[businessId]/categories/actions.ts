"use server";

import { refresh } from "next/cache";
import { getBusiness, getSupabase } from "@/lib/dal";
import { parseForm, type FormState } from "@/lib/validation/business";
import { categoryCreateSchema, categoryEditSchema, mergeSchema } from "@/lib/validation/accounts";

const NOT_ALLOWED: FormState = { error: "Only owners and editors can change categories." };

function friendly(error: { code?: string; message: string }, name?: string): FormState {
  if (error.code === "23505") return { fieldErrors: { name: [`There's already an account named "${name}".`] } };
  return { error: error.message };
}

async function writer(businessId: string) {
  const ctx = await getBusiness(businessId);
  return ctx.canWrite ? ctx : null;
}

/** Point a category at a line of the business's tax form, or clear it. */
async function saveTaxLine(businessId: string, form: string | null, accountId: string, taxLineId: string | null): Promise<FormState | null> {
  if (!form) return null;
  const supabase = await getSupabase();
  const { error } = taxLineId
    ? await supabase.from("account_tax_lines").upsert(
        { business_id: businessId, account_id: accountId, form, tax_line_id: taxLineId },
        { onConflict: "account_id,form" })
    : await supabase.from("account_tax_lines").delete().eq("account_id", accountId).eq("form", form);
  return error ? { fieldErrors: { tax_line_id: [error.message] } } : null;
}

export async function createCategory(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const parsed = parseForm(categoryCreateSchema, formData);
  if (parsed.state) return parsed.state;
  const { tax_line_id, ...values } = parsed.data;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").insert({ business_id: businessId, ...values }).select("id").single();
  if (error) return friendly(error, values.name);
  const taxError = await saveTaxLine(businessId, ctx.business.tax_form, data.id, tax_line_id);
  refresh();
  if (taxError) return taxError;
  return { ok: true, message: `Added ${values.name}` };
}

export async function updateCategory(businessId: string, accountId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await writer(businessId);
  if (!ctx) return NOT_ALLOWED;
  const parsed = parseForm(categoryEditSchema, formData);
  if (parsed.state) return parsed.state;
  const { tax_line_id, ...values } = parsed.data;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").update(values)
    .eq("id", accountId).eq("business_id", businessId).select("id");
  if (error) return friendly(error, values.name);
  if (!data.length) return { error: "System accounts can't be edited." };
  // Tax lines are hidden in the MVP: the form leaves the field out, and the mapping stays as it was.
  const taxError = formData.has("tax_line_id") ? await saveTaxLine(businessId, ctx.business.tax_form, accountId, tax_line_id) : null;
  refresh();
  if (taxError) return taxError;
  return { ok: true, message: "Saved" };
}

export async function setArchived(businessId: string, accountId: string, archived: boolean): Promise<FormState> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", accountId).eq("business_id", businessId).select("name");
  if (error) return { error: error.message };
  if (!data.length) return { error: "System accounts can't be archived." };
  refresh();
  return { ok: true, message: archived ? `Archived ${data[0].name}` : `Restored ${data[0].name}` };
}

export async function deleteCategory(businessId: string, accountId: string): Promise<FormState> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("accounts").delete()
    .eq("id", accountId).eq("business_id", businessId).select("name");
  if (error?.code === "23503") return { error: "It's in use. Archive it instead, or merge it into another category." };
  if (error) return { error: error.message };
  if (!data.length) return { error: "System accounts can't be deleted." };
  refresh();
  return { ok: true, message: `Deleted ${data[0].name}` };
}

export async function mergeCategory(businessId: string, fromId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await writer(businessId))) return NOT_ALLOWED;
  const parsed = parseForm(mergeSchema, formData);
  if (parsed.state) return parsed.state;
  const supabase = await getSupabase();
  const { data: moved, error } = await supabase.rpc("merge_category", { p_from: fromId, p_into: parsed.data.into });
  if (error) return { error: error.message };
  refresh();
  return { ok: true, message: `Merged. ${moved} transaction${moved === 1 ? "" : "s"} moved.` };
}

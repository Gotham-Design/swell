"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getBusiness, getSupabase } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";
import {
  aiSchema, aiSettingsSchema, businessSchema, settingsSchema, largeThresholdSchema, lockDateSchema, parseForm, type FormState,
} from "@/lib/validation/business";

const OWNERS_ONLY: FormState = { error: "Only owners can change business settings." };

// Every action re-checks membership itself; the UI hiding a form proves nothing.
async function asOwner(businessId: string) {
  const ctx = await getBusiness(businessId);
  return ctx.canManage ? ctx : null;
}

async function updateBusinessRow(businessId: string, values: Database["public"]["Tables"]["businesses"]["Update"]): Promise<FormState> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("businesses").update(values).eq("id", businessId).select("id");
  if (error) return { error: error.message };
  if (!data.length) return OWNERS_ONLY; // RLS filtered the row out
  refresh();
  return { ok: true, message: "Saved" };
}

export async function updateBusiness(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(businessSchema, formData);
  if (parsed.state) return parsed.state;
  return updateBusinessRow(businessId, parsed.data);
}

export async function updateLockDate(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(lockDateSchema, formData);
  if (parsed.state) return parsed.state;
  const result = await updateBusinessRow(businessId, parsed.data);
  if (result.ok) result.message = parsed.data.lock_date ? "Books locked" : "Lock removed";
  return result;
}

export async function updateLargeThreshold(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(largeThresholdSchema, formData);
  if (parsed.state) return parsed.state;
  const result = await updateBusinessRow(businessId, { large_threshold_cents: parsed.data.large_threshold });
  if (result.ok) result.message = parsed.data.large_threshold ? "Threshold saved" : "Threshold removed";
  return result;
}

export async function updateAiSettings(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(aiSettingsSchema, formData);
  if (parsed.state) return parsed.state;
  const result = await updateBusinessRow(businessId, parsed.data);
  if (result.ok) result.message = "AI settings saved";
  return result;
}

export async function updateAi(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(aiSchema, formData);
  if (parsed.state) return parsed.state;
  const result = await updateBusinessRow(businessId, parsed.data);
  if (result.ok) result.message = parsed.data.ai_enabled ? "AI features on" : "AI features off";
  return result;
}

/** The settings page's "Save changes": business details and books in one write. */
export async function saveSettings(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const parsed = parseForm(settingsSchema, formData);
  if (parsed.state) return parsed.state;
  const result = await updateBusinessRow(businessId, parsed.data);
  if (result.ok) result.message = "Changes saved";
  return result;
}

/** Archive (hide from the switcher) or restore. Archiving goes back to "/", which picks another business. */
export async function setBusinessArchived(businessId: string, archived: boolean): Promise<FormState> {
  if (!(await asOwner(businessId))) return OWNERS_ONLY;
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("set_business_archived", { p_business_id: businessId, p_archived: archived });
  if (error) return { error: error.message };
  if (archived) redirect("/");
  refresh();
  return { ok: true, message: "Business restored" };
}

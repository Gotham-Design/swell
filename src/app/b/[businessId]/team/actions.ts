"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBusiness, getSupabase, getUser } from "@/lib/dal";
import { publicEnv } from "@/lib/env/public";
import type { Database } from "@/lib/supabase/database.types";
import { parseForm, type FormState } from "@/lib/validation/business";
import { firmNameSchema, teamAccessSchema, teamInviteSchema } from "@/lib/validation/team";
import { allow, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";

/** The firm the current client belongs to (membership re-checked by RLS and the functions). */
async function firmOf(businessId: string) {
  const { business } = await getBusiness(businessId);
  if (!business.firm_id) throw new Error("This client isn't in a firm.");
  return { firmId: business.firm_id, supabase: await getSupabase() };
}
const guard = async (fn: () => Promise<FormState>): Promise<FormState> => {
  try { return await fn(); } catch (e) { return { error: e instanceof Error ? e.message : "That didn't work." }; }
};
const accessFrom = (formData: FormData) => ({
  role: formData.get("role"), clients: formData.get("clients") ?? "all", client_role: formData.get("client_role") ?? "editor",
  business_ids: formData.getAll("business_ids").map(String),
});

export async function inviteToTeam(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { firmId, supabase } = await firmOf(businessId);
    const v = teamInviteSchema.safeParse({ email: formData.get("email") ?? "", ...accessFrom(formData) });
    if (!v.success) return { fieldErrors: z.flattenError(v.error).fieldErrors as FormState["fieldErrors"] };
    const { email, role, clients, client_role, business_ids } = v.data;
    if (!(await allow(LIMITS.invitePerUser, (await getUser()).id))) return { error: TOO_MANY };
    const { error } = await supabase.rpc("invite_firm_member", {
      p_firm_id: firmId, p_email: email, p_role: role, p_all_clients: clients === "all", p_client_role: client_role, p_business_ids: business_ids,
    });
    if (error) return { error: error.message };
    // The sign-in link goes from a session-less client, so the admin's own session isn't touched.
    // Signing in with that email accepts the invite.
    const origin = (await headers()).get("origin") ?? "";
    const mailer = createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: mailError } = await mailer.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm` } });
    refresh();
    if (mailError) return { error: `Invite saved, but the email didn't send (${mailError.message}). They can still sign in with ${email} to join.` };
    return { ok: true, message: `Invited ${email}` };
  });
}

export async function updateTeamMember(businessId: string, userId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { firmId, supabase } = await firmOf(businessId);
    const r = teamAccessSchema.safeParse(accessFrom(formData));
    if (!r.success) return { fieldErrors: z.flattenError(r.error).fieldErrors as FormState["fieldErrors"] };
    const v = r.data;
    const { error } = await supabase.rpc("update_firm_member", {
      p_firm_id: firmId, p_user_id: userId, p_role: v.role, p_all_clients: v.clients === "all", p_client_role: v.client_role, p_business_ids: v.business_ids,
    });
    if (error) return { error: error.message };
    refresh();
    return { ok: true, message: "Access updated" };
  });
}

export async function removeTeamMember(businessId: string, userId: string): Promise<FormState> {
  return guard(async () => {
    const { firmId, supabase } = await firmOf(businessId);
    const { error } = await supabase.rpc("remove_firm_member", { p_firm_id: firmId, p_user_id: userId });
    if (error) return { error: error.message };
    refresh();
    return { ok: true, message: "Removed from the team" };
  });
}

export async function cancelTeamInvite(businessId: string, inviteId: string): Promise<FormState> {
  return guard(async () => {
    const { supabase } = await firmOf(businessId);
    const { error } = await supabase.rpc("cancel_firm_invite", { p_invite_id: inviteId });
    if (error) return { error: error.message };
    refresh();
    return { ok: true, message: "Invite cancelled" };
  });
}

export async function renameFirm(businessId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return guard(async () => {
    const { firmId, supabase } = await firmOf(businessId);
    const { data: v, state } = parseForm(firmNameSchema, formData);
    if (state) return state;
    const { error } = await supabase.rpc("rename_firm", { p_firm_id: firmId, p_name: v.name });
    if (error) return { error: error.message };
    refresh();
    return { ok: true, message: "Saved" };
  });
}

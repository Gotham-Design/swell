"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { getBusiness, getSupabase, getUser } from "@/lib/dal";
import { allowForUser, LIMITS, TOO_MANY } from "@/lib/security/rate-limit";
import { newRequestToken } from "@/lib/requests/token";
import { addDaysIso, nextDay, monthLabel, previousMonth } from "@/lib/requests/schedule";
import { sendEmail, statementRequestEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env/server";
import type { FormState } from "@/lib/validation/business";

const BUCKET = "client-statements";

const requestSchema = z.object({
  from_name: z.string().trim().min(1, "Say who's asking, e.g. Jordan at Mainland Bookkeeping").max(120),
  note: z.string().trim().max(1000).transform((v) => v || null),
  days: z.coerce.number().int().refine((d) => [7, 14, 30].includes(d), "Pick how long the link stays open"),
  account_ids: z.array(z.uuid()).max(20),
  repeat: z.boolean(),
  email_now: z.boolean(),
  client_email: z.string().trim().max(254),
  day_of_month: z.coerce.number().int().min(1).max(28),
}).superRefine((v, ctx) => {
  if ((v.repeat || v.email_now) && !z.email().safeParse(v.client_email).success) {
    ctx.addIssue({ code: "custom", path: ["client_email"], message: "Enter your client's email" });
  }
});

export type RequestState = FormState & { url?: string; expiresAt?: string; emailed?: string; repeatDay?: number };

/** Make a private upload link for this client. The link is returned once; only its hash is kept. */
export async function createStatementRequest(businessId: string, _prev: RequestState, formData: FormData): Promise<RequestState> {
  const { business, canWrite } = await getBusiness(businessId);
  if (!canWrite) return { error: "Only owners and editors can request statements." };
  if (!(await allowForUser(LIMITS.requestEmailPerUser))) return { error: TOO_MANY };
  const parsed = requestSchema.safeParse({
    from_name: formData.get("from_name") ?? "", note: formData.get("note") ?? "", days: formData.get("days") ?? 14,
    account_ids: formData.getAll("account_ids").map(String),
    repeat: formData.get("repeat") === "on", email_now: formData.get("email_now") === "on",
    client_email: formData.get("client_email") ?? "", day_of_month: formData.get("day_of_month") ?? 5,
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors as FormState["fieldErrors"] };
  const v = parsed.data;
  const { token, hash } = newRequestToken();
  const expiresAt = new Date(Date.now() + v.days * 86_400_000).toISOString();
  const supabase = await getSupabase();
  const { error } = await supabase.from("statement_requests").insert({
    business_id: business.id, token_hash: hash, from_name: v.from_name, note: v.note, account_ids: v.account_ids, expires_at: expiresAt,
  });
  if (error) return { error: error.message };
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const url = `${origin}/r/${token}`;
  if (v.repeat) {
    // The first one is this link; the schedule starts with next month's day.
    const today = new Date().toISOString().slice(0, 10);
    const { error: sErr } = await supabase.from("statement_schedules").insert({
      business_id: business.id, client_email: v.client_email, from_name: v.from_name, note: v.note, account_ids: v.account_ids,
      day_of_month: v.day_of_month, next_send_on: nextDay(v.day_of_month, addDaysIso(today, 1)),
    });
    if (sErr) return { error: sErr.message };
  }
  let emailed: string | undefined;
  if (v.email_now && serverEnv.canSendEmail) {
    const user = await getUser();
    const { data: accts } = v.account_ids.length
      ? await supabase.from("accounts").select("name").in("id", v.account_ids).eq("business_id", business.id)
      : { data: [] as { name: string }[] };
    const mail = statementRequestEmail({
      businessName: business.name, fromName: v.from_name, month: monthLabel(previousMonth(new Date().toISOString().slice(0, 10))),
      url, until: new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" }), note: v.note,
      accounts: (accts ?? []).map((a) => a.name), reminder: false,
    });
    const sent = await sendEmail({ to: v.client_email, replyTo: user.email, ...mail });
    if (!sent.ok) return { ok: true, url, expiresAt, error: `The link is ready, but the email didn't go: ${sent.error}` };
    emailed = v.client_email;
  }
  refresh();
  return { ok: true, url, expiresAt, emailed, repeatDay: v.repeat ? v.day_of_month : undefined };
}

/** Pause or resume a monthly request. */
export async function setScheduleActive(businessId: string, scheduleId: string, active: boolean): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return { error: "Only owners and editors can change requests." };
  const supabase = await getSupabase();
  const patch: { active: boolean; next_send_on?: string } = { active };
  if (active) {
    const { data } = await supabase.from("statement_schedules").select("day_of_month").eq("id", scheduleId).maybeSingle();
    if (data) patch.next_send_on = nextDay(data.day_of_month, new Date().toISOString().slice(0, 10));
  }
  const { error } = await supabase.from("statement_schedules").update(patch).eq("id", scheduleId).eq("business_id", businessId);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, message: active ? "Monthly request back on" : "Monthly request paused" };
}

/** Stop a monthly request for good. */
export async function deleteSchedule(businessId: string, scheduleId: string): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return { error: "Only owners and editors can change requests." };
  const supabase = await getSupabase();
  const { error } = await supabase.from("statement_schedules").delete().eq("id", scheduleId).eq("business_id", businessId);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, message: "Monthly request stopped" };
}

/** Close a link early. Files already sent stay until imported or deleted. */
export async function revokeStatementRequest(businessId: string, requestId: string): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return { error: "Only owners and editors can change requests." };
  const supabase = await getSupabase();
  const { error } = await supabase.from("statement_requests").update({ revoked_at: new Date().toISOString() })
    .eq("id", requestId).eq("business_id", businessId).is("revoked_at", null);
  if (error) return { error: error.message };
  refresh();
  return { ok: true, message: "Link closed" };
}

/** Remove a file a client sent without importing it. */
export async function deleteClientUpload(businessId: string, uploadId: string): Promise<FormState> {
  if (!(await getBusiness(businessId)).canWrite) return { error: "Only owners and editors can delete files." };
  const supabase = await getSupabase();
  const { data: u } = await supabase.from("statement_uploads").select("id, storage_path")
    .eq("id", uploadId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
  if (!u) return { error: "That file is already gone." };
  const removed = await supabase.storage.from(BUCKET).remove([u.storage_path]);
  if (removed.error) return { error: removed.error.message };
  await supabase.from("statement_uploads").update({ deleted_at: new Date().toISOString() }).eq("id", u.id);
  refresh();
  return { ok: true, message: "File deleted" };
}

/** The name shown to clients: the last one this person used, else their email. */
export async function defaultFromName(businessId: string): Promise<string> {
  const user = await getUser();
  const supabase = await getSupabase();
  const { data } = await supabase.from("statement_requests").select("from_name").eq("created_by", user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  void businessId;
  return data?.from_name ?? user.email ?? "";
}

// The `statement-schedule` server job: emails every recurring request that's due today.
// Runs daily from Vercel Cron (src/app/api/cron/statement-requests/route.ts) with the
// service-role client, because no one is signed in.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { sendEmail, statementRequestEmail } from "@/lib/email/send";
import { newRequestToken } from "./token";
import { monthCovered, monthLabel, planRun } from "./schedule";

export interface RunReport { due: number; sent: number; skipped: number; failed: number }

export async function runDueSchedules(origin: string, today = new Date().toISOString().slice(0, 10)): Promise<RunReport> {
  const db = createAdminClient("statement-schedule");
  const report: RunReport = { due: 0, sent: 0, skipped: 0, failed: 0 };
  const { data: due, error } = await db.from("statement_schedules").select("*").eq("active", true).lte("next_send_on", today).limit(500);
  if (error) throw new Error(error.message);
  for (const s of due) {
    report.due++;
    try {
      const [{ data: biz }, { data: accounts }, { data: last }, uploads] = await Promise.all([
        db.from("businesses").select("name, archived_at").eq("id", s.business_id).single(),
        db.from("accounts").select("id, name, subtype, archived_at").eq("business_id", s.business_id).eq("is_money_account", true),
        db.from("money_account_last_import").select("money_account_id, last_statement_date").eq("business_id", s.business_id),
        s.last_request_id
          ? db.from("statement_uploads").select("id", { count: "exact", head: true }).eq("request_id", s.last_request_id)
          : Promise.resolve({ count: 0 }),
      ]);
      if (!biz || biz.archived_at) { await db.from("statement_schedules").update({ active: false }).eq("id", s.id); report.skipped++; continue; }
      const live = (accounts ?? []).filter((a) => !a.archived_at);
      const asked = s.account_ids.length ? live.filter((a) => s.account_ids.includes(a.id)) : live;
      const lastDate = new Map((last ?? []).map((l) => [l.money_account_id, l.last_statement_date]));
      const sentFiles = (uploads.count ?? 0) > 0;
      const plan = planRun(s, today, (period) =>
        monthCovered(period, asked.map((a) => lastDate.get(a.id) ?? null)) || (sentFiles && period === s.period_month));
      if (!plan) continue;
      if (!plan.send) {
        await db.from("statement_schedules").update({
          next_send_on: plan.next_send_on, period_month: plan.period_month, sends_in_period: plan.sends_in_period, last_error: null,
        }).eq("id", s.id);
        report.skipped++;
        continue;
      }
      if (!serverEnv.canSendEmail) {
        await db.from("statement_schedules").update({ last_error: "Email isn't set up yet, so nothing was sent." }).eq("id", s.id);
        report.failed++;
        continue;
      }
      const { token, hash } = newRequestToken();
      const expires = new Date(Date.now() + 14 * 86_400_000);
      const { data: req, error: reqError } = await db.from("statement_requests").insert({
        business_id: s.business_id, token_hash: hash, from_name: s.from_name, note: s.note, account_ids: asked.map((a) => a.id),
        expires_at: expires.toISOString(), created_by: s.created_by,
      }).select("id").single();
      if (reqError) throw new Error(reqError.message);
      const replyTo = s.created_by ? (await db.auth.admin.getUserById(s.created_by)).data.user?.email ?? null : null;
      const mail = statementRequestEmail({
        businessName: biz.name, fromName: s.from_name, month: monthLabel(plan.period), url: `${origin}/r/${token}`,
        until: expires.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }), note: s.note,
        accounts: asked.map((a) => a.name), reminder: s.sends_in_period > 0 && plan.period === s.period_month,
      });
      const sent = await sendEmail({ to: s.client_email, replyTo, ...mail });
      if (!sent.ok) {
        await db.from("statement_requests").update({ revoked_at: new Date().toISOString() }).eq("id", req.id);
        await db.from("statement_schedules").update({ last_error: sent.error }).eq("id", s.id);
        report.failed++;
        continue;
      }
      await db.from("statement_schedules").update({
        next_send_on: plan.next_send_on, period_month: plan.period_month, sends_in_period: plan.sends_in_period,
        last_sent_at: new Date().toISOString(), last_request_id: req.id, last_error: null,
      }).eq("id", s.id);
      report.sent++;
    } catch (e) {
      await db.from("statement_schedules").update({ last_error: e instanceof Error ? e.message.slice(0, 500) : "Something went wrong" }).eq("id", s.id);
      report.failed++;
    }
  }
  return report;
}

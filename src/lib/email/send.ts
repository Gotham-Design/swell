// App emails through Resend's HTTP API (no SDK). Server only.
import "server-only";
import { serverEnv } from "@/lib/env/server";

export interface Email { to: string; subject: string; text: string; html: string; replyTo?: string | null }

export async function sendEmail(e: Email): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = serverEnv.resendApiKey;
  const from = serverEnv.emailFrom;
  if (!key || !from) return { ok: false, error: "Email isn't set up (RESEND_API_KEY and EMAIL_FROM)." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [e.to], subject: e.subject, text: e.text, html: e.html, ...(e.replyTo ? { reply_to: e.replyTo } : {}) }),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok || !body.id) return { ok: false, error: body.message ?? `Resend answered ${res.status}` };
  return { ok: true, id: body.id };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The monthly "please upload your statements" email. */
export function statementRequestEmail(p: {
  businessName: string; fromName: string; month: string; url: string; until: string; note: string | null; accounts: string[]; reminder: boolean;
}): Pick<Email, "subject" | "text" | "html"> {
  const subject = p.reminder
    ? `Reminder: ${p.month} statements for ${p.businessName}`
    : `${p.month} statements for ${p.businessName}`;
  const list = p.accounts.length ? `\n\nStatements needed:\n${p.accounts.map((a) => `- ${a}`).join("\n")}` : "";
  const text = `Hi,\n\n${p.fromName} is asking for the ${p.month} bank and card statements for ${p.businessName}.`
    + `${p.note ? `\n\n${p.note}` : ""}${list}\n\nUpload them here (PDF or CSV, no account needed):\n${p.url}\n\n`
    + `The link is private to you and works until ${p.until}. Files are encrypted and only ${p.fromName} can open them.\n\nThanks!`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#19173a;max-width:520px">
<p>Hi,</p>
<p>${esc(p.fromName)} is asking for the <strong>${esc(p.month)}</strong> bank and card statements for ${esc(p.businessName)}.</p>
${p.note ? `<p>${esc(p.note).replace(/\n/g, "<br>")}</p>` : ""}
${p.accounts.length ? `<p style="margin-bottom:4px">Statements needed:</p><ul style="margin-top:0">${p.accounts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
<p><a href="${esc(p.url)}" style="display:inline-block;background:#272361;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Upload statements</a></p>
<p style="color:#646a83;font-size:13px">PDF or CSV, no account needed. The link is private to you and works until ${esc(p.until)}. Files are encrypted and only ${esc(p.fromName)} can open them.</p>
</div>`;
  return { subject, text, html };
}

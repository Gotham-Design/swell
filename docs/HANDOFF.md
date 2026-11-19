# Swell — deploy handoff (company GitHub, Vercel, Supabase, Resend)

Claude: if someone asks you to deploy Swell to a new setup, follow this file step by step. Do one
step at a time and wait for the person to confirm before moving on. Ask before creating, changing
or deleting anything in their accounts. Never put a secret key in the repo, a commit or a
`NEXT_PUBLIC_` variable. Don't call the deploy done until everything under "Done means" passes.

Background: `CLAUDE.md` (how the app works), `docs/DEPLOY.md` (Hillman's staging setup),
`.env.example` (every env var).

## 0. Before you start

- **The security update must be on `main`:** check that
  `supabase/migrations/20261118000020_security_hardening.sql` and `src/lib/security/rate-limit.ts`
  exist. If they don't, stop and ask Hillman to merge PR #1 ("Security hardening before
  delivery") on `HB3Gen/always-green`.
- **Make new keys for everything:** don't reuse anything from Hillman's staging (Supabase
  project `iyobavqyfkjciqakufce`, agmvp.vercel.app, his Resend, his Jev key).
- **What you need:** admin access to the company GitHub org, Vercel team and Supabase org; a
  Resend account; DNS access for the sending domain; a Jev API key (console.typesafe.ai); an
  Anthropic API key (console.anthropic.com).

## 1. Copy the repo into the company GitHub

```
git clone https://github.com/HB3Gen/always-green swell
cd swell
git remote set-url origin https://github.com/<company-org>/swell.git   # new, empty, private repo
git push -u origin main
```

Only `main` is needed.

## 2. Create the Supabase project

1. New project in the company org, region **West US (Oregon)**. Vercel functions run in `pdx1`
   (`vercel.json`), so if you pick another region, move `regions` in `vercel.json` next to it.
2. Run every file in `supabase/migrations/` in order, either way:
   - **GitHub integration** (recommended): Project Settings → Integrations → GitHub, working
     directory `.`, deploys from `main`.
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. Check it worked: tables like `businesses` and `transactions` exist, Storage has two private
   buckets, and the `pg_cron` jobs exist (`ledger-check-nightly`, `refresh-patterns-nightly`).
4. Copy the Project URL, the **publishable** key and the **secret** key. Prefer these to the
   legacy anon and service_role keys.

## 3. Resend

1. Domains → Add domain, e.g. `mail.<company-domain>`. Add its DNS records (TXT and MX) and
   wait for **Verified**.
2. API Keys → Create, with **Sending access** only, limited to that domain.

Until the domain is verified, every email fails with "domain is not verified".

## 4. Supabase auth settings (Authentication)

1. **SMTP Settings:** host `smtp.resend.com`, port `465`, username `resend`, password = the
   Resend key, sender `noreply@mail.<company-domain>`, sender name `Swell`.
2. **Rate Limits:** about 100 emails per hour. Keep the other defaults.
3. **Email Templates:**
   - **Magic Link:** subject `Your Swell sign-in link`, body = `supabase/templates/magic_link.html`.
   - **Confirm signup:** subject `Confirm your email for Swell`, body =
     `supabase/templates/confirmation.html`.
   - Never use `{{ .SiteURL }}/auth/confirm`.
4. **URL Configuration** (after step 5, once you have the live address):
   - Site URL: `https://<app-domain>`.
   - Redirect URLs: `https://<app-domain>/**` and
     `https://<vercel-project>-*-<team-slug>.vercel.app/**`. Nothing else.
5. **Leave sign-ups ON.** Team invites create accounts through `signInWithOtp` with
   `shouldCreateUser`, so turning sign-ups off breaks invites. A self-signup only gets its own
   empty firm.

## 5. Vercel

1. New project from the company repo, with the Next.js defaults.
2. Add these environment variables (Production, Preview and Development):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (rate limits, statement emails, cron) |
| `TYPESAFE_API_KEY` | Jev key (category suggestions) |
| `ANTHROPIC_API_KEY` | Anthropic key (Ask bar, insights) |
| `RESEND_API_KEY` | Resend key |
| `EMAIL_FROM` | `Swell <statements@mail.<company-domain>>` (on the verified domain) |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `APP_ORIGIN` | `https://<app-domain>` |

   Optional: `JEV_MODEL`, `AI_PROVIDER`, `ANTHROPIC_MODEL`. Leave them unset by default.

3. Deploy.
4. Settings → Deployment Protection: turn **Vercel Authentication off** for production. Client
   upload links (`/r/<token>`) must open for people outside the team.
5. Add the custom domain if there is one, then finish step 4.4. Redeploy after any env change.

## Emails and statement requests: these must keep working

| Feature | Needs |
| --- | --- |
| Sign-in links, team invites | Step 4.1 SMTP and 4.3 templates |
| "Email it" on a statement request | `RESEND_API_KEY` + `EMAIL_FROM` (replies go to the accountant) |
| Recurring monthly requests | The above, plus `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY`. Vercel Cron calls `/api/cron/statement-requests` daily at 14:00 UTC, production only. With no `CRON_SECRET` it returns 401 and nothing sends. |
| Client upload links | Deployment Protection off; private buckets come from the migrations |
| Links inside emails | `APP_ORIGIN` = the live address |

Resend's free plan allows about 100 emails a day. Upgrade before firms send monthly requests at
volume.

## Security (from the Nov 18 audit)

**Already in the code:** RLS on every table, no anon access to anything, and role checks in every
database function (enforced by `supabase/tests/16_security.test.sql`). Escaped output on pages,
in emails and in CSV exports; parameterized SQL; security headers (`next.config.ts`); a CSRF
check on sign-out; a timing-safe cron secret check; private buckets with type and size limits;
hashed upload tokens; no secrets in git history; and a client-bundle secret scan during
`npm run build`.

**App rate limits** (`src/lib/security/rate-limit.ts`, counted in Postgres):

| Action | Limit |
| --- | --- |
| Sign-in link | 10 per IP per 15 min; 5 per email per hour |
| Team invites | 30 per user per hour |
| Statement-request emails | 30 per user per hour |
| Client uploads | 60 per IP per hour |
| AI calls | 30 per user per 10 min |
| Imports | 60 per user per 10 min |
| Exports and reports | 30 per user per 10 min |
| New businesses | 20 per user per day |

The limits need `SUPABASE_SERVICE_ROLE_KEY` and the security migration. If the counter can't be
reached, the limit lets requests through, so a missing key turns the limits off without any
error.

**Settings you set yourself:** Supabase email rate limit (step 4.2); exact Redirect URLs (step
4.4); publishable and secret keys; a sending-only Resend key; separate Jev and Anthropic keys
with a monthly spend cap on each; and rotate any key that's ever exposed, then redeploy.

## Done means

1. A sign-in link arrives from Swell and works in a different browser.
2. You can create a business, import a PDF or CSV statement, and see suggestions with a
   confidence %.
3. The Ask bar (⌘K) answers a question.
4. A Team invite reaches a second email, and that person lands in the firm.
5. A statement-request link opens in a private window, an upload goes through, and the file
   shows on the Import page.
6. "Email it" arrives, its link points at the live domain, and replies go to the accountant.
7. `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app-domain>/api/cron/statement-requests`
   returns a JSON report, and the same call without the header returns 401.
8. The 6th sign-in link request for one email within an hour says "Too many attempts."
9. A PDF or Excel report exports.

If an email doesn't arrive, check Supabase → Logs → Auth first. The cause is usually an
unverified Resend domain or a sender address that isn't on that domain.

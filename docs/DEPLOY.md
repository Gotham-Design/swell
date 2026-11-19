# Deploying Swell

Two environments today: **staging** (ours, for testing) and the client's **production** (theirs,
set up later). Both are the same app: one Next.js project on Vercel plus one Supabase project.

## Staging (current)

| Piece | Where |
| --- | --- |
| App | Vercel project `always-green` (team "Hillman's projects"), domain https://agmvp.vercel.app |
| Database + auth | Supabase project `iyobavqyfkjciqakufce` |
| Code | GitHub `HB3Gen/always-green`, branch `main` |

Every push to `main`:
- **Vercel** builds and deploys (`npm run build`, which also runs the client-bundle secret scan).
- **Supabase** (GitHub integration, working directory `.`) applies any new files in
  `supabase/migrations/` to the staging database.

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon (publishable) key | Public; RLS protects data |
| `TYPESAFE_API_KEY` | Jev key from console.typesafe.ai | Server only. Turns on Jev for suggestions |
| `JEV_MODEL` | optional, default `jev-latest` | |
| `AI_PROVIDER` | optional: `jev` or `anthropic` | Overrides the default (Jev when its key is set) |
| `ANTHROPIC_API_KEY` | optional | Only if `AI_PROVIDER=anthropic` |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service role key | Never `NEXT_PUBLIC_`. Used only by the monthly statement-request job |
| `RESEND_API_KEY` | Resend API key | Server only. Sends the monthly statement requests |
| `EMAIL_FROM` | e.g. `Swell <statements@mail.example.com>` | Must be on a Resend-verified domain |
| `CRON_SECRET` | any long random string | Vercel Cron sends it to `/api/cron/statement-requests` (daily, `vercel.json`) |
| `APP_ORIGIN` | optional, e.g. `https://agmvp.vercel.app` | The address used in emailed links |

### Supabase auth settings (Authentication → URL Configuration)

- **Site URL:** `https://agmvp.vercel.app`
- **Redirect URLs:** `https://agmvp.vercel.app/**` and `https://always-green-*-hillmans-projects.vercel.app/**`
  (the second covers each deployment's own URL).

Sign-in is by email link only. The app builds the link's return address from the page you
requested it on, and `/auth/confirm` accepts both link shapes:

- `?token_hash=…&type=magiclink` from our templates in `supabase/templates/` (works in any browser).
- `?code=…` from Supabase's default template (PKCE; only works in the browser that asked).

Recommended: paste `supabase/templates/magic_link.html` into Authentication → Email Templates →
Magic Link (and `confirmation.html` into Confirm signup), so links and client invites work on
any device. The templates link to `{{ .RedirectTo }}`, the page the link was requested from
(when it's in Redirect URLs; otherwise the Site URL), so a link asked for on a preview opens the
preview. Never `{{ .SiteURL }}/auth/confirm`: that sends every link to production.

Supabase's built-in email sender is rate limited (a few per hour) and meant for testing. Before
real clients sign in, set up custom SMTP (Authentication → SMTP Settings), e.g. Resend or Postmark.

### Vercel Deployment Protection

Staging is behind Vercel Authentication by default, so only members of the Vercel team can open
it. To let someone outside try it, use a shareable link or turn protection off for production
(Project → Settings → Deployment Protection).

## Production (client's, later)

1. New Supabase project in the client's org. Link the repo (GitHub integration) or apply
   migrations with `supabase db push`. Both run everything in `supabase/migrations/` in order.
2. Auth: Site URL, redirect URLs, email templates and SMTP as above.
3. New Vercel project from the same repo with the env vars above, pointing at the new Supabase.
4. Sign in, create the first business, import a statement.

`pg_cron` must be enabled (it is on hosted Supabase); the migrations schedule the nightly ledger
check and pattern refresh.

## Checks before a release

```
npm run build                     # includes the secret scan
npm test                          # unit tests
scripts/db-without-docker/run.sh  # or npm run db:test with Docker: migrations + pgTAP
npm run test:e2e                  # needs local Supabase (npm run db:start)
```

## Region

Functions run in `pdx1` (Portland, `vercel.json`), next to the Supabase project in `us-west-2`.
Every page makes several database round trips; from Vercel's default `iad1` each one crossed
the country (~70ms), which made the transactions list and the Ask bar slow. If the database
moves, move the function region with it.

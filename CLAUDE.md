@AGENTS.md

# Swell (formerly Always Green)

Bookkeeping for small businesses: one row per transaction on screen, balanced
double-entry journal lines underneath.

## Standing rules

1. **Money is integer cents everywhere.** No floats in the DB, API or state. Postgres
   columns are `bigint`; TypeScript values are `Cents` (a safe integer). Parse input with
   `parseCents`, display with `formatCents`, add with `sumCents` (`src/lib/money.ts`).
   Never `parseFloat`, `* 100`, `/ 100` or `toFixed` on money.
2. **Every table with business data has `business_id` and RLS.** No query bypasses RLS
   except named server jobs, which use `createAdminClient("<job name>")`
   (`src/lib/supabase/admin.ts`). User requests always use the session client.
3. **Every transaction posts balanced journal lines (sum = 0) through one DB function.**
   Never insert, update or delete journal lines directly, from app code, SQL or tests.
4. **Anthropic and service-role keys never reach the browser.** Read them only through
   `serverEnv` in `src/lib/env/server.ts` (marked `server-only`). Never prefix them
   `NEXT_PUBLIC_`. ESLint and `scripts/check-client-bundle.mjs` (run by `npm run build`)
   enforce this.
5. **Each prompt ends with passing tests.** Run them before saying done:
   `npm run build`, `npm test`, `npm run db:test` when the schema changed, plus
   `npm run test:e2e` when UI changed. Report failures
   with their output; don't claim done on a red run.

## Stack

Next.js 16 (App Router) + TypeScript strict, Tailwind 4 + shadcn/ui, Supabase (Postgres,
Auth, RLS, Storage, Edge Functions), Vitest, Playwright. Anthropic API server-side only.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server on http://localhost:3200 |
| `npm run build` | Production build, then the client-bundle secret scan |
| `npm test` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run test:e2e` | Production build, then Playwright against `next start` on :3201 (needs local Supabase) |
| `npm run test:e2e:only` | Playwright without rebuilding (after a build) |
| `npm run typecheck` / `npm run lint` | tsc / ESLint |
| `npm run db:start` / `db:stop` / `db:status` | Local Supabase (ports 583xx; Studio 58323, Mailpit 58324; analytics and realtime off) |
| `npm run db:migration <name>` | New file in `supabase/migrations/` |
| `npm run db:reset` | Rebuild the local DB from migrations |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts`; run after every migration |
| `npm run db:test` | pgTAP suite in `supabase/tests/` (shared fixture: `_setup.psql`) |
| `npm run db:lint` | plpgsql lint of the local schema |
| `scripts/db-without-docker/run.sh` | Migrations + pgTAP on a plain Postgres 16 with Supabase stand-ins, when Docker isn't available |

## Ledger

- Sign conventions: `transactions.amount_cents` is from the money account's view
  (in > 0, out < 0). `journal_lines.amount_cents` is debit > 0, credit < 0.
- Journal lines are written only by `private.post_lines_for(ids[])`; `post_transaction`
  and `commit_import` both go through it. Never write lines anywhere else.
- Write transactions only with `post_transaction`, `update_transaction`,
  `soft_delete_transaction`, `restore_transaction`. `update_transaction` replaces every
  editable field, so pass current values for anything unchanged.
- `kind` is derived from the category's type; never set it. A null category posts to
  the business's system Uncategorized account.
- Reports are SQL functions, never JS sums: `report_pnl(business, from, to, cmp_from,
  cmp_to)` and `report_balance_sheet(business, as_of, cmp_as_of)` return every account
  line (own and subtree amounts, natural sign) and every total. They skip `deleted_at`
  rows, as does `account_balances`. The P&L reads only income/expense accounts, so
  transfers and owner equity can't reach it. Retained Earnings = that account plus net
  income of fiscal years before the as-of date's; Current Year Earnings = fiscal year
  start to as-of. `src/lib/reports/lines.ts` only lays rows out (headings, "Total
  <parent>", drill targets); screen, PDF (`@react-pdf/renderer`), CSV and XLSX share it.
  Periods and comparisons live in the URL (`src/lib/reports/periods.ts`).
- Patterns (`transaction_patterns`: vendor, recurring, large) are written only by
  `private.refresh_patterns(business, as_of)`, which rebuilds a business's rows from
  scratch and then creates auto rules. It runs after every import commit (the commit
  action calls `public.refresh_patterns`) and nightly via pg_cron
  (`refresh-patterns-nightly` -> `private.refresh_all_patterns()`, a named server job
  running as postgres). Medians and percentiles use `percentile_disc` (bigint, no floats).
- `transactions.category_source` says who chose the category: `user` (any posting or edit
  that doesn't say otherwise; set by a trigger), `rule` (with `category_rule_id`), `ai` or
  `import` (the file's category). Only `user` counts as a confirmation: 3+ with no
  disagreement makes a *draft* rule (origin `auto_suggested`) that waits on the Rules page.
- Rules: `category_rules` (name, priority (lower runs first), match_mode, stop_processing,
  status active|draft, origin) with `rule_conditions` and `rule_actions`; every change a rule
  makes is logged in `rule_applications` (run_id for "Apply to existing" undo). The engine is
  in Postgres: conditions compile to SQL (`private.rule_condition_sql`, values via format %L)
  and `private.match_rules` evaluates all active rules over a source (import batch,
  transactions, inline json) in one pass; `private.rule_effects` turns matches into category,
  memo and skip_ai. Rules only touch uncategorized rows or rows a rule set, never before the
  lock date. Order: rules at import commit, then AI only on rows no rule would categorize
  (`ai_candidates`). Write rules only with `save_rule` (the old vendor paths still work:
  a vendor rule becomes "vendor equals X" + set_category via `private.ensure_rule_structure`).
  Bulk recategorizing is set-based in `apply_rule_run` (per-row `update_transaction` would
  pass the 30s cap at a few thousand rows) and sets `quickacct.rule_write` so the
  category-source trigger keeps what it is given. `src/lib/rules/model.ts` mirrors the
  validation and writes the plain-words summaries.
- AI suggestions (Prompt 10): `src/lib/ai/prompt.ts` builds the request (pure; the only
  fields sent), `engine.ts` runs batches of 50 with injected client/store (unit tests mock
  the SDK), `run.ts` wires the real SDK (`maxRetries: 0`; `callWithBackoff` owns retries on
  429/529/5xx) and the session Supabase client. The DB decides what may be sent
  (`ai_context`, `ai_candidates`: no account numbers or emails, memos only with
  `ai_share_memos`), records batches (`record_ai_suggestions`: validated, idempotent per
  `request_key`, usage into `ai_usage`) and is the only place a suggestion becomes a
  category (`accept_ai_suggestion(s_above)`, or auto-apply at 0.9+ when the owner opted
  in, marked `category_source = 'ai'`). A trigger decides pending suggestions whenever a
  transaction gets a category by any path (match = accepted, else rejected/corrected).
  Accepted and corrected choices are `user` and count toward rules. Runs after import
  commit (`after()`) and from "Get suggestions". Bump `PROMPT_VERSION` when the prompt
  changes. Model: `businesses.ai_model`, else `ANTHROPIC_MODEL`, else claude-haiku-5-5.
- Suggestions run in tiers (`engine.ts`). Tier 1, `history.ts`: a vendor people filed the
  same way 5+ times (`ai_vendor_history`, user choices only) is suggested with no outside
  call, confidence (n+1)/(n+2). Tier 2, `jev.ts`: Jev (TypeSafe) when `TYPESAFE_API_KEY` is
  set (`AI_PROVIDER` overrides), else Anthropic. Jev gets one choice question per
  transaction over the categories plus "transfer" and "none of these" options, and four
  yes/no flag questions; chunks of 10 run in parallel. Confidence is Jev's probability for
  the pick; the next category is stored as the runner-up. A likely transfer is capped at
  0.5 so it never reaches "Suggested". Jev suggestions carry no reason text; the drawer
  uses fixed copy. Bump `JEV_PROMPT_VERSION` when the questions change.
  `scripts/jev-smoke.ts` sends made-up rows to the live API.
- Insights panel (overview: this month; transactions: the filtered range if bounded, else
  this month) reads one SQL function, `insights(business, from, to)`, built from
  `transaction_patterns` (recurring rows carry `typical_amount_cents` = the regular amount,
  so a changed price shows old -> new). "Explain this month" (`src/lib/ai/explain.ts`)
  sends aggregates only (category totals, vendor-level patterns, counts; never
  descriptions, ids or memos) and caches one summary per business per period in
  `ai_explanations`, with an input hash so a stale one is labeled.
- Ledger integrity: `private.check_ledger()` runs nightly (pg_cron `ledger-check-nightly`)
  and checks every transaction sums to 0 with two lines and each business's trial balance
  is 0. Findings go to `ledger_alerts` (members see a red banner in the business layout)
  and resolve themselves once fixed; runs are logged in `private.ledger_check_runs`.
- Reconciliation: `start_reconciliation` / `set_reconciliation_cleared` /
  `finish_reconciliation` (only at difference 0) / `discard_reconciliation`. Amounts are
  signed as the statement shows them (assets as balance, cards and loans as owed); a
  transfer clears separately on each money account (`reconciliation_items`).
- `supabase/tests/16_security.test.sql` enforces RLS on every public table, a policy on
  every business table, no anon grants, security_invoker views and pinned search_path.
  Private functions have no PUBLIC execute; grant to `authenticated` only what policies or
  invoker functions call directly.
- Child tables reference parents by `(business_id, id)`, so cross-business links fail
  at the foreign key. Keep that pattern for new tables.
- Chart: every business gets the standard chart (`private.seed_standard_chart`) and the
  system accounts (Uncategorized, Transfer Clearing, Retained Earnings). Find standard
  accounts by `subtype`, never by name: users can rename them.
- Money accounts are created only with `create_money_account` and nest under the
  matching standard header (Checking, Savings, Cash, Credit Card, Loans Payable). Opening
  balances go through `set_opening_balance` and post against Opening Balance Equity.
- A category that is a money account, or one of the Checking/Savings/Cash/Credit Card
  headers, makes the transaction a `transfer`.
- Pickers read the `category_picker` view (active, visible, non-system). Merge with
  `merge_category`; it refuses across types or into locked periods.
- Users can't set `is_standard`, `is_hidden`, `is_money_account`, `subtype` or
  `opening_transaction_id` through the API; `private.guard_account` enforces it.
- Tax lines: `businesses.tax_form` picks the return (Schedule C or 1120-S); each category
  maps to a line per form in `account_tax_lines` (reference lines in `tax_lines`, 2025).
- The transaction list filters through `search_transactions` (and
  `summarize_transactions` for totals). Add new filters there, not in TypeScript. URL
  params are parsed/serialized only by `src/lib/transactions/filters.ts`.
- Bulk changes use `categorize_transactions`, which calls `update_transaction` per row
  inside one DB transaction (all or nothing).
- `description_clean` and `vendor_normalized` always come from
  `normalizeDescription()` (`src/lib/transactions/normalize.ts`) on save; never take them
  from the client. Add new bank formats as test cases there first.
- The add/edit form schema (`src/lib/validation/transaction.ts`) runs in the drawer and
  again in the server action. A transfer is one transaction on the "from" account,
  categorized to the "to" money account.
- Deletes are soft: `soft_delete_transaction(s)` / `restore_transaction(s)`. The list's
  "Show deleted" view is `search_transactions(p_deleted => true)`. Audit history is read
  with `transaction_history()`, ordered by `audit_log.seq`.
- CSV import reads files with `src/lib/import/` (pure, unit-tested on the bank fixtures in
  `src/lib/import/__fixtures__/`); the browser runs the same `analyzeFile` in a web worker.
  Add a fixture and a test for any new bank format. Saved mappings live in
  `import_templates`, keyed by money account and header signature.
- Import flow: `stageImport` re-reads the original file on the server (never trusts parsed
  rows from the browser) into `import_rows`; `verify_import` recomputes every status,
  duplicate, category match, total and the balance check set-based (safe to re-run after
  any change); `commit_import` re-verifies, then posts the included rows in one
  transaction; `undo_import` soft-deletes the batch. Keep these set-based (20k rows: verify
  ~1s, commit ~3s). `authenticated` calls are capped at 30s (raised from Supabase's 8s in
  the import migration); a function-level `SET statement_timeout` does not extend it.
- Flip after import: `flip_committed_import(batch)` negates every live transaction of a committed
  batch through `update_transaction`, clears categories the AI/rules/file chose (and supersedes
  their pending suggestions), keeps people's choices, and flips the batch, its rows and the saved
  template's sign convention.
- Transfer matching: a payment between two of a client's money accounts appears on both
  statements. `transfer_match_candidates(business)` suggests pairs (same amount out of one, into
  another, within 5 days, last two years) and one-sided transfers (worded like a transfer, no
  pair: often the owner's personal account). The accountant confirms: `confirm_transfer_match`
  files both sides to the system Transfer Clearing account (so the money moves once and clearing
  nets to zero; `resolve_kind` allows clearing only for matched rows), `unmatch_transfer` restores
  each side's previous category, `dismiss_transfer_candidate` remembers "not a match". Matched
  rows can't be re-filed, re-signed or deleted until unmatched (`guard_matched_transfer`).
  UI: `TransferReview` banner/dialog (transactions page, `?transfers=1` opens it), `MatchedChip`.
- Tax section (`/b/[id]/tax`, tabs assets | mileage | health | documents; `src/lib/dal-tax.ts`,
  `tax/actions.ts`, `src/components/tax/`). Journal entries are transactions with `source = 'journal'`:
  depreciation posts Dr Depreciation / Cr Accumulated Depreciation (the "money" side) through
  `post_lines_for`, so reports and checks read it unchanged. They're hidden from
  `search_transactions` (unless filtered by category or source), money in/out, vendors and the
  largest payment, and only the depreciation functions may change them (`guard_journal_entry`,
  `quickacct.journal_write`). Compare `source::text` in SQL functions. Fixed assets
  (`fixed_assets`, written only by `create_/update_/delete_fixed_asset`) and
  `post_depreciation(business, through)`: per asset, posts whatever brings it to
  `depreciation_through(...)` at that month end (straight-line by month, the in-service month
  counts; or expensed now; or none for land), so edits true up next run; `undo_depreciation`
  takes back the latest posting. Accounts are found by subtype (`depreciation`,
  `accumulated_depreciation`, `fixed_asset[_vehicle|_building|_land]`) and created on first use.
  A purchase made an asset is re-filed to its fixed asset account. `large_purchase_candidates`
  ($2,500+), `tax_item_candidates` (health/retirement wording) and `tax_skips` ("not an asset").
  `tax_items` is a log for the return (no ledger effect). Mileage: `mileage_trips` (tenths of a
  mile) and `mileage_trips_rated` (IRS rate by date from `mileage_rates`; add each new IRS rate
  there). Documents: `documents` rows + private bucket `documents` at `<business>/<id>/<file>`;
  the browser uploads, `recordDocument` records, `/b/[id]/documents/[docId]` redirects to a
  1-minute signed URL. `private.patch_function` rewrites a function by text substitution and
  fails if the text moved.
- Recurring statement requests: `statement_schedules` (writers set who/when; the
  `statement-schedule` job owns the send bookkeeping). Vercel Cron calls
  `/api/cron/statement-requests` daily with `CRON_SECRET`; `runDueSchedules` plans each with
  `planRun` (`src/lib/requests/schedule.ts`: last month's statements, weekly reminders, 3 emails
  max, skipped once `monthCovered` or files arrived) and emails through Resend
  (`src/lib/email/send.ts`; `RESEND_API_KEY` + `EMAIL_FROM`). Account freshness leads with the
  statement's last date ("Through Oct 31 · imported Nov 3"), behind after 40 days.
- Lock date: anything dated on or before `businesses.lock_date` can't be posted,
  edited, deleted or restored. Only owners change it.
- New public tables get no anon access (default privileges are revoked) but do get
  `authenticated` grants: enable RLS and add policies in the same migration.
- Multi-tenant row estimates: until the next ANALYZE, the planner judges one business's
  rows from statistics about the other tenants, so a business that just imported 20k rows
  looks tiny. Don't write queries whose plan only works with a good per-business estimate
  (account_balances once joined every line to every transaction: 18s). Prefer per-row
  index lookups: lateral subqueries keyed on `(business_id, ...)`, and `NOT EXISTS` against
  the partial index of deleted transactions to skip soft-deleted rows.
- Write policies as `business_id IN (SELECT private.my_business_ids('{owner,editor}'))`
  (evaluated once per query), never `private.has_role(business_id)` (once per row; a
  migration check refuses it). Views that join business data should join on
  `business_id` too, so a business filter can use the `(business_id, ...)` indexes.
- MVP screens (Overview, Money accounts, Categories) read plain SQL functions, never JS sums:
  `monthly_income_expense`, `money_movement`, `overview_notes`, `money_account_month_end`,
  `money_account_last_import` (view), `category_period_stats` (count/total/"new" per category
  for a period; null category = uncategorized), `category_monthly`, `category_top_vendors`.
  Totals use P&L signs (income and expense both positive; refunds reduce them; transfers abs).
- Businesses have `industry` (fixed list, `INDUSTRIES` in `src/lib/validation/business.ts`)
  and `archived_at` (set only by `set_business_archived`, owners). Archived businesses leave the
  switcher and "/" routing. Onboarding (`/new`) creates the business, adds the industry's extra
  categories (`src/lib/onboarding/starters.ts`), creates the first money account and opens its
  import.
- Ask bar (smart search, branch `smart-search`, flag `SMART_SEARCH` in `src/lib/flags.ts`,
  `NEXT_PUBLIC_SMART_SEARCH=off` hides it): `src/lib/search/parse.ts` reads typed words into an
  `AskQuery` (vendor, category, account, date range, amounts, uncategorized, measure) with no AI;
  `answer.ts` answers it with `summarize_transactions` / `search_transactions` (all money from
  SQL); `ai.ts` sends only the typed question and category names to Claude Haiku when
  `ANTHROPIC_API_KEY` is set, and matches vendor/account names locally. Edits in the panel use the
  normal actions (`categorizeOne`, `acceptSuggestion(s)`, `save_category_rule`).
- Phase 2, hidden in the MVP (routes work by URL, no entry points): rules, reconciliation,
  insights panel, tax lines, AI auto-apply and model/budget settings.

## App conventions (Next.js 16 with Cache Components)

- Anything that reads the session, cookies, `params` or `searchParams` must sit inside a
  `<Suspense>` boundary, or the build fails. Keep forms in the static shell; only the
  data-dependent parts stream.
- Read data through `src/lib/dal.ts` (`getUser`, `getBusiness`, `getMyBusinesses`,
  `getSupabase`). It calls `connection()` first, because the Supabase client uses
  `Date.now()`, which Next refuses during prerender.
- Server actions re-check membership and role themselves (`getBusiness(...).canManage` /
  `canWrite`), validate with the zod schemas in `src/lib/validation/`, and return a
  `FormState`. Use `refresh()` after a write.
- Amounts on screen carry `aria-label={spokenCents(c)}` ("minus 45 dollars"); `e2e/a11y.spec.ts`
  runs axe (WCAG 2.1 AA) on the main screens after hydration.
- e2e never calls Anthropic: `playwright.config.ts` starts `e2e/mock-anthropic.mjs` and points
  the app at it with `ANTHROPIC_BASE_URL`. `e2e/scale.perf.spec.ts` seeds 100k transactions
  (via `pg` as postgres) and holds list, filters and reports under 500ms.
- Use `SubmitButton` for action forms: it stays disabled until hydration, so an early
  click can't fall through to a plain HTML post that loses the result.
- `/b/[businessId]/...` carries the active business. `src/proxy.ts` refreshes the session,
  sends signed-out users to `/login`, and routes `/` to the last business used.
- `next build` breaks a running `next dev` (its server actions stop working). e2e never
  uses the dev server; restart dev after a build if you're using it.
- Controls that act through React (filters, pickers, row checkboxes) use `useHydrated()`
  and stay disabled until hydration, so early input isn't lost.
- Next keeps the previous route mounted but hidden. In Playwright, filter locators with
  `{ visible: true }` when the same element exists on both pages.

## Auth

- Email magic links only. Templates in `supabase/templates/` link to `{{ .RedirectTo }}`
  (`<origin>/auth/confirm`, or the Site URL root, which the proxy forwards) with a `token_hash`,
  so a link works in any browser (an invite opened by someone else) and returns to the site it
  was asked from (previews included, when allowed in Redirect URLs).
- Firms (`firms`, `firm_members`, `firm_member_clients`, `firm_invites`): every business has a
  `firm_id` (a creator with no firm gets "My firm" as its admin, `private.business_firm_default`).
  Admins own every client; staff get every client or picked ones, as editor or viewer. Firm access
  is written into `business_members` (`firm_id` set) by `private.sync_firm_access`, so policies and
  `my_business_ids` are unchanged; for firm people on firm clients the firm decides (direct rows
  are taken over or removed), and leaving the firm removes every client. Members outside the firm
  are untouched. New clients sync at commit (deferred constraint trigger;
  pgTAP uses `set constraints all immediate`). Write only through `invite_firm_member`,
  `update_firm_member`, `remove_firm_member`, `cancel_firm_invite`, `rename_firm`;
  `accept_my_invites` accepts firm invites too. `businesses.firm_id` changes only with
  `quickacct.firm_write`. UI: `/b/[id]/team`.
- Invites: people are added only through the firm (Team page): `invite_firm_member()` records the
  invite, then a session-less client emails a sign-in link. `accept_my_invites()` runs on
  `/auth/confirm` and on `/`. There are no client logins in the MVP (the old per-client
  `invite_member` stays in the schema with no UI); clients get downloaded reports.
- e2e setup that has no UI yet uses `userClient(email)` in `e2e/helpers.ts`: a client
  signed in as that user, so fixtures still go through RLS and the posting functions.
- Timing tests live in `*.perf.spec.ts` and run alone after the other specs. Playwright
  uses 4 workers: the local auth server stalls sending many sign-in emails at once.
- Locally, emails land in Mailpit (http://127.0.0.1:58324). e2e tests read links from its
  API (`e2e/helpers.ts`). Production needs `[auth.email.smtp]` configured.

## Layout

- `src/lib/money.ts`: the only place money is parsed, formatted or summed.
- `src/lib/security/`: `rate-limit.ts` (Postgres fixed-window counters via `public.rate_limit_hit`,
  service role only, job `rate-limit`; every limit lives in `LIMITS`; fails open if the DB is down)
  and `compare.ts` (`safeEqual` for secrets/webhook signatures, `sameOrigin` for route handlers that
  change state; server actions already get Next's origin check). Anything new that sends email, calls
  AI or does heavy work gets a limit. Security headers are in `next.config.ts`.
- `src/lib/export/`: the full business export (zipped CSVs), served by
  `src/app/b/[businessId]/export/route.ts` to any member.
- `src/lib/reports/`: report periods, statement layout and the PDF/CSV/XLSX renderers;
  downloads are served by `src/app/b/[businessId]/reports/download/route.ts`.
- `src/lib/env/public.ts` / `server.ts`: env access. Public vars may be used anywhere.
- `src/lib/supabase/`: `client.ts` (browser), `server.ts` (RSC/actions, RLS),
  `admin.ts` (service role, named jobs only), `database.types.ts` (generated).
- `supabase/migrations/`: schema. Never edit an applied migration; add a new one.
- `docs/SPEC.md`: the build plan, one prompt per slice. `docs/DEPLOY.md`: staging and production setup.
- `src/app/b/[businessId]/`: the signed-in app, one folder per page.
- `e2e/`: Playwright specs.
- `reference/rentology-accounting/`: the Rentology dashboard this started from. Not
  built or linted; read it for ideas only.

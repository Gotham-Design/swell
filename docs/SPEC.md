# Light Accounting Platform — Claude Code Prompts

Oct 16, 2026 · Barton Strawn

Thirteen prompts, run in order, each in a fresh Claude Code session. Each builds one slice and stops when its tests pass.

## Decisions baked in

The build is double-entry underneath and single-entry on screen. Users see one row per transaction with one category; the database writes two balanced journal lines. Without that, the balance sheet in requirement 3 cannot exist.

1. **Categories are the chart of accounts.** Every category has a type: income, expense, asset, liability, equity. P&L reads income and expense. Balance sheet reads the rest, plus computed retained earnings.
2. **Money accounts are separate from categories.** A transaction lives in a checking, savings, credit card or cash account. CSV imports land in one money account. Opening balances post to Opening Balance Equity.
3. **Transfers are not income or expense.** Paying the credit card from checking, or moving money to savings, is a transfer between two money accounts. Owner contributions and draws post to equity. Mislabeling either corrupts the P&L.
4. **Cash basis only in v1.** No invoices, bills, A/R or A/P. Accrual is a later product, not a toggle.
5. **Money is integer cents** (`bigint`). Never floats. Inflows positive, outflows negative, at the money-account level.
6. **Balance sheet takes an "as of" date, not a range.** It is a snapshot. A range only makes sense as a two-column comparison (as of start vs as of end).
7. **Delete is soft.** Deleted transactions stay in an audit log with an undo. A per-business lock date blocks edits to closed periods.
8. **Pattern detection is code; Claude only picks categories.** Same-vendor, recurring and large-transaction detection run as deterministic SQL/TypeScript. Claude gets the description, the detected patterns and the business's category list, and returns a category ID it must pick from that list.

**Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres, Auth, RLS, Storage, Edge Functions), Tailwind + shadcn/ui, Vitest + Playwright, Anthropic API called server-side only. Swap freely; the prompts name the stack once in `CLAUDE.md`.

**How to run them**

1. Save this doc as `docs/SPEC.md` in the repo before Prompt 0 (export as Markdown).
2. One prompt per fresh Claude Code session. Start each in plan mode, approve the plan, then let it build.
3. Do not move on until the prompt's tests pass. Each prompt ends with its own gate.
4. Commit after every prompt. Prompts 1, 6–7 and 10 are the expensive ones to redo; review their plans hardest.

## Prompt 0 — Repo setup

```text
Read docs/SPEC.md in full. Do not write feature code yet.

Set up the project:
1. Next.js (App Router) + TypeScript strict, Tailwind, shadcn/ui, Vitest, Playwright.
2. Supabase CLI with local dev, a migrations folder, and generated DB types.
3. Env handling: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY. The last two are server-only; add a check that fails the build if either is imported into client code.
4. A money utility module: parse user input to integer cents, format cents for display, sum safely. Unit-test it with negatives, rounding ("10.005"), commas, parentheses-as-negative ("(45.00)"), and currency symbols.

Write CLAUDE.md with these standing rules:
- Money is integer cents everywhere. No floats in DB, API or state.
- Every table with business data has business_id and RLS. No query bypasses RLS except named server jobs.
- Every transaction posts balanced journal lines (sum = 0) through one DB function. Never insert journal lines directly.
- Anthropic and service-role keys never reach the browser.
- Each prompt ends with passing tests; run them before saying done.

Gate: `npm run build`, `npm test` and the money tests pass.
```

## Phase 1 — Foundation

### Prompt 1 — Ledger schema and RLS

```text
Read docs/SPEC.md and CLAUDE.md. Build the database only, no UI.

Tables (all with id uuid, created_at, updated_at, business_id where relevant):
- businesses: name, legal_name, currency (default USD), fiscal_year_start_month, books_start_date, lock_date (nullable), ai_enabled (bool, default false).
- business_members: business_id, user_id, role (owner | editor | viewer).
- accounts (the chart of accounts = "categories" in the UI): name, type (income | expense | asset | liability | equity), subtype, parent_id, is_money_account, is_system, is_standard, archived_at, description (used later as context for AI). Unique (business_id, lower(name)).
- transactions: date, description_raw, description_clean, vendor_normalized, amount_cents (signed, from the money account's view), money_account_id, category_account_id (nullable = uncategorized), kind (income | expense | transfer | equity | other, derived from the category type), memo, reference, source (manual | import | api), import_batch_id, dedupe_hash, deleted_at, created_by.
- journal_lines: transaction_id, account_id, amount_cents (debit positive, credit negative). Never written directly.
- import_batches, audit_log (actor, action, entity, before/after jsonb), category_rules, ai_suggestions: create now with the columns from SPEC; they are filled in later prompts.

Functions:
- post_transaction(...) and update_transaction(...): security definer, validate membership + role + lock_date, write the transaction and exactly two journal_lines that sum to zero. Uncategorized transactions post their other side to a system "Uncategorized" account.
- soft_delete_transaction / restore_transaction: set deleted_at, reverse nothing, write audit_log.
- Indexes for (business_id, date), (business_id, category_account_id), (business_id, vendor_normalized), dedupe_hash.

RLS: members read; owner/editor write; viewer read-only. A user in business A can never read business B.

Tests (pgTAP or Vitest against local Supabase):
- Every posted transaction has lines summing to 0.
- Cross-business read and write are denied.
- Viewer cannot write. Edits before lock_date are refused.
- Soft-deleted transactions are excluded from a balances view.
```

### Prompt 2 — Auth and multiple businesses

```text
Read docs/SPEC.md and CLAUDE.md.

Build:
1. Email + magic-link auth with Supabase.
2. "Create business" flow: name, legal name, currency, fiscal year start month, books start date. On create, call a seed function that inserts the standard chart of accounts (Prompt 3 defines it; stub it here) and makes the creator owner.
3. Business switcher in the top nav. Active business lives in the URL (/b/[businessId]/...) so links and refreshes keep context.
4. Business settings page: edit fields above, set lock date, invite members by email with a role, toggle AI features (off by default, with a plain note that transaction descriptions and amounts are sent to Anthropic when on).
5. Empty states that point to "Add a money account" then "Import transactions".

Tests: Playwright — a user creates two businesses, switches between them, and sees only that business's data. A viewer invitee cannot see edit controls.
```

### Prompt 3 — Categories and money accounts

```text
Read docs/SPEC.md and CLAUDE.md.

1. Seed this standard chart per business (is_standard = true):
   - Income: Sales, Service Revenue, Interest Income, Other Income, Refunds & Returns (contra).
   - Expense: Advertising & Marketing, Bank Fees, Contractors, Insurance, Meals, Office Supplies, Professional Fees, Rent, Repairs & Maintenance, Software & Subscriptions, Travel, Utilities, Payroll, Payroll Taxes, Taxes & Licenses, Vehicle, Shipping & Postage, Education, Other Expense.
   - Asset: Checking, Savings, Cash, Equipment, Accounts Receivable (hidden in v1).
   - Liability: Credit Card, Loans Payable, Sales Tax Payable.
   - Equity: Owner Contributions, Owner Draws, Opening Balance Equity, Retained Earnings (system).
   - System: Uncategorized, Transfer Clearing.
   Give every account a one-line description; the AI uses it.

2. Categories page: grouped by type, standard and custom shown together with a badge. Users can:
   - Create a custom category: name, type, optional parent, description.
   - Rename or edit description of any non-system category.
   - Archive (hidden from pickers, still on reports). Hard delete only if unused.
   - Merge category A into B: reassign all transactions, archive A, log to audit_log.

3. Money accounts page: add checking, savings, credit card, cash, or loan. Each has a name, type, last 4 digits, and an opening balance + date. Opening balance posts against Opening Balance Equity. Show the current balance per account.

Tests: custom category appears in pickers; archived one does not; merge moves every transaction; opening balance makes the account balance correct and the books still balance.
```

## Phase 2 — Transactions

### Prompt 4 — Transaction list, filters and categorizing

```text
Read docs/SPEC.md and CLAUDE.md.

Build /b/[businessId]/transactions:
1. Table: date, description (clean, raw on hover), vendor, money account, category (inline picker), amount (green in, red out), source icon, AI badge slot (empty for now). Server-side pagination (50/page), sticky header, keyboard navigation (j/k rows, c opens category picker).
2. Filters, all reflected in the URL query string so views are shareable and bookmarkable:
   - Date: presets (this month, last month, this quarter, YTD, last year, custom range).
   - Type: income, expense, transfer, equity, uncategorized.
   - Category (multi-select, grouped by type), money account, amount min/max, source, text search on description/vendor/memo.
3. Summary bar for the filtered set: count, total in, total out, net.
4. Categorizing: inline picker with search and recent categories first; "Create category" from inside the picker. Bulk select → set category. Changing a category calls update_transaction so journal lines repost.
5. "Apply to similar": after categorizing, offer to apply the same category to other uncategorized rows with the same vendor_normalized, and to save it as a category rule.

Tests: each filter narrows correctly and survives a reload; bulk categorize of 200 rows completes in under 2s locally; changing a category moves the amount between accounts in the balances view.
```

### Prompt 5 — Add, edit and delete

```text
Read docs/SPEC.md and CLAUDE.md.

1. Add transaction drawer: date, money account, in/out toggle + amount, description, category, memo, reference. Transfer mode: from account → to account (posts one transaction, no income/expense). Validate with zod on client and server.
2. Edit in the same drawer. Show an audit trail (who changed what, when) at the bottom.
3. Delete: soft delete with a 10-second undo toast; bulk delete with a confirm that states the count and total. A "Deleted" filter shows and restores them.
4. Lock date: rows on or before it show a lock icon and cannot be edited or deleted; explain why in a tooltip.
5. vendor_normalized and description_clean are computed on save by a shared normalizer (strip POS prefixes like "SQ *", "TST*", "PAYPAL *", card numbers, store numbers, trailing city/state). Unit-test it on 30 realistic bank descriptions.

Tests: add/edit/delete/undo round trip; transfer leaves P&L unchanged; locked rows refuse edits at the DB, not just the UI.
```

## Phase 3 — CSV import

Bank CSVs disagree on everything: one signed amount column vs separate debit/credit columns, MM/DD vs DD/MM, credit cards reporting charges as positive. The import is a four-step wizard: upload → map → verify → commit.

### Prompt 6 — Upload and column mapping

```text
Read docs/SPEC.md and CLAUDE.md.

Build steps 1–2 of the import wizard at /b/[businessId]/import:
1. Upload: pick the target money account first, then drop a CSV (max 10 MB / 50k rows). Parse with Papa Parse in a web worker. Detect delimiter, encoding (UTF-8, UTF-8 BOM, Windows-1252), and the header row (skip bank preamble lines above it).
2. Mapping screen: show the first 10 raw rows. For each required field, a dropdown of CSV columns:
   - Date (required) + date format (auto-detected, user can override; flag ambiguity when every day value is ≤ 12).
   - Amount mode: single signed column OR separate Debit and Credit columns.
   - Sign convention: "Positive amounts are money in" / "Positive amounts are money out" (default the second for credit-card accounts).
   - Description (required; allow combining two columns), optional Category, Reference, Memo, Balance.
3. Auto-suggest the mapping from header names (date, posted, amount, debit, credit, description, payee, memo, balance) and highlight anything it guessed.
4. Save the mapping as a template on the money account; auto-apply it next time a file with the same header signature arrives.

Tests: fixtures for 5 real-world bank formats (signed amount, debit/credit split, DD/MM, preamble rows, credit card positive-charges) each map correctly.
```

### Prompt 7 — Verification and commit

```text
Read docs/SPEC.md and CLAUDE.md.

Build steps 3–4 of the import wizard.

Step 3, Verify (nothing is written to the ledger yet):
1. Parse every row with the mapping into a staged table (import_rows, status per row).
2. Per-row checks, shown as a filterable list with the bad cell highlighted: unparseable date, date outside books_start_date or on/before lock_date, unparseable or zero amount, missing description, both debit and credit filled.
3. Duplicate check: dedupe_hash = money_account + date + amount_cents + description_clean. Flag exact duplicates against existing transactions AND within the file. Default: skip exact duplicates, keep near-duplicates (same amount, date ±2 days, similar vendor) for the user to decide.
4. Totals panel the user must confirm: row count, date range, total in, total out, net. If a Balance column was mapped, check that the running balance reconciles row to row and show the first row where it breaks.
5. Category column: if mapped, match values to existing categories by name; unmatched values offer "create" or "map to existing".
6. Actions: fix a cell inline, exclude a row, flip the sign convention and re-verify, go back to mapping.

Step 4, Commit:
- Post all accepted rows in one DB transaction via post_transaction under a new import_batch. Show a result summary with links to the imported rows filtered by batch.
- "Undo import" on the batch soft-deletes every row in it.

Tests: a file with 3 bad rows, 2 in-file duplicates and 4 existing duplicates commits exactly the right rows; re-importing the same file adds 0; undo removes the batch and the books still balance; a 20k-row file verifies in under 10s.
```

## Phase 4 — Reports

### Prompt 8 — P&L and balance sheet

```text
Read docs/SPEC.md and CLAUDE.md.

Build report functions in SQL (not JS aggregation), then the pages.

Profit & Loss (/b/[businessId]/reports/pnl):
- Date range with presets (month, quarter, YTD, last fiscal year, custom). Respect fiscal_year_start_month.
- Income accounts, then expense accounts, with parent/child subtotals; Gross income, Total expenses, Net income.
- Optional comparison column: previous period or same period last year, with $ and % change.
- Uncategorized appears as its own line with a warning and a link to the filtered transaction list.
- Every amount drills into the transaction list pre-filtered by that category and range.

Balance Sheet (/b/[businessId]/reports/balance-sheet):
- "As of" date (not a range). Optional comparison "as of" date in a second column.
- Assets, Liabilities, Equity. Equity = contributions, draws, opening balance equity, Retained Earnings (net income of all prior fiscal years) and Current Year Earnings (net income from fiscal year start to as-of date).
- Show a red banner if Assets ≠ Liabilities + Equity, with the difference.

Downloads for both:
- PDF: business name, report title, date range or as-of date, basis "Cash", generated-at timestamp, page numbers. Use a server-rendered HTML template + Playwright PDF (or @react-pdf/renderer).
- CSV and XLSX with the same rows and subtotals.
- Filenames: {business-slug}_{report}_{YYYY-MM-DD}_{YYYY-MM-DD}.pdf

Tests:
- Seed a fixture business with known transactions and assert exact P&L and balance sheet figures.
- Net income for a period equals the change in Retained Earnings + Current Year Earnings over the same period.
- Balance sheet always balances for 10 random as-of dates.
- Transfers and owner draws never appear on the P&L.
```

## Phase 5 — AI on transactions

The order matters: rules from the user's own history first, then deterministic patterns, then Claude only for what's left. That keeps cost down and makes most suggestions explainable without a model call.

### Prompt 9 — Pattern engine (no AI)

```text
Read docs/SPEC.md and CLAUDE.md. No Anthropic calls in this prompt.

Build a pattern engine that runs after every import commit and nightly per business, writing to a transaction_patterns table:
1. Same vendor: group by vendor_normalized; store count, first/last seen, typical category (mode of user-confirmed categories), typical amount (median).
2. Recurring: same vendor, amount within ±10% (or exact for subscriptions), at least 3 occurrences with a regular cadence (weekly 7±2d, monthly 28–35d, quarterly, annual). Store cadence, expected next date, expected amount. Flag a missed or changed-amount occurrence.
3. Large: flag a transaction if |amount| > 3× that vendor's median (min 3 prior), OR above the business's 95th percentile of outflows over the last 12 months, OR above a per-business threshold the user can set. Store which rule fired.
4. Category rules: when a user confirms the same category for a vendor 3 times with no conflicts, create a category_rule (vendor_normalized → category). Users can view, edit, disable and delete rules on a Rules page. Rules auto-apply to new uncategorized imports and are marked "Rule" in the AI badge slot.

Tests: fixtures with a monthly SaaS charge, a weekly payroll, a one-off $12k equipment buy and a vendor with conflicting categories produce exactly the expected patterns and no rule for the conflicting vendor.
```

### Prompt 10 — Claude category suggestions

```text
Read docs/SPEC.md and CLAUDE.md. Use the Anthropic TypeScript SDK server-side only (Supabase Edge Function or Next.js route handler). Model from env ANTHROPIC_MODEL, default claude-haiku-5-5; allow claude-sonnet-5-5 per business setting.

1. Trigger: only when business.ai_enabled. Runs on transactions that are uncategorized AND had no category_rule match. Batches of up to 50.
2. Request content per batch:
   - The business's active categories as {id, name, type, description}. Exclude system and money accounts.
   - Up to 20 recent user-confirmed examples: description_clean → category name.
   - Each transaction: id, date, description_clean, vendor_normalized, amount, money account type, and any patterns from Prompt 9 (recurring cadence, large flag, vendor's past categories).
   - Never send account numbers, member emails, or memo fields unless the user opted in.
3. Force structured output with a tool whose schema returns, per transaction: transaction_id, category_id (enum = the IDs sent), confidence (0–1), reason (≤ 20 words), flags (e.g. "possible transfer", "possible owner draw", "personal?"). Reject and retry once if any category_id is not in the list.
4. Store results in ai_suggestions (model, prompt version, confidence, reason, status pending | accepted | rejected | superseded). Never write the category without user acceptance, unless the user turns on "Auto-apply above 0.9".
5. UI in the transaction list: a suggestion chip in the category cell with the reason on hover; accept (Enter), reject (Backspace), or pick another. "Review suggestions" mode walks through them one by one. "Accept all above X%" bulk action with a count preview.
6. Feedback: accepted and corrected suggestions count toward category_rules (Prompt 9). Rejections are added as negative examples next batch.
7. Guardrails: per-business monthly token budget with a usage meter on settings; exponential backoff on 429/529; idempotency so re-running a batch does not duplicate suggestions; log prompt version and latency.

Tests: mock the SDK. Assert the request contains only allowed fields; an invalid category_id triggers a retry; nothing is categorized without acceptance by default; budget exhaustion stops calls and shows a notice.
```

### Prompt 11 — Insights panel

```text
Read docs/SPEC.md and CLAUDE.md.

Add an Insights panel to the transactions page and the dashboard, built from transaction_patterns (no model call needed to render it):
1. Recurring: list with vendor, cadence, expected amount, next expected date, annualized cost. Highlight price increases and missed charges.
2. Large transactions this period, with the rule that flagged them; one click to filter the list.
3. New vendors this month; top vendors by spend.
4. Uncategorized count with a "Review with AI" button (only if ai_enabled).
5. Optional "Explain this month" button: send the P&L summary and the pattern list (aggregates only, no raw descriptions) to Claude and render a short plain-language summary. Cache it per business per period.

Tests: panel figures match the pattern table; the explain call sends aggregates only.
```

## Prompt 12 — Hardening

```text
Read docs/SPEC.md and CLAUDE.md. Review the whole codebase; fix what you find.

1. Security: run Supabase advisors; confirm RLS on every table with business_id; grep for service-role or Anthropic keys in client bundles; check every route handler re-verifies membership.
2. Ledger integrity: a nightly check that every transaction's journal lines sum to 0 and the trial balance sums to 0 per business; alert on failure.
3. Reconciliation: add a per-money-account "reconcile to statement" screen — enter statement ending balance and date, tick cleared transactions, show the difference.
4. Performance: seed 100k transactions across 3 businesses; list, filters and both reports must respond under 500ms locally. Add indexes or materialized balances where needed.
5. Accessibility: keyboard-only pass on transactions, import wizard and reports; WCAG AA contrast; screen reader labels on amounts ("minus 45 dollars").
6. Data export: full business export (transactions, categories, rules, audit log) as a zipped CSV set.

Gate: full test suite, Playwright end-to-end (create business → import CSV → accept AI suggestions → download P&L and balance sheet PDFs) passes.
```

**Open questions before Prompt 1**

- [ ] Is this standalone, or a module inside the LLC platform? If inside, Prompt 2 reuses that org model instead of creating businesses.
- [ ] Will users ever need Plaid/bank feeds? If yes, keep dedupe\_hash and source = api as designed so feeds slot in later.
- [ ] Who files taxes from this? If an accountant, add a Schedule C / 1120-S tax-line mapping field on categories now; it's cheap in Prompt 3 and painful later.

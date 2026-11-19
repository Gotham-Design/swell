-- Ledger foundation (SPEC Prompt 1): businesses, members, chart of accounts,
-- transactions and their journal lines, plus tables later prompts fill in.
--
-- Conventions
--   * Money is bigint cents. transactions.amount_cents is signed from the money
--     account's view (in > 0, out < 0). journal_lines.amount_cents is debit > 0,
--     credit < 0, and every transaction's lines sum to 0.
--   * Every business-data table carries business_id. Child rows reference parents by
--     (business_id, id), so a row can never point at another business's data.
--   * Writes to transactions and journal_lines go through the functions in the next
--     migration; nobody gets INSERT/UPDATE/DELETE on them.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'editor', 'viewer');
create type public.account_type as enum ('income', 'expense', 'asset', 'liability', 'equity');
create type public.transaction_kind as enum ('income', 'expense', 'transfer', 'equity', 'other');
create type public.transaction_source as enum ('manual', 'import', 'api');
create type public.import_batch_status as enum ('staged', 'verified', 'committed', 'undone');
create type public.category_rule_source as enum ('auto', 'manual');
create type public.ai_suggestion_status as enum ('pending', 'accepted', 'rejected', 'superseded');

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Businesses and members
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  legal_name text check (legal_name is null or length(legal_name) <= 200),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  books_start_date date,
  -- Transactions dated on or before this date cannot be posted, edited, deleted or restored.
  lock_date date,
  ai_enabled boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_members_user_idx on public.business_members (user_id);

-- ---------------------------------------------------------------------------
-- Chart of accounts ("categories" in the UI; money accounts live here too)
-- ---------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  type public.account_type not null,
  subtype text,
  parent_id uuid,
  is_money_account boolean not null default false,
  is_system boolean not null default false,
  is_standard boolean not null default false,
  archived_at timestamptz,
  -- One line of context; sent to the AI with the category list (Prompt 10).
  description text check (description is null or length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, parent_id) references public.accounts (business_id, id),
  check (parent_id is distinct from id),
  -- Checking, savings, cash are assets; credit cards and loans are liabilities.
  check (not is_money_account or type in ('asset', 'liability'))
);
create unique index accounts_business_name_key on public.accounts (business_id, lower(name));
create index accounts_parent_idx on public.accounts (business_id, parent_id) where parent_id is not null;

-- ---------------------------------------------------------------------------
-- Import batches (filled in by Prompts 6–7)
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  money_account_id uuid not null,
  status public.import_batch_status not null default 'staged',
  file_name text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  -- Column names of the CSV header, normalized; used to auto-apply saved mappings.
  header_signature text,
  -- Column mapping, date format, amount mode and sign convention used for this file.
  mapping jsonb,
  row_count integer check (row_count is null or row_count >= 0),
  committed_count integer check (committed_count is null or committed_count >= 0),
  skipped_count integer check (skipped_count is null or skipped_count >= 0),
  total_in_cents bigint,
  total_out_cents bigint,
  date_from date,
  date_to date,
  committed_at timestamptz,
  undone_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, money_account_id) references public.accounts (business_id, id)
);
create index import_batches_business_idx on public.import_batches (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Transactions (one row per bank line; what the user sees)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  date date not null,
  description_raw text not null check (length(btrim(description_raw)) > 0),
  description_clean text,
  vendor_normalized text,
  -- Signed from the money account's view: in > 0, out < 0. Never zero.
  amount_cents bigint not null check (amount_cents <> 0),
  money_account_id uuid not null,
  -- Null = uncategorized; its journal line posts to the system Uncategorized account.
  category_account_id uuid,
  -- Derived from the category's type by the posting functions; never set by hand.
  kind public.transaction_kind not null,
  memo text,
  reference text,
  source public.transaction_source not null default 'manual',
  import_batch_id uuid,
  -- money account + date + amount + description_clean, computed by the importer (Prompt 7).
  dedupe_hash text,
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, money_account_id) references public.accounts (business_id, id),
  foreign key (business_id, category_account_id) references public.accounts (business_id, id),
  foreign key (business_id, import_batch_id) references public.import_batches (business_id, id),
  check (category_account_id is distinct from money_account_id),
  check (source <> 'import' or import_batch_id is not null),
  check (deleted_at is not null or deleted_by is null)
);
create index transactions_business_date_idx on public.transactions (business_id, date);
create index transactions_business_category_idx on public.transactions (business_id, category_account_id);
create index transactions_business_vendor_idx on public.transactions (business_id, vendor_normalized);
create index transactions_business_dedupe_idx on public.transactions (business_id, dedupe_hash) where dedupe_hash is not null;
create index transactions_money_account_idx on public.transactions (business_id, money_account_id, date);
create index transactions_import_batch_idx on public.transactions (business_id, import_batch_id) where import_batch_id is not null;

-- ---------------------------------------------------------------------------
-- Journal lines (double entry underneath; written only by private.post_lines)
-- ---------------------------------------------------------------------------
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  transaction_id uuid not null,
  account_id uuid not null,
  -- Debit > 0, credit < 0.
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade,
  -- NO ACTION (not RESTRICT): an account with lines can't be deleted on its own, but a
  -- whole business can, since its transactions' lines go in the same statement.
  foreign key (business_id, account_id) references public.accounts (business_id, id)
);
create index journal_lines_transaction_idx on public.journal_lines (transaction_id);
create index journal_lines_account_idx on public.journal_lines (business_id, account_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only; written by security-definer functions)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+$'),
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (business_id, entity, entity_id, created_at);
create index audit_log_business_idx on public.audit_log (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Category rules: vendor_normalized → category (filled in by Prompts 4 and 9)
-- ---------------------------------------------------------------------------
create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  vendor_normalized text not null check (length(btrim(vendor_normalized)) > 0),
  category_account_id uuid not null,
  source public.category_rule_source not null default 'manual',
  enabled boolean not null default true,
  -- How many user confirmations backed an auto rule (Prompt 9 creates one at 3).
  confirmations integer not null default 0 check (confirmations >= 0),
  last_applied_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, vendor_normalized),
  foreign key (business_id, category_account_id) references public.accounts (business_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI category suggestions (filled in by Prompt 10)
-- ---------------------------------------------------------------------------
create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  transaction_id uuid not null,
  category_account_id uuid not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  reason text check (reason is null or length(reason) <= 300),
  -- e.g. 'possible transfer', 'possible owner draw', 'personal?'
  flags text[] not null default '{}',
  model text not null,
  prompt_version text not null,
  status public.ai_suggestion_status not null default 'pending',
  -- Idempotency: re-running the same batch must not duplicate suggestions.
  request_key text not null,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, request_key, transaction_id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade,
  foreign key (business_id, category_account_id) references public.accounts (business_id, id) on delete cascade
);
create unique index ai_suggestions_one_pending_idx on public.ai_suggestions (transaction_id) where status = 'pending';
create index ai_suggestions_business_status_idx on public.ai_suggestions (business_id, status);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['businesses', 'business_members', 'accounts', 'import_batches', 'transactions',
                           'journal_lines', 'audit_log', 'category_rules', 'ai_suggestions'] loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function private.touch_updated_at()', t);
  end loop;
end $$;

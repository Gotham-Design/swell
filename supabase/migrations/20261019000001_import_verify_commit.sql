-- Import verify and commit (SPEC Prompt 7). Every row of a file is staged in import_rows;
-- verify_import checks them all set-based (errors, lock and books-start dates, exact and
-- near duplicates, categories); commit_import posts the accepted rows in one database
-- transaction (lines from the same post_lines_for that post_transaction uses);
-- undo_import soft-deletes the batch.

-- ---------------------------------------------------------------------------
-- Batch: keep the file text (so "back to mapping" works after a reload), category
-- choices, and the balance check.
-- ---------------------------------------------------------------------------
alter table public.import_batches
  add column source_text text,
  add column encoding text,
  -- lower(category name in the file) -> account id, chosen by the user ("map to existing" / "create").
  add column category_map jsonb not null default '{}' check (jsonb_typeof(category_map) = 'object'),
  -- Running-balance check from the file's Balance column, set by verify_import:
  -- {checked, ok, breakRow, expected, actual}.
  add column balance_check jsonb,
  add column verified_at timestamptz;

create type public.import_row_status as enum ('ok', 'error', 'duplicate', 'near_duplicate');
create type public.import_row_decision as enum ('include', 'exclude');

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  import_batch_id uuid not null,
  -- 0-based position among the file's data rows.
  row_index integer not null check (row_index >= 0),
  -- The row's cells as the bank wrote them (inline fixes edit these).
  raw text[] not null,
  date date,
  amount_cents bigint,
  description_raw text,
  description_clean text,
  vendor_normalized text,
  category_name text,
  category_account_id uuid,
  reference text,
  memo text,
  balance_cents bigint,
  -- [{field, message}] from reading the row with the mapping (set when staged or fixed).
  parse_issues jsonb not null default '[]' check (jsonb_typeof(parse_issues) = 'array'),
  -- [{field, message}] from verify_import (dates outside the books or locked).
  check_issues jsonb not null default '[]' check (jsonb_typeof(check_issues) = 'array'),
  status public.import_row_status not null default 'ok',
  -- The user's override: include a duplicate anyway, or exclude any row.
  decision public.import_row_decision,
  duplicate_of_transaction uuid,
  duplicate_of_row integer,
  near_duplicate_of uuid,
  dedupe_hash text,
  -- Will this row be posted? Errors never are; duplicates only if the user says so.
  included boolean generated always as (
    case when status = 'error' then false
         when decision is not null then decision = 'include'
         else status in ('ok', 'near_duplicate') end
  ) stored,
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_batch_id, row_index),
  foreign key (business_id, import_batch_id) references public.import_batches (business_id, id) on delete cascade,
  foreign key (business_id, category_account_id) references public.accounts (business_id, id) on delete set null (category_account_id)
);
create index import_rows_batch_status_idx on public.import_rows (import_batch_id, status, row_index);
create index import_rows_batch_hash_idx on public.import_rows (import_batch_id, dedupe_hash);
create trigger touch_updated_at before update on public.import_rows
  for each row execute function private.touch_updated_at();

alter table public.import_rows enable row level security;
revoke all on public.import_rows from anon;
revoke truncate, references, trigger on public.import_rows from authenticated;
create policy "members read" on public.import_rows for select to authenticated
  using (private.has_role(business_id));
create policy "writers insert" on public.import_rows for insert to authenticated
  with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers update" on public.import_rows for update to authenticated
  using (private.has_role(business_id, '{owner,editor}')) with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers delete" on public.import_rows for delete to authenticated
  using (private.has_role(business_id, '{owner,editor}'));

-- Existing transactions are matched on the same key, so look them up by it quickly.
create index transactions_dedupe_lookup_idx on public.transactions
  (business_id, money_account_id, date, amount_cents) where deleted_at is null;

-- money account + date + amount + description_clean (SPEC Prompt 7).
create function private.import_dedupe_hash(p_money uuid, p_date date, p_amount bigint, p_description text)
returns text language sql immutable set search_path = '' as $$
  select md5(p_money::text || '|' || p_date::text || '|' || p_amount::text || '|' || lower(btrim(coalesce(p_description, ''))))
$$;

-- ---------------------------------------------------------------------------
-- Verify: recompute every row's status from its data. Safe to run any number of times.
-- ---------------------------------------------------------------------------
create function public.verify_import(p_batch_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches;
  v_lock date;
  v_start date;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'Import not found' using errcode = '42501';
  end if;
  perform private.require_role(b.business_id, '{owner,editor}');
  if b.status not in ('staged', 'verified') then
    raise exception 'This import is already %', b.status using errcode = '22023';
  end if;
  select lock_date, books_start_date into v_lock, v_start from public.businesses where id = b.business_id;

  -- Dates outside the books, hash, category, and a clean slate for the checks below.
  update public.import_rows r set
    check_issues = (
      case when r.date is not null and v_start is not null and r.date < v_start
        then jsonb_build_array(jsonb_build_object('field', 'date', 'message', 'Before the books start (' || v_start || ')'))
        else '[]'::jsonb end)
      || (case when r.date is not null and v_lock is not null and r.date <= v_lock
        then jsonb_build_array(jsonb_build_object('field', 'date', 'message', 'On or before the lock date (' || v_lock || ')'))
        else '[]'::jsonb end),
    dedupe_hash = case when r.date is not null and r.amount_cents is not null
      then private.import_dedupe_hash(b.money_account_id, r.date, r.amount_cents, r.description_clean) end,
    category_account_id = case when r.category_name is null then null else coalesce(
      (select a.id from public.accounts a
       where a.business_id = b.business_id and a.id = (b.category_map ->> lower(btrim(r.category_name)))::uuid
         and a.archived_at is null and not a.is_system),
      (select a.id from public.accounts a
       where a.business_id = b.business_id and lower(a.name) = lower(btrim(r.category_name))
         and a.archived_at is null and not a.is_system and not a.is_hidden and a.id <> b.money_account_id
       limit 1)) end,
    duplicate_of_transaction = null,
    duplicate_of_row = null,
    near_duplicate_of = null
  where r.import_batch_id = b.id;

  -- Exact duplicates of transactions already in the books (same key, not deleted).
  update public.import_rows r set duplicate_of_transaction = (
    select t.id from public.transactions t
    where t.business_id = b.business_id and t.money_account_id = b.money_account_id and t.deleted_at is null
      and t.date = r.date and t.amount_cents = r.amount_cents
      and lower(btrim(coalesce(t.description_clean, t.description_raw))) = lower(btrim(coalesce(r.description_clean, '')))
    order by t.created_at limit 1)
  where r.import_batch_id = b.id and r.dedupe_hash is not null and r.parse_issues = '[]';

  -- Exact duplicates within the file: the first copy stays, later copies point at it.
  update public.import_rows r set duplicate_of_row = d.first_row
  from (
    select id, first_value(row_index) over w as first_row, row_number() over w as n
    from public.import_rows
    where import_batch_id = b.id and dedupe_hash is not null and parse_issues = '[]'
    window w as (partition by dedupe_hash order by row_index)
  ) d
  where r.id = d.id and d.n > 1;

  -- Near duplicates: same account and amount, within 2 days, similar vendor.
  update public.import_rows r set near_duplicate_of = (
    select t.id from public.transactions t
    where t.business_id = b.business_id and t.money_account_id = b.money_account_id and t.deleted_at is null
      and t.amount_cents = r.amount_cents and t.date between r.date - 2 and r.date + 2
      and (
        (t.vendor_normalized is not null and r.vendor_normalized is not null
          and (t.vendor_normalized = r.vendor_normalized
               or t.vendor_normalized like r.vendor_normalized || '%'
               or r.vendor_normalized like t.vendor_normalized || '%'))
        or lower(coalesce(t.description_clean, t.description_raw)) = lower(coalesce(r.description_clean, ''))
      )
    order by abs(t.date - r.date), t.created_at limit 1)
  where r.import_batch_id = b.id and r.dedupe_hash is not null and r.parse_issues = '[]'
    and r.duplicate_of_transaction is null and r.duplicate_of_row is null;

  update public.import_rows r set status = case
      when r.parse_issues <> '[]' or r.check_issues <> '[]' then 'error'
      when r.duplicate_of_transaction is not null or r.duplicate_of_row is not null then 'duplicate'
      when r.near_duplicate_of is not null then 'near_duplicate'
      else 'ok' end::public.import_row_status
  where r.import_batch_id = b.id;

  -- Running balance (if the file has one): each row's balance should be the previous
  -- balance plus its amount, walking oldest first. A row with a balance and no amount (a
  -- bank's "beginning balance" line) starts the chain. Report the first break.
  update public.import_batches set balance_check = (
    with dir as (
      select coalesce((select date from public.import_rows where import_batch_id = b.id and date is not null order by row_index limit 1)
           > (select date from public.import_rows where import_batch_id = b.id and date is not null order by row_index desc limit 1), false) as newest_first
    ), walk as (
      select r.row_index, r.amount_cents, r.balance_cents,
             case when d.newest_first then -r.row_index else r.row_index end as seq,
             lag(r.balance_cents) over (order by case when d.newest_first then -r.row_index else r.row_index end) as prev
      from public.import_rows r, dir d
      where r.import_batch_id = b.id and r.balance_cents is not null
    ), first_break as (
      select row_index, prev + amount_cents as expected, balance_cents as actual
      from walk where prev is not null and amount_cents is not null and prev + amount_cents <> balance_cents
      order by seq limit 1
    )
    select case
      when (select count(*) from walk) < 2 then jsonb_build_object('checked', false, 'ok', true)
      when exists (select 1 from first_break) then (
        select jsonb_build_object('checked', true, 'ok', false, 'breakRow', row_index, 'expected', expected, 'actual', actual) from first_break)
      else jsonb_build_object('checked', true, 'ok', true) end
  ) where id = b.id;

  -- Totals of what would be posted.
  update public.import_batches set
    status = 'verified',
    verified_at = now(),
    row_count = (select count(*) from public.import_rows where import_batch_id = b.id),
    skipped_count = (select count(*) from public.import_rows where import_batch_id = b.id and not included),
    total_in_cents = (select coalesce(sum(amount_cents), 0) from public.import_rows where import_batch_id = b.id and included and amount_cents > 0),
    total_out_cents = (select coalesce(sum(amount_cents), 0) from public.import_rows where import_batch_id = b.id and included and amount_cents < 0),
    date_from = (select min(date) from public.import_rows where import_batch_id = b.id and included),
    date_to = (select max(date) from public.import_rows where import_batch_id = b.id and included)
  where id = b.id;
end $$;

-- ---------------------------------------------------------------------------
-- Posting at scale. Journal lines are still written in exactly one place: post_lines_for
-- takes any number of transactions (post_transaction passes one). The kind rule lives in
-- category_kind, shared by single posting and imports.
-- ---------------------------------------------------------------------------
create function private.category_kind(p_type public.account_type, p_is_money boolean, p_subtype text)
returns public.transaction_kind
language sql immutable set search_path = '' as $$
  select (case
    when p_type is null then 'other'                       -- uncategorized
    when p_type = 'income' then 'income'
    when p_type = 'expense' then 'expense'
    when p_type = 'equity' then 'equity'
    when p_is_money or p_subtype in ('checking', 'savings', 'cash', 'credit_card') then 'transfer'
    else 'other'
  end)::public.transaction_kind
$$;

create or replace function private.resolve_kind(
  p_business_id uuid,
  p_money_account_id uuid,
  p_category_account_id uuid,
  p_allow_archived uuid[] default '{}'
) returns public.transaction_kind
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.accounts;
  c public.accounts;
begin
  select * into m from public.accounts where id = p_money_account_id and business_id = p_business_id;
  if m.id is null then
    raise exception 'Money account not found in this business' using errcode = '23503';
  end if;
  if not m.is_money_account then
    raise exception '% is not a money account', m.name using errcode = '22023';
  end if;
  if m.archived_at is not null and not (m.id = any (p_allow_archived)) then
    raise exception 'Money account % is archived', m.name using errcode = '22023';
  end if;
  if p_category_account_id is null then
    return private.category_kind(null, false, null);
  end if;
  select * into c from public.accounts where id = p_category_account_id and business_id = p_business_id;
  if c.id is null then
    raise exception 'Category not found in this business' using errcode = '23503';
  end if;
  if c.id = m.id then
    raise exception 'A transaction cannot be categorized to its own money account' using errcode = '22023';
  end if;
  if c.is_system then
    raise exception '% is a system account and cannot be picked as a category', c.name using errcode = '22023';
  end if;
  if c.archived_at is not null and not (c.id = any (p_allow_archived)) then
    raise exception 'Category % is archived', c.name using errcode = '22023';
  end if;
  return private.category_kind(c.type, c.is_money_account, c.subtype);
end $$;

-- The only code that writes journal lines: two per transaction, money side and other side.
create function private.post_lines_for(p_transaction_ids uuid[])
returns void
language sql security definer set search_path = '' as $$
  delete from public.journal_lines where transaction_id = any (p_transaction_ids);
  insert into public.journal_lines (business_id, transaction_id, account_id, amount_cents)
  select t.business_id, t.id, l.account_id, l.amount_cents
  from public.transactions t
  join public.accounts u on u.business_id = t.business_id and u.is_system and u.subtype = 'uncategorized'
  -- Money side: an inflow debits it (+), an outflow credits it (-); right for card and
  -- loan accounts too. The other side mirrors it on the category (or Uncategorized).
  cross join lateral (values
    (t.money_account_id, t.amount_cents),
    (coalesce(t.category_account_id, u.id), -t.amount_cents)
  ) as l(account_id, amount_cents)
  where t.id = any (p_transaction_ids);
$$;

create or replace function private.post_lines(p_transaction_id uuid)
returns void
language sql security definer set search_path = '' as $$
  select private.post_lines_for(array[p_transaction_id]);
$$;

revoke all on function private.category_kind(public.account_type, boolean, text) from public;
revoke all on function private.post_lines_for(uuid[]) from public;

-- ---------------------------------------------------------------------------
-- Commit: re-verify, then post every included row in this one database transaction,
-- with the same checks as post_transaction and lines from post_lines_for. p_expected_count is what the user confirmed; if the
-- books changed since (so the count differs), nothing is posted.
-- ---------------------------------------------------------------------------
create function public.commit_import(p_batch_id uuid, p_expected_count integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches;
  v_count int;
begin
  perform public.verify_import(p_batch_id);
  select * into b from public.import_batches where id = p_batch_id;
  select count(*) into v_count from public.import_rows where import_batch_id = b.id and included;
  if v_count <> p_expected_count then
    raise exception 'The import changed since you checked it (% rows to post, you confirmed %). Review it again.', v_count, p_expected_count
      using errcode = '40001';
  end if;
  if v_count = 0 then
    raise exception 'There is nothing to import' using errcode = '22023';
  end if;

  -- Same checks post_transaction makes, once for the batch: the money account can take
  -- postings, nothing is in a closed period (verify marked those as errors already).
  perform private.resolve_kind(b.business_id, b.money_account_id, null);
  if exists (select 1 from public.import_rows r join public.businesses bz on bz.id = b.business_id
             where r.import_batch_id = b.id and r.included and bz.lock_date is not null and r.date <= bz.lock_date) then
    raise exception 'Books are locked for some of these dates' using errcode = 'P0001', hint = 'locked_period';
  end if;

  -- Set-based posting (a row-by-row loop is ~30s for 20k rows; this is a few hundred ms).
  update public.import_rows set transaction_id = gen_random_uuid() where import_batch_id = b.id and included;
  insert into public.transactions (
    id, business_id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id,
    category_account_id, kind, memo, reference, source, import_batch_id, dedupe_hash, created_by
  )
  select r.transaction_id, b.business_id, r.date, r.description_raw, r.description_clean, r.vendor_normalized,
         r.amount_cents, b.money_account_id, r.category_account_id,
         private.category_kind(c.type, coalesce(c.is_money_account, false), c.subtype),
         r.memo, r.reference, 'import', b.id, r.dedupe_hash, (select auth.uid())
  from public.import_rows r
  left join public.accounts c on c.id = r.category_account_id
  where r.import_batch_id = b.id and r.included
  order by r.row_index;
  perform private.post_lines_for(array(select transaction_id from public.import_rows where import_batch_id = b.id and included));
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  select b.business_id, (select auth.uid()), 'create', 'transactions', t.id, null, to_jsonb(t)
  from public.transactions t where t.import_batch_id = b.id;

  update public.import_batches set status = 'committed', committed_at = now(), committed_count = v_count where id = b.id;
  perform private.audit(b.business_id, 'commit', 'import_batches', b.id, null,
    jsonb_build_object('committed_count', v_count, 'file_name', b.file_name));
  return v_count;
end $$;

-- Undo a committed import: soft-delete every transaction it posted (restorable, audited).
create function public.undo_import(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches;
  v_count int;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'Import not found' using errcode = '42501';
  end if;
  perform private.require_role(b.business_id, '{owner,editor}');
  if b.status <> 'committed' then
    raise exception 'Only a committed import can be undone' using errcode = '22023';
  end if;
  v_count := public.soft_delete_transactions(array(
    select id from public.transactions where import_batch_id = b.id and deleted_at is null));
  update public.import_batches set status = 'undone', undone_at = now() where id = b.id;
  perform private.audit(b.business_id, 'undo', 'import_batches', b.id, null, jsonb_build_object('deleted_count', v_count));
  return v_count;
end $$;

revoke all on function private.import_dedupe_hash(uuid, date, bigint, text) from public;
revoke all on function public.verify_import(uuid) from public, anon;
revoke all on function public.commit_import(uuid, integer) from public, anon;
revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.verify_import(uuid), public.commit_import(uuid, integer), public.undo_import(uuid) to authenticated;

-- Flip the sign convention ("positive is money in" <-> "money out") and re-verify.
create function public.flip_import_sign(p_batch_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare b public.import_batches;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'Import not found' using errcode = '42501';
  end if;
  perform private.require_role(b.business_id, '{owner,editor}');
  if b.status not in ('staged', 'verified') then
    raise exception 'This import is already %', b.status using errcode = '22023';
  end if;
  if b.mapping ->> 'amountMode' <> 'signed' then
    raise exception 'Debit and credit columns already say which way money moved' using errcode = '22023';
  end if;
  update public.import_batches set mapping = jsonb_set(mapping, '{signConvention}',
    to_jsonb(case when mapping ->> 'signConvention' = 'positive_in' then 'positive_out' else 'positive_in' end))
  where id = b.id;
  update public.import_rows set amount_cents = -amount_cents where import_batch_id = b.id and amount_cents is not null;
  perform public.verify_import(b.id);
end $$;

revoke all on function public.flip_import_sign(uuid) from public, anon;
grant execute on function public.flip_import_sign(uuid) to authenticated;

-- Signed-in API calls get 30s instead of Supabase's default 8s. A 20,000-row commit is one
-- transaction (verify + post + balance checks) and takes 3-5s normally, but can pass 8s on
-- a busy server, which rolls the whole import back. 30s still bounds runaway queries.
alter role authenticated set statement_timeout = '30s';
notify pgrst, 'reload config';

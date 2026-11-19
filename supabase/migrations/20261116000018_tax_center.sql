-- Tax section: fixed assets and depreciation, documents on transactions, a health and
-- retirement log, and mileage.
--
-- 1. Journal entries (source 'journal'): postings with no bank side. A depreciation entry is a
--    transaction whose "money" side is Accumulated Depreciation and whose category is
--    Depreciation, so post_lines_for writes Dr Depreciation / Cr Accumulated Depreciation and
--    every report, the trial balance and check_ledger read it unchanged. They stay out of the
--    transaction list, money in/out, vendors and "largest payment" (no money moved), and only
--    the depreciation functions can change them (quickacct.journal_write).
-- 2. Fixed assets + depreciation_entries. Straight-line by month (the month placed in service
--    counts), or expensed when placed in service (Section 179 / bonus), or not depreciated
--    (land). post_depreciation(business, through) posts, per asset, whatever brings it to its
--    schedule as of that month end, so running it monthly or once a year both work, and an edit
--    to cost or life is trued up on the next run. Book depreciation only; tax (MACRS) stays in
--    the tax software.
-- 3. documents: files on transactions, assets and log entries (bucket `documents`).
-- 4. tax_items: health and retirement spending, linked to a transaction when there is one.
-- 5. mileage_trips with the IRS business rates by date (mileage_rates).

-- ---------------------------------------------------------------------------
-- 1. Journal entries
-- ---------------------------------------------------------------------------
create function private.guard_journal_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.source::text = 'journal' and coalesce(current_setting('quickacct.journal_write', true), '') <> 'on' then
    raise exception 'This is a depreciation entry. Change it from Tax → Assets.' using errcode = 'P0001', hint = 'journal_entry';
  end if;
  return new;
end $$;
create trigger guard_journal_entry before update on public.transactions
  for each row execute function private.guard_journal_entry();
revoke all on function private.guard_journal_entry() from public;

-- Rewrites a function in place with one or more text substitutions, failing loudly if the text
-- it expects isn't there (so a later change to the function can't be silently skipped).
create function private.patch_function(p_fn regprocedure, p_find text[], p_replace text[])
returns void language plpgsql set search_path = '' as $$
declare d text := pg_get_functiondef(p_fn);
begin
  for i in 1 .. cardinality(p_find) loop
    if position(p_find[i] in d) = 0 then
      raise exception 'patch_function: % no longer contains %', p_fn, p_find[i];
    end if;
    d := replace(d, p_find[i], p_replace[i]);
  end loop;
  execute d;
end $$;
revoke all on function private.patch_function(regprocedure, text[], text[]) from public;

-- The transaction list: bank and card lines only, unless asked for journal entries or drilled
-- into a category (a report's Depreciation line shows its entries).
select private.patch_function(
  'public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[], bigint)'::regprocedure,
  array['where t.business_id = p_business_id'],
  array['where t.business_id = p_business_id
    and (t.source::text <> ''journal'' or p_category_ids is not null or ''journal'' = any (p_sources::text[]))']);
-- Money in/out, vendors and the largest payment: no money moved.
select private.patch_function('public.money_movement(uuid, date, date)'::regprocedure,
  array['and t.kind <> ''transfer'''], array['and t.kind <> ''transfer'' and t.source::text <> ''journal''']);
select private.patch_function('public.vendor_totals(uuid, date, date, text, int)'::regprocedure,
  array['and t.kind not in (''transfer'', ''equity'')'], array['and t.kind not in (''transfer'', ''equity'') and t.source::text <> ''journal''']);
select private.patch_function('public.overview_notes(uuid, date, date)'::regprocedure,
  array['and t.amount_cents < 0 and t.kind <> ''transfer'''], array['and t.amount_cents < 0 and t.kind <> ''transfer'' and t.source::text <> ''journal''']);

-- ---------------------------------------------------------------------------
-- 2. Fixed assets and depreciation
-- ---------------------------------------------------------------------------
-- The accounts depreciation needs, found by subtype and created (or adopted, if the business
-- already has one by that name) the first time.
create function private.ensure_account(p_business_id uuid, p_subtype text, p_name text, p_type public.account_type,
  p_system boolean, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts where business_id = p_business_id and subtype = p_subtype order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  update public.accounts set subtype = p_subtype, archived_at = null
  where business_id = p_business_id and lower(name) = lower(p_name) and type = p_type and subtype is null
    and not is_money_account and not is_system
  returning id into v_id;
  if v_id is not null then return v_id; end if;
  insert into public.accounts (business_id, name, type, subtype, is_system, is_standard, description)
  values (p_business_id,
          case when exists (select 1 from public.accounts where business_id = p_business_id and lower(name) = lower(p_name))
               then p_name || ' (assets)' else p_name end,
          p_type, p_subtype, p_system, true, p_description)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function private.ensure_account(uuid, text, text, public.account_type, boolean, text) from public;

create function private.depreciation_accounts(p_business_id uuid, out accumulated_id uuid, out expense_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  accumulated_id := private.ensure_account(p_business_id, 'accumulated_depreciation', 'Accumulated Depreciation', 'asset', true,
    'Depreciation taken so far on the business''s fixed assets. Written by Tax → Assets; reduces their value on the balance sheet.');
  expense_id := private.ensure_account(p_business_id, 'depreciation', 'Depreciation', 'expense', false,
    'The part of a fixed asset''s cost used up this period (and Section 179 / bonus expensing).');
  insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
  values (p_business_id, expense_id, 'schedule_c', 'sch_c:13'), (p_business_id, expense_id, 'form_1120s', 'f1120s:14')
  on conflict do nothing;
end $$;
revoke all on function private.depreciation_accounts(uuid) from public;

-- Where an asset of each kind is kept on the balance sheet.
create function private.asset_account_for(p_business_id uuid, p_kind text)
returns uuid language sql security definer set search_path = '' as $$
  select case p_kind
    when 'vehicle' then private.ensure_account(p_business_id, 'fixed_asset_vehicle', 'Vehicles', 'asset', false,
      'Cars, trucks and trailers the business owns.')
    when 'building' then private.ensure_account(p_business_id, 'fixed_asset_building', 'Buildings & Improvements', 'asset', false,
      'Buildings, and improvements to property the business owns or leases.')
    when 'improvement' then private.ensure_account(p_business_id, 'fixed_asset_building', 'Buildings & Improvements', 'asset', false,
      'Buildings, and improvements to property the business owns or leases.')
    when 'land' then private.ensure_account(p_business_id, 'fixed_asset_land', 'Land', 'asset', false,
      'Land the business owns. Not depreciated.')
    else private.ensure_account(p_business_id, 'fixed_asset', 'Equipment', 'asset', false,
      'Computers, machinery, furniture and other equipment kept for more than a year.')
  end
$$;
revoke all on function private.asset_account_for(uuid, text) from public;

create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('vehicle', 'equipment', 'computer', 'furniture', 'building', 'improvement', 'land', 'other')),
  acquired_on date not null,
  in_service_on date not null,
  cost_cents bigint not null check (cost_cents > 0),
  salvage_cents bigint not null default 0 check (salvage_cents >= 0),
  method text not null check (method in ('straight_line', 'expense_now', 'none')),
  life_months integer check (life_months between 1 and 600),
  asset_account_id uuid not null,
  purchase_transaction_id uuid,
  disposed_on date,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, asset_account_id) references public.accounts (business_id, id),
  foreign key (business_id, purchase_transaction_id) references public.transactions (business_id, id) on delete set null (purchase_transaction_id),
  check (salvage_cents < cost_cents),
  check (in_service_on >= acquired_on),
  check (disposed_on is null or disposed_on >= in_service_on),
  check (method <> 'straight_line' or life_months is not null)
);
create index fixed_assets_business_idx on public.fixed_assets (business_id, in_service_on);
create index fixed_assets_account_idx on public.fixed_assets (business_id, asset_account_id);
create unique index fixed_assets_purchase_key on public.fixed_assets (business_id, purchase_transaction_id)
  where purchase_transaction_id is not null;
create trigger touch_updated_at before update on public.fixed_assets
  for each row execute function private.touch_updated_at();

create table public.depreciation_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  asset_id uuid not null,
  through date not null,
  -- Positive: depreciation taken; negative: a true-up after an edit lowered the schedule.
  amount_cents bigint not null check (amount_cents <> 0),
  transaction_id uuid not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (transaction_id),
  foreign key (business_id, asset_id) references public.fixed_assets (business_id, id) on delete cascade,
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade
);
create index depreciation_entries_asset_idx on public.depreciation_entries (business_id, asset_id, through);
create index depreciation_entries_tx_idx on public.depreciation_entries (business_id, transaction_id);

-- "Not an asset" / "Not health" / "Not retirement": the review lists stop suggesting it.
create table public.tax_skips (
  business_id uuid not null references public.businesses (id) on delete cascade,
  transaction_id uuid not null,
  what text not null check (what in ('asset', 'health', 'retirement')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (business_id, transaction_id, what),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade
);

alter table public.fixed_assets enable row level security;
alter table public.depreciation_entries enable row level security;
alter table public.tax_skips enable row level security;
revoke all on public.fixed_assets, public.depreciation_entries, public.tax_skips from anon;
revoke truncate, references, trigger on public.fixed_assets, public.depreciation_entries, public.tax_skips from authenticated;
create policy "members read" on public.fixed_assets for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy "members read" on public.depreciation_entries for select to authenticated
  using (business_id in (select private.my_business_ids()));
-- Assets and entries touch the ledger: written only by the functions below.
revoke insert, update, delete on public.fixed_assets, public.depreciation_entries from authenticated;
create policy "members read" on public.tax_skips for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy "writers insert" on public.tax_skips for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers delete" on public.tax_skips for delete to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')));
revoke update on public.tax_skips from authenticated;

-- Depreciation an asset should have taken by the end of p_through's month (cents, whole).
create function public.depreciation_through(
  p_method text, p_cost bigint, p_salvage bigint, p_life_months int, p_in_service date, p_disposed date, p_through date
) returns bigint
language sql immutable set search_path = '' as $$
  select case
    when p_method = 'none' or p_in_service > (date_trunc('month', p_through) + interval '1 month - 1 day')::date then 0
    when p_method = 'expense_now' then p_cost - p_salvage
    else (p_cost - p_salvage) * least(p_life_months, greatest(0,
           (extract(year from least(p_through, coalesce(p_disposed, p_through)))::int * 12
            + extract(month from least(p_through, coalesce(p_disposed, p_through)))::int)
         - (extract(year from p_in_service)::int * 12 + extract(month from p_in_service)::int) + 1)) / p_life_months
  end::bigint
$$;
grant execute on function public.depreciation_through(text, bigint, bigint, int, date, date, date) to authenticated;
revoke all on function public.depreciation_through(text, bigint, bigint, int, date, date, date) from anon;

create function private.check_asset(p_name text, p_kind text, p_acquired date, p_in_service date, p_cost bigint,
  p_salvage bigint, p_method text, p_life int, p_disposed date)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if nullif(btrim(p_name), '') is null then raise exception 'Name the asset' using errcode = '22023'; end if;
  if p_cost is null or p_cost <= 0 then raise exception 'Enter what it cost' using errcode = '22023'; end if;
  if coalesce(p_salvage, 0) < 0 or coalesce(p_salvage, 0) >= p_cost then
    raise exception 'Salvage value must be less than the cost' using errcode = '22023';
  end if;
  if p_in_service < p_acquired then raise exception 'It can''t go into service before it was bought' using errcode = '22023'; end if;
  if p_method = 'straight_line' and (p_life is null or p_life not between 1 and 600) then
    raise exception 'Enter a useful life between 1 month and 50 years' using errcode = '22023';
  end if;
  if p_kind = 'land' and p_method <> 'none' then raise exception 'Land isn''t depreciated' using errcode = '22023'; end if;
  if p_disposed is not null and p_disposed < p_in_service then
    raise exception 'It can''t be sold before it went into service' using errcode = '22023';
  end if;
end $$;
revoke all on function private.check_asset(text, text, date, date, bigint, bigint, text, int, date) from public;

-- Add an asset. With a purchase transaction, that transaction is filed to the asset's balance
-- sheet account (Equipment, Vehicles, …) instead of an expense, as the books require.
create function public.create_fixed_asset(
  p_business_id uuid, p_name text, p_kind text, p_acquired_on date, p_in_service_on date, p_cost_cents bigint,
  p_salvage_cents bigint default 0, p_method text default 'straight_line', p_life_months int default null,
  p_purchase_transaction_id uuid default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid;
  v_id uuid;
  t public.transactions;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  perform private.check_asset(p_name, p_kind, p_acquired_on, p_in_service_on, p_cost_cents, p_salvage_cents, p_method, p_life_months, null);
  v_account := private.asset_account_for(p_business_id, p_kind);
  if p_purchase_transaction_id is not null then
    select * into t from public.transactions where id = p_purchase_transaction_id and business_id = p_business_id and deleted_at is null;
    if t.id is null then raise exception 'That purchase isn''t in these books' using errcode = '23503'; end if;
    if t.amount_cents >= 0 then raise exception 'Pick the payment for the asset (money out)' using errcode = '22023'; end if;
    if exists (select 1 from public.fixed_assets where business_id = p_business_id and purchase_transaction_id = t.id) then
      raise exception 'That purchase is already an asset' using errcode = '23505';
    end if;
    if t.category_account_id is distinct from v_account then
      perform public.categorize_transactions(array[t.id], v_account);
    end if;
  end if;
  insert into public.fixed_assets (business_id, name, kind, acquired_on, in_service_on, cost_cents, salvage_cents, method,
    life_months, asset_account_id, purchase_transaction_id, notes)
  values (p_business_id, btrim(p_name), p_kind, p_acquired_on, p_in_service_on, p_cost_cents, coalesce(p_salvage_cents, 0),
    p_method, case when p_method = 'straight_line' then p_life_months end, v_account, p_purchase_transaction_id, nullif(btrim(p_notes), ''))
  returning id into v_id;
  delete from public.tax_skips where business_id = p_business_id and transaction_id = p_purchase_transaction_id and what = 'asset';
  perform private.audit(p_business_id, 'create', 'fixed_assets', v_id, null,
    (select to_jsonb(a) from public.fixed_assets a where a.id = v_id));
  return v_id;
end $$;

-- Change an asset. Posted depreciation is trued up to the new schedule the next time
-- depreciation is posted. Record a sale with p_disposed_on.
create function public.update_fixed_asset(
  p_asset_id uuid, p_name text, p_kind text, p_acquired_on date, p_in_service_on date, p_cost_cents bigint,
  p_salvage_cents bigint, p_method text, p_life_months int, p_disposed_on date, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets;
begin
  select * into a from public.fixed_assets where id = p_asset_id;
  if a.id is null then raise exception 'Asset not found' using errcode = '23503'; end if;
  perform private.require_role(a.business_id, '{owner,editor}');
  perform private.check_asset(p_name, p_kind, p_acquired_on, p_in_service_on, p_cost_cents, p_salvage_cents, p_method, p_life_months, p_disposed_on);
  if p_kind is distinct from a.kind and a.purchase_transaction_id is not null
     and private.asset_account_for(a.business_id, p_kind) <> a.asset_account_id then
    perform public.categorize_transactions(array[a.purchase_transaction_id], private.asset_account_for(a.business_id, p_kind));
  end if;
  update public.fixed_assets set name = btrim(p_name), kind = p_kind, acquired_on = p_acquired_on, in_service_on = p_in_service_on,
    cost_cents = p_cost_cents, salvage_cents = coalesce(p_salvage_cents, 0), method = p_method,
    life_months = case when p_method = 'straight_line' then p_life_months end, disposed_on = p_disposed_on,
    notes = nullif(btrim(p_notes), ''), asset_account_id = private.asset_account_for(a.business_id, p_kind)
  where id = a.id;
  perform private.audit(a.business_id, 'update', 'fixed_assets', a.id, to_jsonb(a),
    (select to_jsonb(x) from public.fixed_assets x where x.id = a.id));
end $$;

-- Remove an asset that has no depreciation posted. Its purchase stays filed where it is.
create function public.delete_fixed_asset(p_asset_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.fixed_assets;
begin
  select * into a from public.fixed_assets where id = p_asset_id;
  if a.id is null then return; end if;
  perform private.require_role(a.business_id, '{owner,editor}');
  if exists (select 1 from public.depreciation_entries e join public.transactions t on t.id = e.transaction_id
             where e.asset_id = a.id and t.deleted_at is null) then
    raise exception 'Undo the depreciation posted for this asset first' using errcode = 'P0001';
  end if;
  delete from public.fixed_assets where id = a.id;
  perform private.audit(a.business_id, 'delete', 'fixed_assets', a.id, to_jsonb(a), null);
end $$;

-- Post depreciation through the end of p_through's month: one entry per asset that is behind
-- (or ahead, after an edit) of its schedule. Returns the number of entries posted.
create function public.post_depreciation(p_business_id uuid, p_through date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_through date := (date_trunc('month', p_through) + interval '1 month - 1 day')::date;
  v_acc record;
  a public.fixed_assets;
  v_target bigint;
  v_posted bigint;
  v_diff bigint;
  v_tx uuid;
  v_count int := 0;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  perform private.require_unlocked(p_business_id, v_through);
  select * into v_acc from private.depreciation_accounts(p_business_id);
  perform set_config('quickacct.journal_write', 'on', true);
  for a in
    select * from public.fixed_assets where business_id = p_business_id and method <> 'none' and in_service_on <= v_through
    order by in_service_on, name for update
  loop
    -- Never post behind an asset's latest entry.
    continue when exists (select 1 from public.depreciation_entries e join public.transactions t on t.id = e.transaction_id
                          where e.asset_id = a.id and t.deleted_at is null and e.through > v_through);
    v_target := public.depreciation_through(a.method, a.cost_cents, a.salvage_cents, a.life_months, a.in_service_on, a.disposed_on, v_through);
    select coalesce(sum(e.amount_cents), 0) into v_posted
    from public.depreciation_entries e join public.transactions t on t.id = e.transaction_id
    where e.asset_id = a.id and t.deleted_at is null;
    v_diff := v_target - v_posted;
    continue when v_diff = 0;
    insert into public.transactions (business_id, date, description_raw, description_clean, amount_cents, money_account_id,
      category_account_id, kind, memo, source)
    values (p_business_id, v_through, 'Depreciation: ' || a.name, 'Depreciation: ' || a.name, -v_diff, v_acc.accumulated_id,
      v_acc.expense_id, 'expense',
      case when a.method = 'expense_now' then 'Expensed when placed in service' else 'Straight-line, ' || a.life_months || ' months' end,
      'journal')
    returning id into v_tx;
    perform private.post_lines_for(array[v_tx]);
    insert into public.depreciation_entries (business_id, asset_id, through, amount_cents, transaction_id)
    values (p_business_id, a.id, v_through, v_diff, v_tx);
    perform private.audit(p_business_id, 'create', 'transactions', v_tx, null,
      (select to_jsonb(t) from public.transactions t where t.id = v_tx));
    v_count := v_count + 1;
  end loop;
  perform set_config('quickacct.journal_write', 'off', true);
  return v_count;
end $$;

-- Take back the latest posting (every entry dated at the latest month end posted).
create function public.undo_depreciation(p_business_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_through date;
  v_ids uuid[];
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  select max(e.through) into v_through from public.depreciation_entries e join public.transactions t on t.id = e.transaction_id
  where e.business_id = p_business_id and t.deleted_at is null;
  if v_through is null then return 0; end if;
  perform private.require_unlocked(p_business_id, v_through);
  select array_agg(e.transaction_id) into v_ids from public.depreciation_entries e join public.transactions t on t.id = e.transaction_id
  where e.business_id = p_business_id and e.through = v_through and t.deleted_at is null;
  perform set_config('quickacct.journal_write', 'on', true);
  update public.transactions set deleted_at = now(), deleted_by = (select auth.uid()) where id = any (v_ids);
  perform set_config('quickacct.journal_write', 'off', true);
  delete from public.depreciation_entries where transaction_id = any (v_ids);
  perform private.audit(p_business_id, 'undo', 'depreciation_entries', null, jsonb_build_object('through', v_through), null);
  return cardinality(v_ids);
end $$;

-- Each asset with what's been posted and what its schedule says as of p_as_of's month end.
create function public.fixed_asset_summary(p_business_id uuid, p_as_of date)
returns table (asset_id uuid, posted_cents bigint, scheduled_cents bigint, last_through date, book_value_cents bigint, monthly_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select a.id, coalesce(p.posted, 0)::bigint,
    public.depreciation_through(a.method, a.cost_cents, a.salvage_cents, a.life_months, a.in_service_on, a.disposed_on, p_as_of),
    p.last_through,
    (a.cost_cents - coalesce(p.posted, 0))::bigint,
    case when a.method = 'straight_line' then ((a.cost_cents - a.salvage_cents) / a.life_months)::bigint else 0 end
  from public.fixed_assets a
  left join lateral (
    select sum(e.amount_cents) as posted, max(e.through) as last_through
    from public.depreciation_entries e
    where e.business_id = a.business_id and e.asset_id = a.id
      and not exists (select 1 from public.transactions t where t.business_id = e.business_id and t.id = e.transaction_id and t.deleted_at is not null)
  ) p on true
  where a.business_id = p_business_id
$$;

-- Payments big enough to be equipment or a vehicle (default $2,500, the de minimis safe
-- harbor), not yet an asset and not waved off. Transfers and owner draws don't count.
create function public.large_purchase_candidates(p_business_id uuid, p_min_cents bigint default 250000, p_since date default null)
returns table (transaction_id uuid, date date, description text, amount_cents bigint, category_account_id uuid, money_account_id uuid)
language sql stable security invoker set search_path = '' as $$
  select t.id, t.date, coalesce(t.description_clean, t.description_raw), -t.amount_cents, t.category_account_id, t.money_account_id
  from public.transactions t
  left join public.accounts c on c.business_id = t.business_id and c.id = t.category_account_id
  where t.business_id = p_business_id and t.deleted_at is null
    and t.source::text <> 'journal'
    and t.amount_cents <= -greatest(coalesce(p_min_cents, 250000), 1)
    and t.date >= coalesce(p_since, current_date - 730)
    and (t.category_account_id is null or c.type = 'expense' or c.subtype like 'fixed_asset%')
    and not exists (select 1 from public.fixed_assets f where f.business_id = t.business_id and f.purchase_transaction_id = t.id)
    and not exists (select 1 from public.tax_skips s where s.business_id = t.business_id and s.transaction_id = t.id and s.what = 'asset')
  order by t.amount_cents, t.date desc
  limit 50
$$;

revoke all on function
  public.create_fixed_asset(uuid, text, text, date, date, bigint, bigint, text, int, uuid, text),
  public.update_fixed_asset(uuid, text, text, date, date, bigint, bigint, text, int, date, text),
  public.delete_fixed_asset(uuid), public.post_depreciation(uuid, date), public.undo_depreciation(uuid),
  public.fixed_asset_summary(uuid, date), public.large_purchase_candidates(uuid, bigint, date)
  from public, anon;
grant execute on function
  public.create_fixed_asset(uuid, text, text, date, date, bigint, bigint, text, int, uuid, text),
  public.update_fixed_asset(uuid, text, text, date, date, bigint, bigint, text, int, date, text),
  public.delete_fixed_asset(uuid), public.post_depreciation(uuid, date), public.undo_depreciation(uuid),
  public.fixed_asset_summary(uuid, date), public.large_purchase_candidates(uuid, bigint, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Health and retirement log (before documents, which can point at it)
-- ---------------------------------------------------------------------------
create table public.tax_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('health', 'retirement')),
  -- "Health insurance premium", "HSA", "SEP-IRA", "401(k)", …
  item_type text not null check (length(btrim(item_type)) between 1 and 60),
  -- Whose it is: "Owner", or an employee's name.
  person text check (person is null or length(person) <= 120),
  date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (length(btrim(description)) between 1 and 200),
  transaction_id uuid,
  note text check (note is null or length(note) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete set null (transaction_id)
);
create index tax_items_business_idx on public.tax_items (business_id, kind, date);
create unique index tax_items_transaction_key on public.tax_items (business_id, transaction_id, kind) where transaction_id is not null;
create trigger touch_updated_at before update on public.tax_items
  for each row execute function private.touch_updated_at();

-- Payments worded like health insurance or retirement contributions, not yet logged.
create function public.tax_item_candidates(p_business_id uuid, p_from date, p_to date)
returns table (kind text, transaction_id uuid, date date, description text, amount_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select w.kind, t.id, t.date, coalesce(t.description_clean, t.description_raw), -t.amount_cents
  from public.transactions t
  cross join lateral (select lower(t.description_raw || ' ' || coalesce(t.vendor_normalized, '')) as d) x
  cross join lateral (
    select 'health'::text as kind
    where x.d ~ '(\mhealth\s*(ins|care|plan)|blue\s*cross|\mbcbs\M|aetna|cigna|humana|united\s*health|\muhc\M|kaiser|anthem|oscar health|ambetter|\mhsa\M|health\s*equity|healthequity|delta dental|\mdental\M|vision\s*(plan|ins)|\mvsp\M)'
    union all
    select 'retirement'
    where x.d ~ '(401\s*\(?k\)?|\mira\M|sep[- ]?ira|simple[- ]?ira|\mroth\M|retirement|guideline|human interest|\mbetterment\M|ubiquity|\mpension\M)'
  ) w
  where t.business_id = p_business_id and t.deleted_at is null and t.source::text <> 'journal'
    and t.amount_cents < 0 and t.date between p_from and p_to
    and not exists (select 1 from public.tax_items i where i.business_id = t.business_id and i.transaction_id = t.id and i.kind = w.kind)
    and not exists (select 1 from public.tax_skips s where s.business_id = t.business_id and s.transaction_id = t.id and s.what = w.kind)
  order by t.date desc
  limit 100
$$;
revoke all on function public.tax_item_candidates(uuid, date, date) from public, anon;
grant execute on function public.tax_item_candidates(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Mileage
-- ---------------------------------------------------------------------------
-- IRS business standard mileage rates, in tenths of a cent per mile, from a date on.
create table public.mileage_rates (
  effective_from date primary key,
  rate_tenth_cents integer not null check (rate_tenth_cents > 0),
  source text
);
insert into public.mileage_rates (effective_from, rate_tenth_cents, source) values
  ('2024-01-01', 670, 'IRS Notice 2024-08'),
  ('2025-01-01', 700, 'IRS Notice 2025-5'),
  ('2026-01-01', 725, 'IRS IR-2025-128'),
  ('2026-07-01', 760, 'IRS mid-year increase, July 1, 2026');
alter table public.mileage_rates enable row level security;
revoke all on public.mileage_rates from anon;
revoke insert, update, delete, truncate, references, trigger on public.mileage_rates from authenticated;
create policy "anyone signed in reads" on public.mileage_rates for select to authenticated using (true);

create table public.mileage_trips (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  date date not null,
  -- Tenths of a mile (12.4 miles = 124), so no floats.
  miles_tenths integer not null check (miles_tenths between 1 and 100000),
  purpose text not null check (length(btrim(purpose)) between 1 and 200),
  start_place text check (start_place is null or length(start_place) <= 200),
  end_place text check (end_place is null or length(end_place) <= 200),
  vehicle text check (vehicle is null or length(vehicle) <= 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create index mileage_trips_business_idx on public.mileage_trips (business_id, date);
create trigger touch_updated_at before update on public.mileage_trips
  for each row execute function private.touch_updated_at();

-- Each trip with the rate in force on its date and its deduction (whole cents, rounded).
create view public.mileage_trips_rated with (security_invoker = true) as
select t.id, t.business_id, t.date, t.miles_tenths, t.purpose, t.start_place, t.end_place, t.vehicle, t.created_at,
  r.rate_tenth_cents,
  ((t.miles_tenths::bigint * coalesce(r.rate_tenth_cents, 0) + 50) / 100)::bigint as deduction_cents
from public.mileage_trips t
left join lateral (
  select m.rate_tenth_cents from public.mileage_rates m where m.effective_from <= t.date order by m.effective_from desc limit 1
) r on true;
revoke all on public.mileage_trips_rated from anon;
grant select on public.mileage_trips_rated to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Documents
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  content_type text not null check (length(content_type) <= 120),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  -- <business_id>/<document id>/<file name> in the `documents` bucket.
  storage_path text not null unique,
  kind text not null default 'receipt' check (kind in ('receipt', 'bill_of_sale', 'mileage_log', 'health', 'retirement', 'other')),
  transaction_id uuid,
  asset_id uuid,
  tax_item_id uuid,
  note text check (note is null or length(note) <= 1000),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (split_part(storage_path, '/', 1) = business_id::text),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete set null (transaction_id),
  foreign key (business_id, asset_id) references public.fixed_assets (business_id, id) on delete set null (asset_id),
  foreign key (business_id, tax_item_id) references public.tax_items (business_id, id) on delete set null (tax_item_id)
);
create index documents_business_idx on public.documents (business_id, created_at desc);
create index documents_transaction_idx on public.documents (business_id, transaction_id) where transaction_id is not null;
create index documents_asset_idx on public.documents (business_id, asset_id) where asset_id is not null;
create index documents_tax_item_idx on public.documents (business_id, tax_item_id) where tax_item_id is not null;
create trigger touch_updated_at before update on public.documents
  for each row execute function private.touch_updated_at();

-- Logs and documents: members read, owners and editors write.
alter table public.tax_items enable row level security;
alter table public.mileage_trips enable row level security;
alter table public.documents enable row level security;
revoke all on public.tax_items, public.mileage_trips, public.documents from anon;
revoke truncate, references, trigger on public.tax_items, public.mileage_trips, public.documents from authenticated;
do $$
declare tbl text;
begin
  foreach tbl in array array['tax_items', 'mileage_trips', 'documents'] loop
    execute format('create policy "members read" on public.%I for select to authenticated
      using (business_id in (select private.my_business_ids()))', tbl);
    execute format('create policy "writers insert" on public.%I for insert to authenticated
      with check (business_id in (select private.my_business_ids(''{owner,editor}'')))', tbl);
    execute format('create policy "writers update" on public.%I for update to authenticated
      using (business_id in (select private.my_business_ids(''{owner,editor}'')))
      with check (business_id in (select private.my_business_ids(''{owner,editor}'')))', tbl);
    execute format('create policy "writers delete" on public.%I for delete to authenticated
      using (business_id in (select private.my_business_ids(''{owner,editor}'')))', tbl);
  end loop;
end $$;
-- A document's file never changes; only what it's attached to and its note.
revoke update on public.documents from authenticated;
grant update (kind, transaction_id, asset_id, tax_item_id, note) on public.documents to authenticated;

-- Private bucket: files live under <business_id>/; members read, owners and editors add and remove.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 20971520,
      array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'text/csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
    on conflict (id) do nothing;
    execute $p$
      create policy "documents: members read" on storage.objects for select to authenticated
      using (bucket_id = 'documents'
             and (storage.foldername(name))[1] in (select b::text from private.my_business_ids() b))
    $p$;
    execute $p$
      create policy "documents: writers add" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents'
             and (storage.foldername(name))[1] in (select b::text from private.my_business_ids('{owner,editor}') b))
    $p$;
    execute $p$
      create policy "documents: writers delete" on storage.objects for delete to authenticated
      using (bucket_id = 'documents'
             and (storage.foldername(name))[1] in (select b::text from private.my_business_ids('{owner,editor}') b))
    $p$;
  end if;
end $$;

-- Pattern engine (SPEC Prompt 9, no AI): per-business vendor stats, recurring charges,
-- large-transaction flags and auto-created category rules, recomputed after every import
-- commit and nightly. Also: where a transaction's category came from (user, rule, import
-- file), so only categories a person chose count as confirmations; rules apply to new
-- uncategorized import rows at commit.

-- ---------------------------------------------------------------------------
-- Where a category came from
-- ---------------------------------------------------------------------------
create type public.category_source as enum ('user', 'rule', 'import');

-- category_rules gets (business_id, id) for composite references, and soft delete: a
-- deleted rule stays as a tombstone so the engine doesn't recreate it.
alter table public.category_rules
  add unique (business_id, id),
  add column deleted_at timestamptz;

alter table public.transactions
  add column category_source public.category_source,
  add column category_rule_id uuid,
  add foreign key (business_id, category_rule_id) references public.category_rules (business_id, id)
    on delete set null (category_rule_id);

-- Existing categories: from the import file, or chosen by a person.
update public.transactions
set category_source = case when source = 'import' then 'import' else 'user' end::public.category_source
where category_account_id is not null;
-- Run the deferred balance checks now; ALTER TABLE refuses while trigger events are pending.
set constraints all immediate;

alter table public.transactions
  add constraint transactions_category_source_check check ((category_account_id is null) = (category_source is null)),
  add constraint transactions_rule_source_check check (category_rule_id is null or category_source = 'rule');

-- The posting functions never pass a source: a new category is a person's choice unless
-- the writer says otherwise (commit_import marks 'import' and 'rule'). Changing the
-- category without naming a source (update_transaction, bulk categorize) makes it 'user'.
create function private.set_category_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.category_account_id is null then
    new.category_source := null;
  elsif tg_op = 'INSERT' then
    new.category_source := coalesce(new.category_source, 'user');
  elsif new.category_account_id is distinct from old.category_account_id
        and new.category_source is not distinct from old.category_source then
    new.category_source := 'user';
  elsif new.category_source is null then
    new.category_source := coalesce(old.category_source, 'user');
  end if;
  if new.category_source is distinct from 'rule' then
    new.category_rule_id := null;
  end if;
  return new;
end $$;
create trigger set_category_source before insert or update of category_account_id, category_source
  on public.transactions for each row execute function private.set_category_source();

-- ---------------------------------------------------------------------------
-- Rules: direct writes (RLS: owners and editors) can't point at a system or archived
-- category or forge engine fields; the RPCs below are what the app uses.
-- Runs as the caller (not security definer) so current_user tells API writes apart.
-- ---------------------------------------------------------------------------
create function private.guard_category_rule() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_via_api boolean := current_user = 'authenticated';
  c public.accounts;
begin
  if tg_op = 'INSERT' or new.category_account_id is distinct from old.category_account_id then
    select * into c from public.accounts where id = new.category_account_id and business_id = new.business_id;
    if c.id is not null and (c.is_system or c.archived_at is not null) then
      raise exception 'Rules need an active, non-system category' using errcode = '22023';
    end if;
  end if;
  if v_via_api then
    if tg_op = 'INSERT' then
      new.source := 'manual';
      new.confirmations := 0;
    else
      new.source := old.source;
      new.confirmations := old.confirmations;
    end if;
  end if;
  return new;
end $$;
create trigger guard_category_rule before insert or update on public.category_rules
  for each row execute function private.guard_category_rule();

-- "Apply to similar" revives a deleted rule.
create or replace function public.save_category_rule(p_business_id uuid, p_vendor_normalized text, p_category_account_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_vendor text := nullif(btrim(p_vendor_normalized), '');
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if v_vendor is null then
    raise exception 'A rule needs a vendor' using errcode = '22023';
  end if;
  if not exists (select 1 from public.accounts where id = p_category_account_id and business_id = p_business_id
                 and not is_system and archived_at is null) then
    raise exception 'Pick an active category from this business' using errcode = '22023';
  end if;
  insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, created_by)
  values (p_business_id, v_vendor, p_category_account_id, 'manual', (select auth.uid()))
  on conflict (business_id, vendor_normalized)
  do update set category_account_id = excluded.category_account_id, enabled = true, deleted_at = null
  returning id into v_id;
  perform private.audit(p_business_id, 'save_rule', 'category_rules', v_id, null,
    jsonb_build_object('vendor_normalized', v_vendor, 'category_account_id', p_category_account_id));
  return v_id;
end $$;

-- Edit a rule's category and on/off switch (the Rules page).
create function public.update_category_rule(p_rule_id uuid, p_category_account_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.category_rules;
begin
  select * into r from public.category_rules where id = p_rule_id and deleted_at is null for update;
  if r.id is null then
    raise exception 'Rule not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, '{owner,editor}');
  if not exists (select 1 from public.accounts where id = p_category_account_id and business_id = r.business_id
                 and not is_system and archived_at is null) then
    raise exception 'Pick an active category from this business' using errcode = '22023';
  end if;
  update public.category_rules set category_account_id = p_category_account_id, enabled = coalesce(p_enabled, enabled)
  where id = r.id;
  perform private.audit(r.business_id, 'update_rule', 'category_rules', r.id,
    jsonb_build_object('category_account_id', r.category_account_id, 'enabled', r.enabled),
    jsonb_build_object('category_account_id', p_category_account_id, 'enabled', coalesce(p_enabled, r.enabled)));
end $$;

-- Delete a rule. It stays as a tombstone (hidden, off) so the engine won't recreate it
-- from the same confirmations; "apply to similar" can bring it back.
create function public.delete_category_rule(p_rule_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.category_rules;
begin
  select * into r from public.category_rules where id = p_rule_id and deleted_at is null for update;
  if r.id is null then
    raise exception 'Rule not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, '{owner,editor}');
  update public.category_rules set deleted_at = now(), enabled = false where id = r.id;
  perform private.audit(r.business_id, 'delete_rule', 'category_rules', r.id, to_jsonb(r), null);
end $$;

-- ---------------------------------------------------------------------------
-- Large-transaction threshold (owners set it in Settings)
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column large_threshold_cents bigint check (large_threshold_cents is null or large_threshold_cents > 0);
grant update (large_threshold_cents) on public.businesses to authenticated;

-- ---------------------------------------------------------------------------
-- Patterns
-- ---------------------------------------------------------------------------
create type public.pattern_kind as enum ('vendor', 'recurring', 'large');

create table public.transaction_patterns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.pattern_kind not null,
  vendor_normalized text,
  -- vendor: every live transaction from the vendor.
  txn_count integer,
  first_seen date,
  last_seen date,
  -- Most common category people chose for this vendor (null if none yet).
  typical_category_id uuid,
  -- Median signed amount.
  typical_amount_cents bigint,
  -- recurring: one stream per vendor and direction.
  direction text check (direction in ('in', 'out')),
  cadence text check (cadence in ('weekly', 'monthly', 'quarterly', 'annual')),
  -- exact: every occurrence the same amount (a subscription); approx: within ±10%.
  amount_match text check (amount_match in ('exact', 'approx')),
  expected_next_date date,
  expected_amount_cents bigint,
  last_date date,
  last_amount_cents bigint,
  status text check (status in ('ok', 'missed', 'amount_changed')),
  -- large: the transaction and which rules fired (vendor_median, p95, threshold).
  transaction_id uuid,
  amount_cents bigint,
  large_rules text[],
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade,
  foreign key (business_id, typical_category_id) references public.accounts (business_id, id) on delete set null (typical_category_id),
  check (kind <> 'vendor' or (vendor_normalized is not null and txn_count > 0 and first_seen is not null and last_seen is not null)),
  check (kind <> 'recurring' or (vendor_normalized is not null and direction is not null and cadence is not null
         and amount_match is not null and expected_next_date is not null and expected_amount_cents is not null and status is not null)),
  check (kind <> 'large' or (transaction_id is not null and amount_cents is not null and cardinality(large_rules) > 0))
);
create unique index transaction_patterns_vendor_key on public.transaction_patterns (business_id, vendor_normalized) where kind = 'vendor';
create unique index transaction_patterns_recurring_key on public.transaction_patterns (business_id, vendor_normalized, direction) where kind = 'recurring';
create unique index transaction_patterns_large_key on public.transaction_patterns (business_id, transaction_id) where kind = 'large';
create trigger touch_updated_at before update on public.transaction_patterns
  for each row execute function private.touch_updated_at();

-- Members read; only the engine writes.
alter table public.transaction_patterns enable row level security;
create policy "members read" on public.transaction_patterns for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.transaction_patterns from authenticated;
revoke all on public.transaction_patterns from anon;

create index transactions_business_vendor_date_idx on public.transactions (business_id, vendor_normalized, date)
  where deleted_at is null and vendor_normalized is not null;

-- ---------------------------------------------------------------------------
-- The engine. Recomputes one business's patterns from scratch (idempotent), then creates
-- auto rules: a vendor whose live transactions people categorized 3+ times, always the
-- same way. p_as_of is "today" (tests pin it). Returns counts.
-- ---------------------------------------------------------------------------
create function private.refresh_patterns(p_business_id uuid, p_as_of date default current_date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  n int;
  v_last int;            -- index of the latest occurrence
  v_matched int[];
  v_gaps int[];
  v_need int;
  v_cadence text;
  v_step interval;
  v_grace int;
  v_exact boolean;
  v_prior_amounts bigint[];
  v_status text;
  v_last_matched int;
  v_next date;
  v_expected bigint;
  v_p95 bigint;
  v_threshold bigint;
  v_vendors int;
  v_recurring int := 0;
  v_large int;
  v_rules int;
begin
  delete from public.transaction_patterns where business_id = p_business_id;

  -- 1. Same vendor.
  insert into public.transaction_patterns (business_id, kind, vendor_normalized, txn_count, first_seen, last_seen,
    typical_category_id, typical_amount_cents)
  select p_business_id, 'vendor', t.vendor_normalized, count(*), min(t.date), max(t.date),
    mode() within group (order by t.category_account_id) filter (where t.category_source = 'user'),
    percentile_disc(0.5) within group (order by t.amount_cents)
  from public.transactions t
  where t.business_id = p_business_id and t.deleted_at is null and t.vendor_normalized is not null and t.date <= p_as_of
  group by t.vendor_normalized;
  get diagnostics v_vendors = row_count;

  -- 2. Recurring: per vendor and direction, occurrences within ±10% of the stream's
  -- median amount, 3+ of them, with gaps that fit one cadence (a fifth may be off).
  for s in
    select t.vendor_normalized as vendor, case when t.amount_cents < 0 then 'out' else 'in' end as dir,
      array_agg(t.date order by t.date, t.created_at, t.id) as dates,
      array_agg(abs(t.amount_cents) order by t.date, t.created_at, t.id) as amts,
      percentile_disc(0.5) within group (order by abs(t.amount_cents)) as med
    from public.transactions t
    where t.business_id = p_business_id and t.deleted_at is null and t.vendor_normalized is not null
      and t.date <= p_as_of and t.kind <> 'transfer'
    group by 1, 2
    having count(*) >= 3
  loop
    n := cardinality(s.dates);
    v_last := n;
    -- Integer test for |a - med| <= 10% of med.
    v_matched := array(select k from generate_series(1, n) k where abs(s.amts[k] - s.med) * 10 <= s.med);
    continue when cardinality(v_matched) < 3;
    v_gaps := array(select s.dates[v_matched[k]] - s.dates[v_matched[k - 1]] from generate_series(2, cardinality(v_matched)) k);
    v_need := cardinality(v_gaps) - cardinality(v_gaps) / 5;
    v_cadence := case
      when (select count(*) from unnest(v_gaps) g where g between 5 and 9) >= v_need then 'weekly'
      when (select count(*) from unnest(v_gaps) g where g between 28 and 35) >= v_need then 'monthly'
      when (select count(*) from unnest(v_gaps) g where g between 84 and 98) >= v_need then 'quarterly'
      when (select count(*) from unnest(v_gaps) g where g between 350 and 380) >= v_need then 'annual'
    end;
    continue when v_cadence is null;
    v_step := case v_cadence when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                             when 'quarterly' then interval '3 months' else interval '1 year' end;
    v_grace := case v_cadence when 'weekly' then 3 when 'monthly' then 7 when 'quarterly' then 15 else 30 end;

    v_last_matched := v_matched[cardinality(v_matched)];
    -- Amounts before the latest occurrence, for the exact-subscription test.
    v_prior_amounts := array(select s.amts[k] from unnest(v_matched) k where k < v_last);
    v_exact := (select count(distinct a) = 1 from unnest(v_prior_amounts) a);
    if v_last_matched <> v_last or (v_exact and s.amts[v_last] <> v_prior_amounts[1]) then
      -- The latest charge is outside the band, or a fixed subscription charged a new amount.
      v_status := 'amount_changed';
    else
      v_status := 'ok';
    end if;
    v_next := (s.dates[v_last] + v_step)::date;
    if v_status = 'ok' and p_as_of > v_next + v_grace then
      v_status := 'missed';
    end if;
    v_expected := case when v_exact then s.amts[v_last] else s.med end;

    insert into public.transaction_patterns (business_id, kind, vendor_normalized, direction, cadence, amount_match,
      expected_next_date, expected_amount_cents, last_date, last_amount_cents, txn_count, first_seen, status)
    values (p_business_id, 'recurring', s.vendor, s.dir, v_cadence, case when v_exact then 'exact' else 'approx' end,
      v_next, case when s.dir = 'out' then -v_expected else v_expected end, s.dates[v_last],
      case when s.dir = 'out' then -s.amts[v_last] else s.amts[v_last] end, cardinality(v_matched),
      s.dates[v_matched[1]], v_status);
    v_recurring := v_recurring + 1;
  end loop;

  -- 3. Large outflows in the 12 months to p_as_of.
  select case when count(*) >= 20 then percentile_disc(0.95) within group (order by -t.amount_cents) end
  into v_p95
  from public.transactions t
  where t.business_id = p_business_id and t.deleted_at is null and t.amount_cents < 0 and t.kind <> 'transfer'
    and t.date > (p_as_of - interval '12 months')::date and t.date <= p_as_of;
  select large_threshold_cents into v_threshold from public.businesses where id = p_business_id;

  insert into public.transaction_patterns (business_id, kind, vendor_normalized, transaction_id, amount_cents, large_rules)
  select p_business_id, 'large', t.vendor_normalized, t.id, t.amount_cents, f.rules
  from public.transactions t
  left join lateral (
    -- That vendor's earlier outflows.
    select count(*) as n, percentile_disc(0.5) within group (order by -p.amount_cents) as med
    from public.transactions p
    where p.business_id = t.business_id and p.vendor_normalized = t.vendor_normalized and p.deleted_at is null
      and p.amount_cents < 0 and (p.date, p.created_at, p.id) < (t.date, t.created_at, t.id)
  ) v on t.vendor_normalized is not null
  cross join lateral (select array_remove(array[
    case when v.n >= 3 and -t.amount_cents > 3 * v.med then 'vendor_median' end,
    case when v_p95 is not null and -t.amount_cents > v_p95 then 'p95' end,
    case when v_threshold is not null and -t.amount_cents > v_threshold then 'threshold' end
  ], null) as rules) f
  where t.business_id = p_business_id and t.deleted_at is null and t.amount_cents < 0 and t.kind <> 'transfer'
    and t.date > (p_as_of - interval '12 months')::date and t.date <= p_as_of
    and cardinality(f.rules) > 0;
  get diagnostics v_large = row_count;

  -- 4. Auto rules. Never overwrites a manual rule or a deleted one (tombstone); refreshes
  -- the confirmation count of an auto rule that still agrees.
  with agreed as (
    select t.vendor_normalized as vendor, (array_agg(t.category_account_id))[1] as category, count(*) as n
    from public.transactions t
    join public.accounts c on c.id = t.category_account_id
    where t.business_id = p_business_id and t.deleted_at is null and t.category_source = 'user'
      and t.vendor_normalized is not null and not c.is_system and c.archived_at is null
    group by t.vendor_normalized
    having count(*) >= 3 and count(distinct t.category_account_id) = 1
  ),
  -- A vendor with any person-chosen category that disagrees (even on an archived one) has a conflict.
  conflicted as (
    select t.vendor_normalized as vendor from public.transactions t
    where t.business_id = p_business_id and t.deleted_at is null and t.category_source = 'user' and t.vendor_normalized is not null
    group by 1 having count(distinct t.category_account_id) > 1
  ),
  ins as (
    insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, confirmations, created_by)
    select p_business_id, a.vendor, a.category, 'auto', a.n, null
    from agreed a where a.vendor not in (select vendor from conflicted)
    on conflict (business_id, vendor_normalized) do update set confirmations = excluded.confirmations
      where public.category_rules.source = 'auto' and public.category_rules.deleted_at is null
        and public.category_rules.category_account_id = excluded.category_account_id
    returning id, vendor_normalized, category_account_id, confirmations, (xmax = 0) as created
  ),
  audited as (
    insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
    select p_business_id, null, 'auto_rule', 'category_rules', i.id, null,
      jsonb_build_object('vendor_normalized', i.vendor_normalized, 'category_account_id', i.category_account_id,
                         'confirmations', i.confirmations)
    from ins i where i.created
    returning 1
  )
  select count(*) into v_rules from audited;

  return jsonb_build_object('vendors', v_vendors, 'recurring', v_recurring, 'large', v_large, 'rules_created', v_rules);
end $$;
revoke all on function private.refresh_patterns(uuid, date) from public;

-- After an import commit (the app calls this for owners and editors).
create function public.refresh_patterns(p_business_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  return private.refresh_patterns(p_business_id);
end $$;
revoke all on function public.refresh_patterns(uuid) from public, anon;
grant execute on function public.refresh_patterns(uuid) to authenticated;

-- Nightly server job (pg_cron, runs as postgres): every business, each in its own
-- subtransaction so one failure doesn't stop the rest.
create function private.refresh_all_patterns()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b uuid;
  v_done int := 0;
begin
  for b in select id from public.businesses order by id loop
    begin
      perform private.refresh_patterns(b);
      v_done := v_done + 1;
    exception when others then
      raise warning 'refresh_patterns failed for business %: %', b, sqlerrm;
    end;
  end loop;
  return v_done;
end $$;
revoke all on function private.refresh_all_patterns() from public;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('refresh-patterns-nightly', '30 7 * * *', 'select private.refresh_all_patterns()');

-- ---------------------------------------------------------------------------
-- Import commit: rows the file left uncategorized take an enabled rule's category
-- (marked 'rule'); categories from the file are 'import'. Otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.commit_import(p_batch_id uuid, p_expected_count integer)
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

  perform private.resolve_kind(b.business_id, b.money_account_id, null);
  if exists (select 1 from public.import_rows r join public.businesses bz on bz.id = b.business_id
             where r.import_batch_id = b.id and r.included and bz.lock_date is not null and r.date <= bz.lock_date) then
    raise exception 'Books are locked for some of these dates' using errcode = 'P0001', hint = 'locked_period';
  end if;

  update public.import_rows set transaction_id = gen_random_uuid() where import_batch_id = b.id and included;
  insert into public.transactions (
    id, business_id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id,
    category_account_id, kind, memo, reference, source, import_batch_id, dedupe_hash, created_by,
    category_source, category_rule_id
  )
  select r.transaction_id, b.business_id, r.date, r.description_raw, r.description_clean, r.vendor_normalized,
         r.amount_cents, b.money_account_id, c.id,
         private.category_kind(c.type, coalesce(c.is_money_account, false), c.subtype),
         r.memo, r.reference, 'import', b.id, r.dedupe_hash, (select auth.uid()),
         case when r.category_account_id is not null then 'import' when rule.id is not null then 'rule' end::public.category_source,
         rule.id
  from public.import_rows r
  left join lateral (
    select cr.id, cr.category_account_id from public.category_rules cr
    join public.accounts ra on ra.id = cr.category_account_id
    where r.category_account_id is null and r.vendor_normalized is not null
      and cr.business_id = b.business_id and cr.vendor_normalized = r.vendor_normalized
      and cr.enabled and cr.deleted_at is null
      and not ra.is_system and ra.archived_at is null and ra.id <> b.money_account_id
  ) rule on true
  left join public.accounts c on c.id = coalesce(r.category_account_id, rule.category_account_id)
  where r.import_batch_id = b.id and r.included
  order by r.row_index;
  perform private.post_lines_for(array(select transaction_id from public.import_rows where import_batch_id = b.id and included));
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  select b.business_id, (select auth.uid()), 'create', 'transactions', t.id, null, to_jsonb(t)
  from public.transactions t where t.import_batch_id = b.id;
  update public.category_rules set last_applied_at = now()
  where id in (select category_rule_id from public.transactions where import_batch_id = b.id and category_rule_id is not null);

  update public.import_batches set status = 'committed', committed_at = now(), committed_count = v_count where id = b.id;
  perform private.audit(b.business_id, 'commit', 'import_batches', b.id, null,
    jsonb_build_object('committed_count', v_count, 'file_name', b.file_name));
  return v_count;
end $$;

revoke all on function public.update_category_rule(uuid, uuid, boolean) from public, anon;
revoke all on function public.delete_category_rule(uuid) from public, anon;
grant execute on function public.update_category_rule(uuid, uuid, boolean), public.delete_category_rule(uuid) to authenticated;

-- Rules, part 2: where the engine runs (import commit, AI candidates, apply to existing,
-- the drawer, the test box) and the Rules page's functions. Rules only ever touch
-- uncategorized rows or rows a rule categorized, never on or before the lock date, and
-- every change they make is logged in rule_applications so it can be undone.

-- ---------------------------------------------------------------------------
-- Category source: rule writes say exactly what they set (rule -> another rule's category
-- must stay 'rule', and undo restores whatever was there). They set this flag first.
-- ---------------------------------------------------------------------------
create or replace function private.set_category_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('quickacct.rule_write', true) = 'on' then
    if new.category_account_id is null then
      new.category_source := null;
      new.category_rule_id := null;
    end if;
    return new;
  end if;
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

-- Rows rules may change: live, after the lock date, uncategorized or categorized by a rule.
create function private.rule_targets(p_business_id uuid, p_from date, p_to date)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(t.id), '{}')
  from public.transactions t
  join public.businesses b on b.id = t.business_id
  where t.business_id = p_business_id and t.deleted_at is null
    and (b.lock_date is null or t.date > b.lock_date)
    and (t.category_account_id is null or t.category_source = 'rule')
    and (p_from is null or t.date >= p_from) and (p_to is null or t.date <= p_to)
$$;

-- A rule's category is usable for a transaction: active, not a system account, and not the
-- transaction's own money account.
create function private.rule_category_ok(p_business_id uuid, p_account_id uuid, p_money_account_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_account_id is not null and p_account_id <> p_money_account_id and exists (
    select 1 from public.accounts a where a.id = p_account_id and a.business_id = p_business_id
      and a.archived_at is null and not a.is_system)
$$;

-- ---------------------------------------------------------------------------
-- Apply to existing: preview, apply (one run), undo
-- ---------------------------------------------------------------------------
create function private.rule_run_changes(p_business_id uuid, p_rule_ids uuid[], p_from date, p_to date)
returns table (transaction_id uuid, date date, description text, amount_cents bigint, money_account_id uuid,
               current_category_id uuid, new_category_id uuid, current_memo text, new_memo text,
               rule_id uuid, category_rule_id uuid)
language sql stable security definer set search_path = '' as $$
  with targets as (select private.rule_targets(p_business_id, p_from, p_to) as ids),
  m as (select * from private.match_rules(p_business_id, 'transactions', private.compiled_rules(p_business_id, p_rule_ids),
                                          null, (select ids from targets))),
  e as (
    select t.*, m.rule_ids, x.category_id, x.category_rule_id as cat_rule, x.memo_set, x.memo_append
    from m
    join public.transactions t on t.id = m.k::uuid
    cross join lateral private.rule_effects(p_business_id, m.rule_ids) x
  ),
  c as (
    select e.*,
      case when private.rule_category_ok(p_business_id, e.category_id, e.money_account_id) then e.category_id
           else e.category_account_id end as next_category,
      private.memo_after(e.memo, e.memo_set, e.memo_append) as next_memo
    from e
  )
  select c.id, c.date, coalesce(c.description_clean, c.description_raw), c.amount_cents, c.money_account_id,
    c.category_account_id, c.next_category, c.memo, c.next_memo,
    coalesce(case when c.next_category is distinct from c.category_account_id then c.cat_rule end, c.rule_ids[1]),
    case when c.next_category is distinct from c.category_account_id then c.cat_rule else c.category_rule_id end
  from c
  where c.next_category is distinct from c.category_account_id or c.next_memo is distinct from c.memo
$$;

create function public.preview_rule_run(p_business_id uuid, p_rule_ids uuid[] default null, p_from date default null, p_to date default null)
returns table (transaction_id uuid, date date, description text, amount_cents bigint, current_category_id uuid,
               new_category_id uuid, current_memo text, new_memo text, rule_id uuid, rule_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner,editor,viewer}');
  return query
  select c.transaction_id, c.date, c.description, c.amount_cents, c.current_category_id, c.new_category_id,
    c.current_memo, c.new_memo, c.rule_id, r.name
  from private.rule_run_changes(p_business_id, p_rule_ids, p_from, p_to) c
  join public.category_rules r on r.id = c.rule_id
  order by c.date desc, c.transaction_id;
end $$;

-- Apply the previewed changes the user kept ticked, all in one database transaction.
-- Refuses if the set changed since the preview (count differs). Returns the run id for undo.
create function public.apply_rule_run(
  p_business_id uuid, p_rule_ids uuid[], p_from date, p_to date, p_transaction_ids uuid[], p_expected_count integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_run uuid := gen_random_uuid();
  v_rows jsonb;
  v_count int;
  v_ids uuid[];
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  -- The preview recomputed now, limited to the rows the user kept ticked.
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id', c.transaction_id, 'rule_id', c.rule_id,
           'previous_category_id', t.category_account_id, 'previous_category_source', t.category_source,
           'previous_rule_id', t.category_rule_id, 'previous_memo', t.memo,
           'new_category_id', c.new_category_id, 'new_memo', c.new_memo, 'new_rule_id', c.category_rule_id)), '[]'),
         count(*), array_agg(c.transaction_id)
  into v_rows, v_count, v_ids
  from private.rule_run_changes(p_business_id, p_rule_ids, p_from, p_to) c
  join public.transactions t on t.id = c.transaction_id
  where c.transaction_id = any (coalesce(p_transaction_ids, '{}'));
  if v_count <> p_expected_count then
    raise exception 'The rows changed since the preview (% now, you confirmed %). Preview again.', v_count, p_expected_count
      using errcode = '40001';
  end if;
  if v_count = 0 then
    return jsonb_build_object('run_id', null, 'changed', 0);
  end if;

  perform set_config('quickacct.rule_write', 'on', true);
  update public.transactions t set
    category_account_id = x.new_category_id,
    kind = private.category_kind(a.type, coalesce(a.is_money_account, false), a.subtype),
    category_source = case when x.new_category_id is null then null
                           when x.new_category_id is distinct from x.previous_category_id then 'rule'
                           else t.category_source end,
    category_rule_id = case when x.new_category_id is null then null else x.new_rule_id end,
    memo = x.new_memo
  from jsonb_to_recordset(v_rows) as x(transaction_id uuid, new_category_id uuid, previous_category_id uuid, new_rule_id uuid, new_memo text)
  left join public.accounts a on a.id = x.new_category_id
  where t.id = x.transaction_id;
  perform set_config('quickacct.rule_write', 'off', true);
  perform private.post_lines_for(v_ids);

  insert into public.rule_applications (business_id, rule_id, transaction_id, run_id, mode, previous_category_id,
    previous_category_source, previous_rule_id, previous_memo, new_category_id, new_memo)
  select p_business_id, x.rule_id, x.transaction_id, v_run, 'bulk', x.previous_category_id, x.previous_category_source,
    x.previous_rule_id, x.previous_memo, x.new_category_id, x.new_memo
  from jsonb_to_recordset(v_rows) as x(transaction_id uuid, rule_id uuid, previous_category_id uuid,
    previous_category_source public.category_source, previous_rule_id uuid, previous_memo text, new_category_id uuid, new_memo text);
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  select p_business_id, (select auth.uid()), 'rule_apply', 'transactions', x.transaction_id,
    jsonb_build_object('category_account_id', x.previous_category_id, 'memo', x.previous_memo),
    jsonb_build_object('category_account_id', x.new_category_id, 'memo', x.new_memo, 'rule_id', x.rule_id, 'run_id', v_run)
  from jsonb_to_recordset(v_rows) as x(transaction_id uuid, rule_id uuid, previous_category_id uuid, previous_memo text,
    new_category_id uuid, new_memo text);
  update public.category_rules r set times_applied = r.times_applied + s.n, last_applied_at = now()
  from (select x.rule_id, count(*)::int as n from jsonb_to_recordset(v_rows) as x(rule_id uuid) group by x.rule_id) s
  where r.id = s.rule_id;
  return jsonb_build_object('run_id', v_run, 'changed', v_count);
end $$;

-- Undo a run: rows still showing what the run set get their previous category, source,
-- rule and memo back. Rows changed since (or now locked) are left alone and counted.
create function public.undo_rule_run(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  v_ids uuid[];
  v_total int;
begin
  select business_id, count(*) into v_business, v_total from public.rule_applications
  where run_id = p_run_id and undone_at is null group by business_id;
  if v_business is null then
    raise exception 'Nothing to undo for this run' using errcode = '22023';
  end if;
  perform private.require_role(v_business, '{owner,editor}');

  select array_agg(a.transaction_id) into v_ids
  from public.rule_applications a
  join public.transactions t on t.id = a.transaction_id
  join public.businesses b on b.id = t.business_id
  where a.run_id = p_run_id and a.undone_at is null and t.deleted_at is null
    and t.category_account_id is not distinct from a.new_category_id and t.memo is not distinct from a.new_memo
    and (b.lock_date is null or t.date > b.lock_date);

  if v_ids is not null then
    perform set_config('quickacct.rule_write', 'on', true);
    update public.transactions t set
      category_account_id = a.previous_category_id,
      kind = private.category_kind(c.type, coalesce(c.is_money_account, false), c.subtype),
      category_source = case when a.previous_category_id is null then null else a.previous_category_source end,
      category_rule_id = case when a.previous_category_id is null then null else a.previous_rule_id end,
      memo = a.previous_memo
    from public.rule_applications a
    left join public.accounts c on c.id = a.previous_category_id
    where a.run_id = p_run_id and a.undone_at is null and a.transaction_id = t.id and t.id = any (v_ids);
    perform set_config('quickacct.rule_write', 'off', true);
    perform private.post_lines_for(v_ids);
    insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
    select v_business, (select auth.uid()), 'rule_undo', 'transactions', a.transaction_id,
      jsonb_build_object('category_account_id', a.new_category_id, 'memo', a.new_memo),
      jsonb_build_object('category_account_id', a.previous_category_id, 'memo', a.previous_memo, 'run_id', p_run_id)
    from public.rule_applications a where a.run_id = p_run_id and a.transaction_id = any (v_ids);
    update public.category_rules r set times_applied = greatest(r.times_applied - s.n, 0)
    from (select rule_id, count(*)::int as n from public.rule_applications
          where run_id = p_run_id and transaction_id = any (v_ids) group by rule_id) s
    where r.id = s.rule_id;
  end if;
  update public.rule_applications set undone_at = now() where run_id = p_run_id and undone_at is null;
  return jsonb_build_object('restored', coalesce(cardinality(v_ids), 0), 'skipped', v_total - coalesce(cardinality(v_ids), 0));
end $$;

-- ---------------------------------------------------------------------------
-- Import commit: rows the file left uncategorized go through the engine (category, memo).
-- Otherwise unchanged from 20261021000001_patterns.
-- ---------------------------------------------------------------------------
create or replace function public.commit_import(p_batch_id uuid, p_expected_count integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches;
  v_count int;
  v_eff jsonb;
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

  -- Rule effects for rows without a category from the file.
  select coalesce(jsonb_agg(jsonb_build_object('row_index', m.k::int, 'rule_ids', m.rule_ids, 'category_id', x.category_id,
           'category_rule_id', x.category_rule_id, 'memo_set', x.memo_set, 'memo_append', x.memo_append)), '[]')
  into v_eff
  from private.match_rules(b.business_id, 'import', private.compiled_rules(b.business_id), b.id) m
  join public.import_rows r on r.import_batch_id = b.id and r.row_index = m.k::int and r.category_account_id is null
  cross join lateral private.rule_effects(b.business_id, m.rule_ids) x;

  update public.import_rows set transaction_id = gen_random_uuid() where import_batch_id = b.id and included;
  insert into public.transactions (
    id, business_id, date, description_raw, description_clean, vendor_normalized, amount_cents, money_account_id,
    category_account_id, kind, memo, reference, source, import_batch_id, dedupe_hash, created_by,
    category_source, category_rule_id
  )
  select r.transaction_id, b.business_id, r.date, r.description_raw, r.description_clean, r.vendor_normalized,
         r.amount_cents, b.money_account_id, c.id,
         private.category_kind(c.type, coalesce(c.is_money_account, false), c.subtype),
         case when e.row_index is not null then private.memo_after(r.memo, e.memo_set, e.memo_append) else r.memo end,
         r.reference, 'import', b.id, r.dedupe_hash, (select auth.uid()),
         case when r.category_account_id is not null then 'import' when e.ok then 'rule' end::public.category_source,
         case when e.ok then e.category_rule_id end
  from public.import_rows r
  left join lateral (
    select x.*, private.rule_category_ok(b.business_id, x.category_id, b.money_account_id) as ok
    from jsonb_to_recordset(v_eff) as x(row_index int, rule_ids uuid[], category_id uuid, category_rule_id uuid, memo_set text, memo_append text)
    where x.row_index = r.row_index
  ) e on true
  left join public.accounts c on c.id = coalesce(r.category_account_id, case when e.ok then e.category_id end)
  where r.import_batch_id = b.id and r.included
  order by r.row_index;
  perform private.post_lines_for(array(select transaction_id from public.import_rows where import_batch_id = b.id and included));
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  select b.business_id, (select auth.uid()), 'create', 'transactions', t.id, null, to_jsonb(t)
  from public.transactions t where t.import_batch_id = b.id;

  -- Log what rules did (category and/or memo) and count it.
  insert into public.rule_applications (business_id, rule_id, transaction_id, mode, new_category_id, new_memo, previous_memo)
  select b.business_id, coalesce(t.category_rule_id, x.rule_ids[1]), t.id, 'auto', t.category_account_id, t.memo, r.memo
  from jsonb_to_recordset(v_eff) as x(row_index int, rule_ids uuid[])
  join public.import_rows r on r.import_batch_id = b.id and r.row_index = x.row_index and r.included
  join public.transactions t on t.id = r.transaction_id
  where t.category_source = 'rule' or t.memo is distinct from r.memo;
  update public.category_rules cr set times_applied = cr.times_applied + s.n, last_applied_at = now()
  from (select a.rule_id, count(*)::int as n from public.rule_applications a
        join public.transactions t on t.id = a.transaction_id
        where t.import_batch_id = b.id and a.mode = 'auto' group by a.rule_id) s
  where cr.id = s.rule_id;

  update public.import_batches set status = 'committed', committed_at = now(), committed_count = v_count where id = b.id;
  perform private.audit(b.business_id, 'commit', 'import_batches', b.id, null,
    jsonb_build_object('committed_count', v_count, 'file_name', b.file_name));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- AI candidates: rules first. Rows an active rule would categorize, or that a skip_ai rule
-- matches, are never sent to Anthropic.
-- ---------------------------------------------------------------------------
create or replace function public.ai_candidates(p_business_id uuid, p_limit integer default 50)
returns table (
  id uuid, date date, description_clean text, vendor_normalized text, amount_cents bigint,
  money_account_kind text, memo text, recurring_cadence text, is_large boolean, vendor_categories text[]
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  b public.businesses;
  v_excluded uuid[];
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  select * into b from public.businesses bz where bz.id = p_business_id;
  select coalesce(array_agg(m.k::uuid), '{}') into v_excluded
  from private.match_rules(p_business_id, 'transactions', private.compiled_rules(p_business_id), null,
         (select coalesce(array_agg(u.id), '{}') from public.transactions u
          where u.business_id = p_business_id and u.deleted_at is null and u.category_account_id is null)) m
  cross join lateral private.rule_effects(p_business_id, m.rule_ids) x
  where x.skip_ai or x.category_id is not null;

  return query
  select t.id, t.date, coalesce(t.description_clean, t.description_raw), t.vendor_normalized, t.amount_cents,
    m.subtype,
    case when b.ai_share_memos then t.memo end,
    (select p.cadence from public.transaction_patterns p where p.business_id = t.business_id and p.kind = 'recurring'
       and p.vendor_normalized = t.vendor_normalized and p.direction = case when t.amount_cents < 0 then 'out' else 'in' end),
    exists (select 1 from public.transaction_patterns p where p.business_id = t.business_id and p.kind = 'large' and p.transaction_id = t.id),
    coalesce((select array_agg(distinct a.name order by a.name) from public.transactions o
       join public.accounts a on a.id = o.category_account_id
       where o.business_id = t.business_id and o.vendor_normalized = t.vendor_normalized and o.deleted_at is null
         and o.category_source = 'user'), '{}')
  from public.transactions t
  join public.accounts m on m.id = t.money_account_id
  where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null
    and (b.lock_date is null or t.date > b.lock_date)
    and not (t.id = any (v_excluded))
    and not exists (select 1 from public.ai_suggestions s where s.transaction_id = t.id and s.status = 'pending')
    and (select count(*) from public.ai_suggestions s where s.transaction_id = t.id and s.status = 'rejected') < 2
  order by t.date desc, t.created_at desc, t.id
  limit least(greatest(p_limit, 1), 50);
end $$;

-- ---------------------------------------------------------------------------
-- Rules page
-- ---------------------------------------------------------------------------
create function private.require_rule(p_rule_id uuid, p_roles public.member_role[] default '{owner,editor}')
returns public.category_rules
language plpgsql stable security definer set search_path = '' as $$
declare r public.category_rules;
begin
  select * into r from public.category_rules where id = p_rule_id and deleted_at is null;
  if r.id is null then
    raise exception 'Rule not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, p_roles);
  return r;
end $$;

-- Validate a rule given as json: {name, match_mode, stop_processing, enabled, conditions:[...], actions:[...]}.
create function private.validate_rule_json(p_business_id uuid, p_rule jsonb)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb;
  a jsonb;
  acct public.accounts;
begin
  if nullif(btrim(p_rule ->> 'name'), '') is null or length(btrim(p_rule ->> 'name')) > 120 then
    raise exception 'Give the rule a name (up to 120 characters)' using errcode = '22023';
  end if;
  if coalesce(p_rule ->> 'match_mode', 'all') not in ('all', 'any') then
    raise exception 'Match all or any conditions' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_rule -> 'conditions', '[]')) = 0 then
    raise exception 'Add at least one condition' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_rule -> 'conditions', '[]')) > 20 then
    raise exception 'A rule can have up to 20 conditions' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(p_rule -> 'conditions') loop
    perform private.validate_rule_condition(c ->> 'field', c ->> 'operator', c -> 'value');
    if c ->> 'field' = 'money_account_id' and exists (
      select 1 from jsonb_array_elements_text(case when jsonb_typeof(c -> 'value') = 'array' then c -> 'value' else jsonb_build_array(c -> 'value') end) x
      where not exists (select 1 from public.accounts where id = x::uuid and business_id = p_business_id and is_money_account)) then
      raise exception 'Pick money accounts from this business' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_rule -> 'actions', '[]')) = 0 then
    raise exception 'Add at least one action' using errcode = '22023';
  end if;
  for a in select * from jsonb_array_elements(p_rule -> 'actions') loop
    if a ->> 'action' in ('set_category', 'mark_transfer_to_account') then
      select * into acct from public.accounts where id = (a ->> 'account_id')::uuid and business_id = p_business_id;
      if acct.id is null or acct.archived_at is not null or acct.is_system then
        raise exception 'Pick an active category from this business' using errcode = '22023';
      end if;
      if a ->> 'action' = 'mark_transfer_to_account' and not acct.is_money_account then
        raise exception 'A transfer goes to one of your money accounts' using errcode = '22023';
      end if;
      if a ->> 'action' = 'set_category' and acct.is_money_account then
        raise exception 'To move money between accounts, use "Mark as transfer"' using errcode = '22023';
      end if;
    elsif a ->> 'action' in ('set_memo', 'append_memo') then
      if nullif(btrim(a -> 'value' ->> 'text'), '') is null or length(a -> 'value' ->> 'text') > 500 then
        raise exception 'Memo text is required (up to 500 characters)' using errcode = '22023';
      end if;
    elsif a ->> 'action' is distinct from 'skip_ai' then
      raise exception 'Unknown action %', a ->> 'action' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_rule -> 'actions') ax where ax ->> 'action' in ('set_category', 'mark_transfer_to_account')) > 1 then
    raise exception 'A rule sets one category' using errcode = '22023';
  end if;
end $$;

-- Create or update a rule (id in the json = update). Returns its id.
create function public.save_rule(p_business_id uuid, p_rule jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p_rule ->> 'id', '')::uuid;
  v_old public.category_rules;
  v_cat uuid;
  v_vendor text;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  perform private.validate_rule_json(p_business_id, p_rule);
  select (a ->> 'account_id')::uuid into v_cat from jsonb_array_elements(p_rule -> 'actions') a
  where a ->> 'action' in ('set_category', 'mark_transfer_to_account') limit 1;
  if v_id is not null then
    select * into v_old from public.category_rules where id = v_id and business_id = p_business_id and deleted_at is null;
    if v_old.id is null then
      raise exception 'Rule not found' using errcode = '42501';
    end if;
    -- The vendor key only survives an edit that keeps exactly "vendor equals <same vendor>".
    v_vendor := case when jsonb_array_length(p_rule -> 'conditions') = 1
                       and p_rule -> 'conditions' -> 0 ->> 'field' = 'vendor_normalized'
                       and p_rule -> 'conditions' -> 0 ->> 'operator' = 'equals'
                       and p_rule -> 'conditions' -> 0 ->> 'value' = v_old.vendor_normalized
                     then v_old.vendor_normalized end;
    update public.category_rules set
      name = btrim(p_rule ->> 'name'),
      match_mode = coalesce(p_rule ->> 'match_mode', 'all'),
      stop_processing = coalesce((p_rule ->> 'stop_processing')::boolean, true),
      enabled = coalesce((p_rule ->> 'enabled')::boolean, enabled),
      vendor_normalized = v_vendor,
      category_account_id = v_cat
    where id = v_id;
    delete from public.rule_conditions where rule_id = v_id;
    delete from public.rule_actions where rule_id = v_id;
  else
    insert into public.category_rules (business_id, name, match_mode, stop_processing, enabled, origin, status,
      category_account_id, priority, created_by)
    values (p_business_id, btrim(p_rule ->> 'name'), coalesce(p_rule ->> 'match_mode', 'all'),
      coalesce((p_rule ->> 'stop_processing')::boolean, true), coalesce((p_rule ->> 'enabled')::boolean, true),
      case when p_rule ->> 'origin' = 'apply_similar' then 'apply_similar' else 'user' end, 'active', v_cat,
      coalesce((p_rule ->> 'priority')::int,
               coalesce((select max(priority) from public.category_rules where business_id = p_business_id), 0) + 10),
      (select auth.uid()))
    returning id into v_id;
  end if;
  insert into public.rule_conditions (business_id, rule_id, position, field, operator, value, case_sensitive)
  select p_business_id, v_id, o::int, c ->> 'field', c ->> 'operator', c -> 'value', coalesce((c ->> 'case_sensitive')::boolean, false)
  from jsonb_array_elements(p_rule -> 'conditions') with ordinality as e(c, o);
  insert into public.rule_actions (business_id, rule_id, position, action, account_id, value)
  select p_business_id, v_id, o::int, a ->> 'action', nullif(a ->> 'account_id', '')::uuid,
    case when a ->> 'action' in ('set_memo', 'append_memo') then jsonb_build_object('text', a -> 'value' ->> 'text') else '{}' end
  from jsonb_array_elements(p_rule -> 'actions') with ordinality as e(a, o);
  perform private.audit(p_business_id, 'save_rule', 'category_rules', v_id, null, p_rule);
  return v_id;
end $$;

-- Live counter for the builder: how many existing transactions the (unsaved) conditions
-- match, and the first few.
create function public.rule_draft_matches(p_business_id uuid, p_rule jsonb, p_limit integer default 10)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb;
  v_rules jsonb;
  v_ids uuid[];
begin
  perform private.require_role(p_business_id, '{owner,editor,viewer}');
  if jsonb_array_length(coalesce(p_rule -> 'conditions', '[]')) = 0 then
    return jsonb_build_object('count', 0, 'sample', '[]'::jsonb);
  end if;
  for c in select * from jsonb_array_elements(p_rule -> 'conditions') loop
    perform private.validate_rule_condition(c ->> 'field', c ->> 'operator', c -> 'value');
  end loop;
  v_rules := jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-000000000000',
    'sql', private.rule_conditions_sql(p_rule -> 'conditions', coalesce(p_rule ->> 'match_mode', 'all')), 'stop', true));
  select coalesce(array_agg(m.k::uuid), '{}') into v_ids from private.match_rules(p_business_id, 'transactions', v_rules) m;
  return jsonb_build_object(
    'count', cardinality(v_ids),
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object('transaction_id', t.id, 'date', t.date,
        'description', coalesce(t.description_clean, t.description_raw), 'amount_cents', t.amount_cents,
        'category_id', t.category_account_id, 'category_source', t.category_source) order by t.date desc, t.id)
      from (select * from public.transactions where id = any (v_ids) order by date desc, id limit greatest(least(p_limit, 50), 0)) t), '[]'));
end $$;

-- Existing active rules that would beat this one (higher priority = lower number) on
-- transactions both match, with a different category.
create function public.rule_conflicts(p_business_id uuid, p_rule jsonb)
returns table (rule_id uuid, name text, priority integer, category_id uuid, overlap integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_priority int;
  v_cat uuid;
  v_ids uuid[];
  v_others jsonb;
begin
  perform private.require_role(p_business_id, '{owner,editor,viewer}');
  if jsonb_array_length(coalesce(p_rule -> 'conditions', '[]')) = 0 then
    return;
  end if;
  v_priority := coalesce((p_rule ->> 'priority')::int,
    (select cr.priority from public.category_rules cr where cr.id = nullif(p_rule ->> 'id', '')::uuid),
    (select coalesce(max(cr.priority), 0) + 10 from public.category_rules cr where cr.business_id = p_business_id));
  select (a ->> 'account_id')::uuid into v_cat from jsonb_array_elements(coalesce(p_rule -> 'actions', '[]')) a
  where a ->> 'action' in ('set_category', 'mark_transfer_to_account') limit 1;
  select coalesce(array_agg(m.k::uuid), '{}') into v_ids
  from private.match_rules(p_business_id, 'transactions', jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-0000-0000-000000000000',
    'sql', private.rule_conditions_sql(p_rule -> 'conditions', coalesce(p_rule ->> 'match_mode', 'all')), 'stop', true))) m;
  if cardinality(v_ids) = 0 then
    return;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'sql', private.rule_conditions_sql(private.rule_conditions_json(r.id), r.match_mode), 'stop', false)
                  order by r.priority), '[]')
  into v_others
  from public.category_rules r
  where r.business_id = p_business_id and r.deleted_at is null and r.status = 'active' and r.enabled
    and r.priority < v_priority and r.id is distinct from nullif(p_rule ->> 'id', '')::uuid
    and r.category_account_id is distinct from v_cat and r.category_account_id is not null;
  return query
  select r.id, r.name, r.priority, r.category_account_id, count(*)::int
  from private.match_rules(p_business_id, 'transactions', v_others, null, v_ids) m
  cross join lateral unnest(m.rule_ids) u(rid)
  join public.category_rules r on r.id = u.rid
  group by r.id, r.name, r.priority, r.category_account_id
  order by r.priority;
end $$;

-- Test box and drawer: which rules match a described transaction, which one wins, why.
create function public.test_rules(p_business_id uuid, p_row jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row jsonb := jsonb_build_array(p_row || jsonb_build_object('k', 'row'));
  v_matched uuid[];
  v_eff record;
  v_winner uuid;
  v_why jsonb;
begin
  perform private.require_role(p_business_id, '{owner,editor,viewer}');
  select m.rule_ids into v_matched from private.match_rules(p_business_id, 'json', private.compiled_rules(p_business_id), null, null, v_row) m;
  if v_matched is null then
    return jsonb_build_object('matched', '[]'::jsonb, 'winner', null);
  end if;
  select * into v_eff from private.rule_effects(p_business_id, v_matched);
  v_winner := coalesce(v_eff.category_rule_id, v_matched[1]);
  -- Each of the winner's conditions, true or false on this row.
  select jsonb_agg(jsonb_build_object('field', c.field, 'operator', c.operator, 'value', c.value,
           'matched', exists (select 1 from private.match_rules(p_business_id, 'json',
              jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-000000000000',
                'sql', private.rule_condition_sql(c.field, c.operator, c.value, c.case_sensitive), 'stop', true)), null, null, v_row)))
         order by c.position)
  into v_why
  from public.rule_conditions c where c.rule_id = v_winner;
  return jsonb_build_object(
    'matched', (select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'priority', r.priority, 'stop_processing', r.stop_processing) order by o)
                from unnest(v_matched) with ordinality as u(id, o) join public.category_rules r on r.id = u.id),
    'winner', (select jsonb_build_object('id', r.id, 'name', r.name, 'match_mode', r.match_mode, 'conditions', coalesce(v_why, '[]'::jsonb))
               from public.category_rules r where r.id = v_winner),
    'category_id', v_eff.category_id,
    'memo_set', v_eff.memo_set,
    'memo_append', v_eff.memo_append,
    'skip_ai', v_eff.skip_ai);
end $$;

-- After saving a transaction whose empty category the drawer filled from a rule: confirm
-- the rule still wins for it and record the category as the rule's.
create function public.mark_transaction_rule(p_transaction_id uuid, p_rule_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  v_eff record;
  v_matched uuid[];
begin
  select * into t from public.transactions where id = p_transaction_id and deleted_at is null;
  if t.id is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(t.business_id, '{owner,editor}');
  select m.rule_ids into v_matched
  from private.match_rules(t.business_id, 'transactions', private.compiled_rules(t.business_id), null, array[t.id]) m;
  if v_matched is null then
    return false;
  end if;
  select * into v_eff from private.rule_effects(t.business_id, v_matched);
  if v_eff.category_rule_id is distinct from p_rule_id or v_eff.category_id is distinct from t.category_account_id then
    return false;
  end if;
  perform set_config('quickacct.rule_write', 'on', true);
  update public.transactions set category_source = 'rule', category_rule_id = p_rule_id where id = t.id;
  perform set_config('quickacct.rule_write', 'off', true);
  insert into public.rule_applications (business_id, rule_id, transaction_id, mode, new_category_id, new_memo, previous_memo)
  values (t.business_id, p_rule_id, t.id, 'manual', t.category_account_id, t.memo, t.memo);
  update public.category_rules set times_applied = times_applied + 1, last_applied_at = now() where id = p_rule_id;
  return true;
end $$;

create function public.reorder_rules(p_business_id uuid, p_rule_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  update public.category_rules r set priority = u.o * 10
  from unnest(p_rule_ids) with ordinality as u(id, o)
  where r.id = u.id and r.business_id = p_business_id and r.deleted_at is null;
  perform private.audit(p_business_id, 'reorder_rules', 'category_rules', null, null, to_jsonb(p_rule_ids));
end $$;

create function public.set_rule_enabled(p_rule_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.category_rules := private.require_rule(p_rule_id);
begin
  update public.category_rules set enabled = p_enabled where id = r.id;
  perform private.audit(r.business_id, 'update_rule', 'category_rules', r.id,
    jsonb_build_object('enabled', r.enabled), jsonb_build_object('enabled', p_enabled));
end $$;

create function public.duplicate_rule(p_rule_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.category_rules := private.require_rule(p_rule_id);
  v_id uuid;
begin
  insert into public.category_rules (business_id, name, match_mode, stop_processing, enabled, origin, status,
    category_account_id, priority, created_by)
  values (r.business_id, left('Copy of ' || r.name, 120), r.match_mode, r.stop_processing, false, 'user', 'active',
    r.category_account_id, r.priority + 1, (select auth.uid()))
  returning id into v_id;
  insert into public.rule_conditions (business_id, rule_id, position, field, operator, value, case_sensitive)
  select business_id, v_id, position, field, operator, value, case_sensitive from public.rule_conditions where rule_id = r.id;
  insert into public.rule_actions (business_id, rule_id, position, action, account_id, value)
  select business_id, v_id, position, action, account_id, value from public.rule_actions where rule_id = r.id;
  perform private.audit(r.business_id, 'duplicate_rule', 'category_rules', v_id, null, jsonb_build_object('from', r.id));
  return v_id;
end $$;

-- Suggested (draft) rules from the pattern engine: approve makes them active.
create function public.approve_rule(p_rule_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.category_rules := private.require_rule(p_rule_id);
begin
  update public.category_rules set status = 'active', enabled = true where id = r.id;
  perform private.audit(r.business_id, 'approve_rule', 'category_rules', r.id, null, null);
end $$;

-- Delete a rule (a tombstone, so the pattern engine won't suggest it again). With
-- p_revert, rows it categorized go back to what they were before it touched them.
create function public.delete_rule(p_rule_id uuid, p_revert boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.category_rules := private.require_rule(p_rule_id);
  v_ids uuid[];
begin
  if p_revert then
    select array_agg(t.id) into v_ids
    from public.transactions t join public.businesses b on b.id = t.business_id
    where t.business_id = r.business_id and t.category_rule_id = r.id and t.category_source = 'rule'
      and t.deleted_at is null and (b.lock_date is null or t.date > b.lock_date);
    if v_ids is not null then
      perform set_config('quickacct.rule_write', 'on', true);
      update public.transactions t set
        category_account_id = p.previous_category_id,
        kind = private.category_kind(c.type, coalesce(c.is_money_account, false), c.subtype),
        category_source = case when p.previous_category_id is null then null else p.previous_category_source end,
        category_rule_id = case when p.previous_category_id is null then null else p.previous_rule_id end
      from (
        select distinct on (t2.id) t2.id, a.previous_category_id, a.previous_category_source, a.previous_rule_id
        from unnest(v_ids) t2(id)
        left join public.rule_applications a on a.transaction_id = t2.id and a.rule_id = r.id and a.undone_at is null
        order by t2.id, a.applied_at desc nulls last
      ) p
      left join public.accounts c on c.id = p.previous_category_id
      where t.id = p.id;
      perform set_config('quickacct.rule_write', 'off', true);
      perform private.post_lines_for(v_ids);
      insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
      select r.business_id, (select auth.uid()), 'rule_revert', 'transactions', x, jsonb_build_object('rule_id', r.id), null
      from unnest(v_ids) x;
    end if;
  end if;
  update public.category_rules set deleted_at = now(), enabled = false where id = r.id;
  perform private.audit(r.business_id, 'delete_rule', 'category_rules', r.id, to_jsonb(r),
    jsonb_build_object('reverted', coalesce(cardinality(v_ids), 0)));
  return coalesce(cardinality(v_ids), 0);
end $$;

-- "Apply to similar" keeps working; it now records where the rule came from.
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
  insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, origin, status, created_by)
  values (p_business_id, v_vendor, p_category_account_id, 'manual', 'apply_similar', 'active', (select auth.uid()))
  on conflict (business_id, vendor_normalized)
  do update set category_account_id = excluded.category_account_id, enabled = true, deleted_at = null, status = 'active'
  returning id into v_id;
  perform private.audit(p_business_id, 'save_rule', 'category_rules', v_id, null,
    jsonb_build_object('vendor_normalized', v_vendor, 'category_account_id', p_category_account_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Transaction list: filter by who categorized (rule, ai, hand, uncategorized).
-- ---------------------------------------------------------------------------
drop function public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean);
drop function public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean);

create function public.search_transactions(
  p_business_id uuid, p_from date default null, p_to date default null, p_types text[] default null,
  p_category_ids uuid[] default null, p_money_account_ids uuid[] default null, p_amount_min bigint default null,
  p_amount_max bigint default null, p_sources public.transaction_source[] default null, p_query text default null,
  p_import_batch_id uuid default null, p_deleted boolean default false, p_categorized_by text[] default null
) returns setof public.transactions
language sql stable set search_path = '' as $$
  select t.*
  from public.transactions t
  where t.business_id = p_business_id
    and (t.deleted_at is not null) = coalesce(p_deleted, false)
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and (p_types is null
         or (t.category_account_id is null and 'uncategorized' = any (p_types))
         or (t.category_account_id is not null and t.kind::text = any (p_types)))
    and (p_category_ids is null or t.category_account_id = any (p_category_ids))
    and (p_money_account_ids is null or t.money_account_id = any (p_money_account_ids))
    and (p_amount_min is null or abs(t.amount_cents) >= p_amount_min)
    and (p_amount_max is null or abs(t.amount_cents) <= p_amount_max)
    and (p_sources is null or t.source = any (p_sources))
    and (p_import_batch_id is null or t.import_batch_id = p_import_batch_id)
    and (p_categorized_by is null
         or (t.category_account_id is null and 'uncategorized' = any (p_categorized_by))
         or (t.category_source = 'rule' and 'rule' = any (p_categorized_by))
         or (t.category_source = 'ai' and 'ai' = any (p_categorized_by))
         or (t.category_source in ('user', 'import') and 'hand' = any (p_categorized_by)))
    and (nullif(btrim(p_query), '') is null or (
      with q as (
        select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
      )
      select t.description_raw ilike q.pattern
          or t.description_clean ilike q.pattern
          or t.vendor_normalized ilike q.pattern
          or t.memo ilike q.pattern
      from q))
$$;

create function public.summarize_transactions(
  p_business_id uuid, p_from date default null, p_to date default null, p_types text[] default null,
  p_category_ids uuid[] default null, p_money_account_ids uuid[] default null, p_amount_min bigint default null,
  p_amount_max bigint default null, p_sources public.transaction_source[] default null, p_query text default null,
  p_import_batch_id uuid default null, p_deleted boolean default false, p_categorized_by text[] default null
) returns table (count bigint, total_in bigint, total_out bigint, net bigint)
language sql stable set search_path = '' as $$
  select count(*),
         coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint,
         coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)::bigint,
         coalesce(sum(amount_cents), 0)::bigint
  from public.search_transactions(p_business_id, p_from, p_to, p_types, p_category_ids, p_money_account_ids,
                                  p_amount_min, p_amount_max, p_sources, p_query, p_import_batch_id, p_deleted, p_categorized_by)
$$;

revoke all on function private.rule_targets(uuid, date, date), private.rule_category_ok(uuid, uuid, uuid),
  private.rule_run_changes(uuid, uuid[], date, date), private.require_rule(uuid, public.member_role[]),
  private.validate_rule_json(uuid, jsonb) from public, anon;
revoke all on function public.preview_rule_run(uuid, uuid[], date, date), public.apply_rule_run(uuid, uuid[], date, date, uuid[], integer),
  public.undo_rule_run(uuid), public.save_rule(uuid, jsonb), public.rule_draft_matches(uuid, jsonb, integer),
  public.rule_conflicts(uuid, jsonb), public.test_rules(uuid, jsonb), public.mark_transaction_rule(uuid, uuid),
  public.reorder_rules(uuid, uuid[]), public.set_rule_enabled(uuid, boolean), public.duplicate_rule(uuid),
  public.approve_rule(uuid), public.delete_rule(uuid, boolean),
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[]),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[])
  from public, anon;
grant execute on function public.preview_rule_run(uuid, uuid[], date, date), public.apply_rule_run(uuid, uuid[], date, date, uuid[], integer),
  public.undo_rule_run(uuid), public.save_rule(uuid, jsonb), public.rule_draft_matches(uuid, jsonb, integer),
  public.rule_conflicts(uuid, jsonb), public.test_rules(uuid, jsonb), public.mark_transaction_rule(uuid, uuid),
  public.reorder_rules(uuid, uuid[]), public.set_rule_enabled(uuid, boolean), public.duplicate_rule(uuid),
  public.approve_rule(uuid), public.delete_rule(uuid, boolean),
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[]),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[])
  to authenticated;

-- New private functions (including trigger functions) start with no PUBLIC execute.
revoke execute on all functions in schema private from public, anon;

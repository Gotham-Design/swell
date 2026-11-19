-- Rules, generalized. category_rules was one vendor -> one category. It becomes a rule with
-- a name, priority, conditions (any field, many operators) and actions (category, transfer,
-- memo, skip AI), plus a log of every row a rule changed so a run can be undone.
-- Nothing is dropped: every existing rule keeps its id and becomes
-- "vendor equals X" -> "set category", so it categorizes exactly what it did before.
--
-- The engine lives here, not in TypeScript: conditions compile to SQL and one matcher
-- evaluates every rule over a set of rows in a single pass, so the import commit (20k rows),
-- the AI exclusion, previews and the test box all use the same implementation.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
alter table public.category_rules
  alter column vendor_normalized drop not null,
  alter column category_account_id drop not null,
  add column name text,
  add column priority integer,
  add column match_mode text not null default 'all' check (match_mode in ('all', 'any')),
  add column stop_processing boolean not null default true,
  add column origin text not null default 'user' check (origin in ('user', 'auto_suggested', 'apply_similar')),
  add column status text not null default 'active' check (status in ('active', 'draft')),
  add column times_applied integer not null default 0 check (times_applied >= 0);

update public.category_rules set
  name = 'Vendor is ' || vendor_normalized,
  origin = case when source = 'auto' then 'auto_suggested' else 'apply_similar' end;
update public.category_rules r set priority = s.n * 10
from (select id, row_number() over (partition by business_id order by created_at, id) as n from public.category_rules) s
where s.id = r.id;

alter table public.category_rules
  alter column name set not null,
  alter column priority set not null,
  alter column priority set default 1000,
  add constraint category_rules_name_check check (length(btrim(name)) between 1 and 120);
create index category_rules_active_idx on public.category_rules (business_id, priority)
  where deleted_at is null and status = 'active' and enabled;

-- ---------------------------------------------------------------------------
-- Conditions and actions
-- ---------------------------------------------------------------------------
create table public.rule_conditions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  rule_id uuid not null,
  position integer not null default 0,
  field text not null check (field in ('description_clean', 'description_raw', 'vendor_normalized', 'amount', 'direction',
                                       'money_account_id', 'date', 'source')),
  operator text not null check (operator in ('contains', 'not_contains', 'equals', 'starts_with', 'ends_with', 'regex',
                                             'gt', 'gte', 'lt', 'lte', 'between', 'in')),
  value jsonb not null,
  case_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, rule_id) references public.category_rules (business_id, id) on delete cascade
);
create index rule_conditions_rule_idx on public.rule_conditions (rule_id, position);
create index rule_conditions_business_idx on public.rule_conditions (business_id, rule_id);

create table public.rule_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  rule_id uuid not null,
  position integer not null default 0,
  action text not null check (action in ('set_category', 'mark_transfer_to_account', 'set_memo', 'append_memo', 'skip_ai')),
  -- The category or money account for set_category / mark_transfer_to_account.
  account_id uuid,
  value jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, rule_id) references public.category_rules (business_id, id) on delete cascade,
  foreign key (business_id, account_id) references public.accounts (business_id, id) on delete cascade,
  check ((action in ('set_category', 'mark_transfer_to_account')) = (account_id is not null)),
  check (action not in ('set_memo', 'append_memo') or jsonb_typeof(value -> 'text') = 'string')
);
create index rule_actions_rule_idx on public.rule_actions (rule_id, position);
create index rule_actions_account_idx on public.rule_actions (business_id, account_id) where account_id is not null;

-- Every change a rule made, for undo.
create table public.rule_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  rule_id uuid not null,
  transaction_id uuid not null,
  -- One "Apply to existing" run (bulk), or null for import (auto) and the drawer (manual).
  run_id uuid,
  mode text not null check (mode in ('auto', 'bulk', 'manual')),
  applied_at timestamptz not null default now(),
  previous_category_id uuid,
  previous_category_source public.category_source,
  previous_rule_id uuid,
  previous_memo text,
  new_category_id uuid,
  new_memo text,
  undone_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, rule_id) references public.category_rules (business_id, id) on delete cascade,
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade
);
create index rule_applications_run_idx on public.rule_applications (run_id) where run_id is not null;
create index rule_applications_rule_idx on public.rule_applications (business_id, rule_id);
create index rule_applications_transaction_idx on public.rule_applications (business_id, transaction_id, applied_at desc);

do $$
declare t text;
begin
  foreach t in array array['rule_conditions', 'rule_actions', 'rule_applications'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (business_id in (select private.my_business_ids()))', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- A vendor rule (legacy shape) gets its condition and action. Used for the backfill and
-- for rules still created the old way (save_category_rule, the pattern engine, direct inserts).
create function private.ensure_rule_structure(p_rule_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.category_rules;
begin
  select * into r from public.category_rules where id = p_rule_id;
  if r.id is null or r.vendor_normalized is null or r.category_account_id is null then
    return;
  end if;
  if not exists (select 1 from public.rule_conditions where rule_id = r.id) then
    insert into public.rule_conditions (business_id, rule_id, position, field, operator, value)
    values (r.business_id, r.id, 0, 'vendor_normalized', 'equals', to_jsonb(r.vendor_normalized));
  end if;
  if not exists (select 1 from public.rule_actions where rule_id = r.id) then
    insert into public.rule_actions (business_id, rule_id, position, action, account_id)
    values (r.business_id, r.id, 0, 'set_category', r.category_account_id);
  end if;
end $$;

select private.ensure_rule_structure(id) from public.category_rules;

-- Rules inserted the old way: name, priority and origin; pattern-engine rules start as
-- drafts (suggestions) and aren't created at all when an active rule already covers the vendor.
create function private.prepare_rule() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'auto' then
    new.origin := 'auto_suggested';
    new.status := 'draft';
    if exists (select 1 from public.rule_conditions c join public.category_rules r on r.id = c.rule_id
               where r.business_id = new.business_id and r.deleted_at is null and r.status = 'active'
                 and c.field = 'vendor_normalized' and c.operator = 'equals' and c.value = to_jsonb(new.vendor_normalized)) then
      return null;
    end if;
  end if;
  if new.name is null then
    new.name := left('Vendor is ' || coalesce(new.vendor_normalized, 'unnamed'), 120);
  end if;
  if new.priority is null or new.priority = 1000 then
    new.priority := coalesce((select max(priority) from public.category_rules where business_id = new.business_id), 0) + 10;
  end if;
  return new;
end $$;
create trigger prepare_rule before insert on public.category_rules
  for each row execute function private.prepare_rule();

create function private.after_rule_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_rule_structure(new.id);
  return null;
end $$;
create trigger after_rule_insert after insert on public.category_rules
  for each row execute function private.after_rule_insert();

-- The old one-category paths (update_category_rule, merge_category, save_category_rule)
-- change category_rules.category_account_id; keep the set_category action in step.
create function private.sync_rule_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_account_id is not null and new.category_account_id is distinct from old.category_account_id then
    update public.rule_actions set account_id = new.category_account_id
    where rule_id = new.id and action = 'set_category' and account_id is not distinct from old.category_account_id;
  end if;
  return null;
end $$;
create trigger sync_rule_category after update of category_account_id on public.category_rules
  for each row execute function private.sync_rule_category();

-- ---------------------------------------------------------------------------
-- Conditions -> SQL. Every rule compiles to a boolean expression over a row `r` with:
-- description_clean, description_raw, vendor_normalized, amount_cents, money_account_id,
-- date, source. Values are quoted with format(%L); nothing from a rule is ever spliced raw.
-- Amounts compare the absolute value in cents; direction (in | out) is its own field.
-- ---------------------------------------------------------------------------
create function private.rule_text_value(p_value jsonb) returns text
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p_value) when 'string' then p_value #>> '{}' else p_value::text end
$$;

create function private.rule_condition_sql(p_field text, p_op text, p_value jsonb, p_case_sensitive boolean)
returns text
language plpgsql stable set search_path = '' as $$
declare
  col text;
  v text;
  lo text;
  hi text;
  arr text;
begin
  if p_field in ('description_clean', 'description_raw', 'vendor_normalized') then
    col := case when p_case_sensitive then format('coalesce(r.%I, %L)', p_field, '') else format('lower(coalesce(r.%I, %L))', p_field, '') end;
    if p_op = 'in' then
      select string_agg(format('%L', case when p_case_sensitive then x else lower(x) end), ', ') into arr
      from jsonb_array_elements_text(p_value) x;
      return format('(%s in (%s))', col, coalesce(arr, 'null'));
    end if;
    v := private.rule_text_value(p_value);
    if not p_case_sensitive and p_op <> 'regex' then v := lower(v); end if;
    return case p_op
      when 'contains' then format('(strpos(%s, %L) > 0)', col, v)
      when 'not_contains' then format('(strpos(%s, %L) = 0)', col, v)
      when 'equals' then format('(%s = %L)', col, v)
      when 'starts_with' then format('starts_with(%s, %L)', col, v)
      when 'ends_with' then format('(right(%s, %s) = %L)', col, length(v), v)
      when 'regex' then format('(coalesce(r.%I, %L) %s %L)', p_field, '', case when p_case_sensitive then '~' else '~*' end, v)
    end;
  elsif p_field = 'amount' then
    col := 'abs(r.amount_cents)';
    if p_op = 'between' then
      lo := (p_value ->> 0)::bigint::text; hi := (p_value ->> 1)::bigint::text;
      return format('(%s between %s and %s)', col, lo, hi);
    elsif p_op = 'in' then
      select string_agg(x::bigint::text, ', ') into arr from jsonb_array_elements_text(p_value) x;
      return format('(%s in (%s))', col, coalesce(arr, 'null'));
    end if;
    v := (p_value #>> '{}')::bigint::text;
    return format('(%s %s %s)', col, case p_op when 'equals' then '=' when 'gt' then '>' when 'gte' then '>='
                                              when 'lt' then '<' when 'lte' then '<=' end, v);
  elsif p_field = 'direction' then
    return case when p_value #>> '{}' = 'in' then '(r.amount_cents > 0)' else '(r.amount_cents < 0)' end;
  elsif p_field = 'money_account_id' then
    if p_op = 'in' then
      select string_agg(format('%L::uuid', x::uuid), ', ') into arr from jsonb_array_elements_text(p_value) x;
      return format('(r.money_account_id in (%s))', coalesce(arr, 'null'));
    end if;
    return format('(r.money_account_id = %L::uuid)', (p_value #>> '{}')::uuid);
  elsif p_field = 'date' then
    if p_op = 'between' then
      return format('(r.date between %L::date and %L::date)', (p_value ->> 0)::date, (p_value ->> 1)::date);
    end if;
    return format('(r.date %s %L::date)', case p_op when 'equals' then '=' when 'gt' then '>' when 'gte' then '>='
                                                 when 'lt' then '<' when 'lte' then '<=' end, (p_value #>> '{}')::date);
  elsif p_field = 'source' then
    if p_op = 'in' then
      select string_agg(format('%L', x), ', ') into arr from jsonb_array_elements_text(p_value) x;
      return format('(r.source in (%s))', coalesce(arr, 'null'));
    end if;
    return format('(r.source = %L)', p_value #>> '{}');
  end if;
  return 'false';
end $$;

-- Which operators each field takes, and what a value must look like. Raises 22023 with a
-- message people can act on. Regexes must compile in Postgres, stay short, and avoid the
-- nested-quantifier and backreference shapes that can backtrack badly.
create function private.validate_rule_condition(p_field text, p_op text, p_value jsonb)
returns void
language plpgsql stable set search_path = '' as $$
declare
  ok boolean;
  pattern text;
begin
  ok := case
    when p_field in ('description_clean', 'description_raw', 'vendor_normalized')
      then p_op in ('contains', 'not_contains', 'equals', 'starts_with', 'ends_with', 'regex', 'in')
    when p_field = 'amount' then p_op in ('equals', 'gt', 'gte', 'lt', 'lte', 'between', 'in')
    when p_field = 'direction' then p_op = 'equals'
    when p_field = 'money_account_id' then p_op in ('equals', 'in')
    when p_field = 'date' then p_op in ('equals', 'gt', 'gte', 'lt', 'lte', 'between')
    when p_field = 'source' then p_op in ('equals', 'in')
    else false end;
  if not coalesce(ok, false) then
    raise exception 'A % condition cannot use "%"', replace(p_field, '_', ' '), p_op using errcode = '22023';
  end if;
  if p_op = 'in' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0) then
    raise exception 'Give at least one value' using errcode = '22023';
  end if;
  if p_op = 'between' and (jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) <> 2) then
    raise exception 'Give a from and a to value' using errcode = '22023';
  end if;
  if p_field in ('description_clean', 'description_raw', 'vendor_normalized') and p_op not in ('in')
     and (jsonb_typeof(p_value) <> 'string' or length(btrim(p_value #>> '{}')) = 0) then
    raise exception 'Enter some text to match' using errcode = '22023';
  end if;
  if p_field = 'amount' then
    begin
      perform (x)::bigint from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else jsonb_build_array(p_value) end) x;
    exception when others then
      raise exception 'Amounts must be whole cents' using errcode = '22023';
    end;
    if p_op = 'between' and (p_value ->> 0)::bigint > (p_value ->> 1)::bigint then
      raise exception 'The first amount must not be larger than the second' using errcode = '22023';
    end if;
  end if;
  if p_field = 'direction' and p_value #>> '{}' not in ('in', 'out') then
    raise exception 'Direction is money in or money out' using errcode = '22023';
  end if;
  if p_field = 'source' and exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else jsonb_build_array(p_value) end) x
                                    where x not in ('manual', 'import', 'api')) then
    raise exception 'Source is manual, import or bank feed' using errcode = '22023';
  end if;
  if p_field in ('money_account_id', 'date') then
    begin
      if p_field = 'money_account_id' then
        perform (x)::uuid from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else jsonb_build_array(p_value) end) x;
      else
        perform (x)::date from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else jsonb_build_array(p_value) end) x;
      end if;
    exception when others then
      raise exception 'That % is not valid', case when p_field = 'date' then 'date' else 'account' end using errcode = '22023';
    end;
  end if;
  if p_op = 'regex' then
    pattern := p_value #>> '{}';
    if length(pattern) > 200 then
      raise exception 'Keep patterns under 200 characters' using errcode = '22023';
    end if;
    if pattern ~ '\\[1-9]' or pattern ~ '\([^)]*[+*}][^)]*\)\s*[+*{]' then
      raise exception 'That pattern could be very slow (nested repeats or backreferences); simplify it' using errcode = '22023';
    end if;
    begin
      perform '' ~ pattern;
    exception when others then
      raise exception 'That pattern is not a valid regular expression: %', sqlerrm using errcode = '22023';
    end;
  end if;
end $$;

-- A rule's conditions as one boolean expression (false when it has none).
create function private.rule_conditions_sql(p_conditions jsonb, p_match_mode text)
returns text
language sql stable set search_path = '' as $$
  select coalesce('(' || string_agg(
      private.rule_condition_sql(c ->> 'field', c ->> 'operator', c -> 'value', coalesce((c ->> 'case_sensitive')::boolean, false)),
      case when p_match_mode = 'any' then ' or ' else ' and ' end
      order by o) || ')', 'false')
  from jsonb_array_elements(coalesce(p_conditions, '[]')) with ordinality as e(c, o)
$$;

create function private.rule_conditions_json(p_rule_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('field', field, 'operator', operator, 'value', value, 'case_sensitive', case_sensitive)
                  order by position, created_at, id), '[]')
  from public.rule_conditions where rule_id = p_rule_id
$$;

-- The business's active rules in priority order, compiled: [{id, sql, stop}].
create function private.compiled_rules(p_business_id uuid, p_rule_ids uuid[] default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id,
      'sql', private.rule_conditions_sql(private.rule_conditions_json(r.id), r.match_mode), 'stop', r.stop_processing)
    order by r.priority, r.created_at, r.id), '[]')
  from public.category_rules r
  where r.business_id = p_business_id and r.deleted_at is null and r.status = 'active' and r.enabled
    and (p_rule_ids is null or r.id = any (p_rule_ids))
$$;

-- ---------------------------------------------------------------------------
-- The matcher: for each row of a source, the rules that match in priority order, up to and
-- including the first that stops processing. Sources (fixed, never caller SQL):
--   'import'        included rows of one import batch (key: row_index)
--   'transactions'  live transactions of the business, optionally only p_ids (key: id)
--   'json'          rows given inline (test box, drawer) (key: k)
-- ---------------------------------------------------------------------------
create function private.match_rules(
  p_business_id uuid, p_source text, p_rules jsonb,
  p_batch_id uuid default null, p_ids uuid[] default null, p_rows jsonb default null
) returns table (k text, rule_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
-- @plpgsql_check_options: extra_warnings = off
declare
  v_cases text;
  v_stops text[];
  v_src text;
begin
  if p_rules is null or jsonb_array_length(p_rules) = 0 then
    return;
  end if;
  select string_agg(format('case when %s then %L end', e ->> 'sql', e ->> 'id'), ', ' order by o),
         array_agg(e ->> 'id') filter (where (e ->> 'stop')::boolean)
  into v_cases, v_stops
  from jsonb_array_elements(p_rules) with ordinality as x(e, o);

  v_src := case p_source
    when 'import' then
      'select r.row_index::text as k, r.description_clean, r.description_raw, r.vendor_normalized, r.amount_cents,
              b.money_account_id, r.date, ''import''::text as source
       from public.import_rows r join public.import_batches b on b.id = r.import_batch_id
       where r.import_batch_id = $2 and r.business_id = $1 and r.included'
    when 'transactions' then
      'select t.id::text as k, t.description_clean, t.description_raw, t.vendor_normalized, t.amount_cents,
              t.money_account_id, t.date, t.source::text as source
       from public.transactions t
       where t.business_id = $1 and t.deleted_at is null and ($3::uuid[] is null or t.id = any ($3))'
    when 'json' then
      'select x.k, x.description_clean, x.description_raw, x.vendor_normalized, x.amount_cents, x.money_account_id, x.date, x.source
       from jsonb_to_recordset($4) as x(k text, description_clean text, description_raw text, vendor_normalized text,
                                        amount_cents bigint, money_account_id uuid, date date, source text)'
  end;
  if v_src is null then
    raise exception 'Unknown rule source %', p_source using errcode = '22023';
  end if;

  return query execute format($q$
    with m as (select r.k, array_remove(array[%s]::text[], null) as ids from (%s) r)
    select m.k, array(
      select u::uuid from unnest(m.ids) with ordinality as e(u, o)
      where o <= coalesce((select min(o2) from unnest(m.ids) with ordinality as e2(u2, o2) where u2 = any ($5)), cardinality(m.ids))
      order by o)
    from m where cardinality(m.ids) > 0
  $q$, v_cases, v_src)
  using p_business_id, p_batch_id, p_ids, p_rows, coalesce(v_stops, '{}');
end $$;

-- What the matched rules do to a row: the category (first categorizing action in priority
-- order), the memo to set (first set_memo) and the text to append (all append_memo, in order),
-- and whether AI is skipped.
create function private.rule_effects(p_business_id uuid, p_rule_ids uuid[])
returns table (category_id uuid, category_rule_id uuid, memo_set text, memo_append text, skip_ai boolean)
language sql stable security definer set search_path = '' as $$
  with acts as (
    select a.*, o as rule_order from unnest(p_rule_ids) with ordinality as u(rid, o)
    join public.rule_actions a on a.rule_id = u.rid and a.business_id = p_business_id
  )
  select
    (select account_id from acts where action in ('set_category', 'mark_transfer_to_account') order by rule_order, position limit 1),
    (select rule_id from acts where action in ('set_category', 'mark_transfer_to_account') order by rule_order, position limit 1),
    (select value ->> 'text' from acts where action = 'set_memo' order by rule_order, position limit 1),
    (select string_agg(value ->> 'text', ' ' order by rule_order, position) from acts where action = 'append_memo'),
    exists (select 1 from acts where action = 'skip_ai')
$$;

-- Appending is idempotent: text already in the memo isn't added again, so re-running
-- rules over the same rows changes nothing.
create function private.memo_after(p_current text, p_set text, p_append text)
returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(concat_ws(' ', coalesce(p_set, p_current),
    case when p_append is not null and strpos(coalesce(p_set, p_current, ''), p_append) = 0 then p_append end)), '')
$$;

revoke all on function private.ensure_rule_structure(uuid), private.rule_text_value(jsonb),
  private.rule_condition_sql(text, text, jsonb, boolean), private.validate_rule_condition(text, text, jsonb),
  private.rule_conditions_sql(jsonb, text), private.rule_conditions_json(uuid), private.compiled_rules(uuid, uuid[]),
  private.match_rules(uuid, text, jsonb, uuid, uuid[], jsonb), private.rule_effects(uuid, uuid[]),
  private.memo_after(text, text, text) from public, anon;

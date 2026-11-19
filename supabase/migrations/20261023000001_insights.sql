-- Insights panel (SPEC Prompt 11): everything the panel shows for a period, computed here
-- from transaction_patterns (and, for spend, the period's transactions). No model call
-- is needed to render it. "Explain this month" summaries are cached per business per period.

-- Recurring patterns also store the regular amount (typical_amount_cents); otherwise
-- unchanged from 20261021000001_patterns.sql.
create or replace function private.refresh_patterns(p_business_id uuid, p_as_of date default current_date)
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

    -- typical_amount_cents: the regular amount before the latest charge (the old price
    -- when a subscription changed), so the panel can tell an increase from a decrease.
    insert into public.transaction_patterns (business_id, kind, vendor_normalized, direction, cadence, amount_match,
      expected_next_date, expected_amount_cents, last_date, last_amount_cents, txn_count, first_seen, status,
      typical_amount_cents)
    values (p_business_id, 'recurring', s.vendor, s.dir, v_cadence, case when v_exact then 'exact' else 'approx' end,
      v_next, case when s.dir = 'out' then -v_expected else v_expected end, s.dates[v_last],
      case when s.dir = 'out' then -s.amts[v_last] else s.amts[v_last] end, cardinality(v_matched),
      s.dates[v_matched[1]], v_status,
      (case when s.dir = 'out' then -1 else 1 end) * (case when v_exact then v_prior_amounts[1] else s.med end));
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

create function public.insights(p_business_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    -- Missed and changed charges first, then by yearly cost.
    'recurring', coalesce((
      select jsonb_agg(jsonb_build_object(
          'vendor', r.vendor_normalized, 'direction', r.direction, 'cadence', r.cadence, 'amount_match', r.amount_match,
          'expected_amount_cents', r.expected_amount_cents, 'expected_next_date', r.expected_next_date,
          'last_amount_cents', r.last_amount_cents, 'last_date', r.last_date, 'status', r.status,
          'regular_amount_cents', r.typical_amount_cents,
          -- More money out (or less in) than the regular amount.
          'price_increase', r.status = 'amount_changed' and r.last_amount_cents < r.typical_amount_cents,
          'annualized_cents', r.annualized)
        order by case r.status when 'missed' then 0 when 'amount_changed' then 1 else 2 end, abs(r.annualized) desc, r.vendor_normalized)
      from (
        select p.*, p.expected_amount_cents * case p.cadence when 'weekly' then 52 when 'monthly' then 12
                                                              when 'quarterly' then 4 else 1 end as annualized
        from public.transaction_patterns p where p.business_id = p_business_id and p.kind = 'recurring'
      ) r), '[]'),
    'large', coalesce((
      select jsonb_agg(jsonb_build_object(
          'transaction_id', t.id, 'date', t.date, 'vendor', p.vendor_normalized,
          'description', coalesce(t.description_clean, t.description_raw), 'amount_cents', p.amount_cents, 'rules', p.large_rules)
        order by p.amount_cents, t.date)
      from public.transaction_patterns p
      join public.transactions t on t.business_id = p.business_id and t.id = p.transaction_id
      where p.business_id = p_business_id and p.kind = 'large' and t.deleted_at is null and t.date between p_from and p_to), '[]'),
    'new_vendors', coalesce((
      select jsonb_agg(jsonb_build_object('vendor', p.vendor_normalized, 'first_seen', p.first_seen, 'txn_count', p.txn_count,
          'typical_amount_cents', p.typical_amount_cents) order by p.first_seen desc, p.vendor_normalized)
      from public.transaction_patterns p
      where p.business_id = p_business_id and p.kind = 'vendor' and p.first_seen between p_from and p_to), '[]'),
    -- Money out in the period, excluding transfers.
    'top_vendors', coalesce((
      select jsonb_agg(jsonb_build_object('vendor', v.vendor, 'spend_cents', v.spend, 'txn_count', v.n) order by v.spend desc, v.vendor)
      from (
        select t.vendor_normalized as vendor, -sum(t.amount_cents)::bigint as spend, count(*)::int as n
        from public.transactions t
        where t.business_id = p_business_id and t.deleted_at is null and t.amount_cents < 0 and t.kind <> 'transfer'
          and t.vendor_normalized is not null and t.date between p_from and p_to
        group by t.vendor_normalized
        order by spend desc, vendor limit 5
      ) v), '[]'),
    'uncategorized', (
      select count(*)::int from public.transactions t
      where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null),
    'uncategorized_in_period', (
      select count(*)::int from public.transactions t
      where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null and t.date between p_from and p_to),
    'patterns_computed_at', (select max(computed_at) from public.transaction_patterns where business_id = p_business_id)
  )
  where exists (select 1 from public.businesses where id = p_business_id)
$$;
revoke all on function public.insights(uuid, date, date) from public, anon;
grant execute on function public.insights(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- "Explain this month": one cached summary per business per period. input_hash is a
-- hash of the aggregates that were sent, so the panel can tell when it's out of date.
-- ---------------------------------------------------------------------------
create table public.ai_explanations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  input_hash text not null,
  summary text not null check (length(summary) between 1 and 4000),
  model text not null,
  prompt_version text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period_from, period_to)
);
create trigger touch_updated_at before update on public.ai_explanations
  for each row execute function private.touch_updated_at();
alter table public.ai_explanations enable row level security;
create policy "members read" on public.ai_explanations for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.ai_explanations from authenticated;
revoke all on public.ai_explanations from anon;

create function public.record_ai_explanation(
  p_business_id uuid, p_from date, p_to date, p_input_hash text, p_summary text, p_model text, p_prompt_version text,
  p_input_tokens integer, p_output_tokens integer, p_latency_ms integer
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  insert into public.ai_usage (business_id, month, input_tokens, output_tokens, calls)
  values (p_business_id, date_trunc('month', now() at time zone 'utc')::date,
          greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0), 1)
  on conflict (business_id, month) do update set
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    calls = public.ai_usage.calls + 1;
  if nullif(btrim(p_summary), '') is null then
    return; -- the call failed or was declined: usage only
  end if;
  insert into public.ai_explanations (business_id, period_from, period_to, input_hash, summary, model, prompt_version,
    input_tokens, output_tokens, latency_ms, created_by)
  values (p_business_id, p_from, p_to, p_input_hash, left(btrim(p_summary), 4000), p_model, p_prompt_version,
    p_input_tokens, p_output_tokens, p_latency_ms, (select auth.uid()))
  on conflict (business_id, period_from, period_to) do update set
    input_hash = excluded.input_hash, summary = excluded.summary, model = excluded.model,
    prompt_version = excluded.prompt_version, input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens, latency_ms = excluded.latency_ms, created_by = excluded.created_by;
end $$;
revoke all on function public.record_ai_explanation(uuid, date, date, text, text, text, text, integer, integer, integer) from public, anon;
grant execute on function public.record_ai_explanation(uuid, date, date, text, text, text, text, integer, integer, integer) to authenticated;

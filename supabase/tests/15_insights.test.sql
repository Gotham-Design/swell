-- Insights: every figure the panel shows comes straight from transaction_patterns (or the
-- period's transactions for spend), price increases are told apart, and "Explain this
-- month" summaries are cached per business per period.
begin;
\ir _setup.psql
select no_plan();

create function tests.pv(p_date date, p_amount bigint, p_vendor text, cat text default null)
returns uuid language sql as $$
  select public.post_transaction(tests.id('A'), p_date, tests.id('a_card'), p_amount, upper(p_vendor) || ' CHARGE',
    tests.id(cat), initcap(p_vendor), p_vendor)
$$;
create function tests.ins(p_from date, p_to date) returns jsonb language sql stable as $$
  select public.insights(tests.id('A'), p_from, p_to)
$$;
grant execute on all functions in schema tests to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.refresh_patterns(uuid, date) to authenticated;

select tests.login('ed');
-- Monthly $45 subscription Apr–Sep, then $52 in October (a price increase).
select tests.pv(make_date(2026, m, 15), -4500, 'figma', 'a_soft') from generate_series(4, 9) m;
select tests.put('fig_oct', tests.pv('2026-10-15', -5200, 'figma', 'a_soft')::text);
-- Weekly $2,000 payroll from Jul 3 to Sep 25, nothing since (missed by mid-October).
select tests.pv(('2026-07-03'::date + 7 * w), -200000, 'gusto') from generate_series(0, 12) w;
-- A big one-off in October and a few small first-time vendors in October.
select tests.put('big', tests.pv('2026-10-05', -1500000, 'dell', 'a_equip')::text);
select tests.pv('2026-10-06', -2500, 'zoom');
select tests.pv('2026-10-07', -1200, 'zoom');
select tests.pv('2026-10-08', -900, 'notion', 'a_soft');
select private.refresh_patterns(tests.id('A'), '2026-10-20');

-- ---------------------------------------------------------------------------
-- Recurring = the recurring patterns, with yearly cost and status
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select r ->> 'vendor', r ->> 'cadence', (r ->> 'expected_amount_cents')::bigint, (r ->> 'expected_next_date')::date, r ->> 'status'
     from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'recurring') r order by 1 $$,
  $$ select vendor_normalized, cadence, expected_amount_cents, expected_next_date, status
     from public.transaction_patterns where business_id = tests.id('A') and kind = 'recurring' order by 1 $$,
  'recurring rows match the pattern table');
select results_eq(
  $$ select r ->> 'vendor', (r ->> 'annualized_cents')::bigint from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'recurring') r order by 1 $$,
  $$ values ('figma', -62400::bigint), ('gusto', -10400000::bigint) $$,
  'annualized: monthly x12 at the current price, weekly x52');
select is((select r ->> 'status' from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'recurring') r where r ->> 'vendor' = 'gusto'),
  'missed', 'payroll is missed');
select is((select (r ->> 'price_increase', r ->> 'regular_amount_cents', r ->> 'last_amount_cents')::text
           from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'recurring') r where r ->> 'vendor' = 'figma'),
  '(true,-4500,-5200)', 'the subscription went from $45 to $52: a price increase');
select is((select r ->> 'vendor' from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'recurring') r limit 1),
  'gusto', 'missed charges are listed first');

-- ---------------------------------------------------------------------------
-- Large = large patterns dated in the period
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select (l ->> 'transaction_id')::uuid, (l ->> 'amount_cents')::bigint, array(select jsonb_array_elements_text(l -> 'rules'))
     from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'large') l $$,
  $$ select p.transaction_id, p.amount_cents, p.large_rules from public.transaction_patterns p
     join public.transactions t on t.id = p.transaction_id
     where p.business_id = tests.id('A') and p.kind = 'large' and t.date between '2026-10-01' and '2026-10-31' $$,
  'large rows match the pattern table for the period');
select is(jsonb_array_length(tests.ins('2026-10-01', '2026-10-31') -> 'large'), 1, '...one: the equipment buy');
select is(jsonb_array_length(tests.ins('2026-09-01', '2026-09-30') -> 'large'), 0, 'nothing large in September');

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select v ->> 'vendor', (v ->> 'txn_count')::int from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'new_vendors') v order by 1 $$,
  $$ select vendor_normalized, txn_count from public.transaction_patterns
     where business_id = tests.id('A') and kind = 'vendor' and first_seen between '2026-10-01' and '2026-10-31' order by 1 $$,
  'new vendors match the vendor patterns first seen in the period');
select results_eq(
  $$ select v ->> 'vendor', (v ->> 'spend_cents')::bigint from jsonb_array_elements(tests.ins('2026-10-01', '2026-10-31') -> 'top_vendors') v $$,
  $$ values ('dell', 1500000::bigint), ('figma', 5200::bigint), ('zoom', 3700::bigint), ('notion', 900::bigint) $$,
  'top vendors by money out in the period');

-- ---------------------------------------------------------------------------
-- Uncategorized
-- ---------------------------------------------------------------------------
select is((tests.ins('2026-10-01', '2026-10-31') ->> 'uncategorized')::int,
  (select count(*)::int from public.transactions where business_id = tests.id('A') and deleted_at is null and category_account_id is null),
  'uncategorized count (all dates)');
select is((tests.ins('2026-10-01', '2026-10-31') ->> 'uncategorized_in_period')::int, 2, 'uncategorized in October: the two Zoom charges');

-- ---------------------------------------------------------------------------
-- Explanation cache
-- ---------------------------------------------------------------------------
select public.record_ai_explanation(tests.id('A'), '2026-10-01', '2026-10-31', 'hash-1', 'October was quiet.', 'claude-haiku-5-5', 'v1', 900, 120, 800);
select public.record_ai_explanation(tests.id('A'), '2026-10-01', '2026-10-31', 'hash-2', 'October had a big equipment buy.', 'claude-haiku-5-5', 'v1', 950, 130, 700);
select results_eq($$ select input_hash, summary from public.ai_explanations where business_id = tests.id('A') $$,
  $$ values ('hash-2', 'October had a big equipment buy.') $$, 'one cached summary per business per period (latest wins)');
select public.record_ai_explanation(tests.id('A'), '2026-10-01', '2026-10-31', 'hash-3', '', 'claude-haiku-5-5', 'v1', 500, 0, 300);
select is((select input_hash from public.ai_explanations where business_id = tests.id('A')), 'hash-2', 'an empty answer keeps the cached one');
select is((select input_tokens + output_tokens from public.ai_usage where business_id = tests.id('A'))::int, 2600, 'every call counts toward usage');

select tests.login('vic');
select ok(tests.ins('2026-10-01', '2026-10-31') -> 'recurring' <> '[]', 'viewers see insights');
select is((select count(*)::int from public.ai_explanations where business_id = tests.id('A')), 1, 'viewers read the cached summary');
select throws_ok($$ select public.record_ai_explanation(tests.id('A'), '2026-10-01', '2026-10-31', 'h', 's', 'm', 'v', 1, 1, 1) $$,
  '42501', null, 'viewers cannot spend tokens');
select tests.login('bob');
select is(tests.ins('2026-10-01', '2026-10-31'), null, 'outsiders get nothing');
select is((select count(*)::int from public.ai_explanations where business_id = tests.id('A')), 0, 'outsiders see no summaries');

select * from finish();
rollback;

-- Jev support: vendor history (user choices only, with counts) and runner-up categories
-- on recorded suggestions (kept only when usable and different from the pick).
begin;
\ir _setup.psql
select no_plan();

create function tests.pv(p_date date, p_amount bigint, p_vendor text, cat text default null)
returns uuid language sql as $$
  select public.post_transaction(tests.id('A'), p_date, tests.id('a_card'), p_amount, upper(p_vendor), tests.id(cat),
    initcap(p_vendor), p_vendor, null)
$$;
create function tests.rec(p_key text, p_suggestions jsonb) returns jsonb language sql as $$
  select public.record_ai_suggestions(tests.id('A'), p_key, 'jev-1.14.0', 'test-v1', 300, 4000, 0, p_suggestions)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('alice');
update public.businesses set ai_enabled = true where id = tests.id('A');
select tests.put('meals', tests.std('A', 'Meals')::text);

select tests.login('ed');
select tests.pv('2026-07-01', -4500, 'figma', 'a_soft');
select tests.pv('2026-08-01', -4500, 'figma', 'a_soft');
select tests.pv('2026-09-01', -4500, 'figma', 'meals');
select tests.put('t1', tests.pv('2026-10-01', -4500, 'figma')::text);
select tests.put('t2', tests.pv('2026-10-02', -900, 'chipotle')::text);

-- ---------------------------------------------------------------------------
-- Vendor history
-- ---------------------------------------------------------------------------
select set_eq(
  $$ select category_account_id, n, vendor_total from public.ai_vendor_history(tests.id('A'), array['figma', 'chipotle']) $$,
  $$ values (tests.id('a_soft'), 2, 3), (tests.id('meals'), 1, 3) $$,
  'history counts user choices per vendor and category, with the vendor total');

reset role;
select set_config('quickacct.rule_write', 'on', true);
update public.transactions set category_source = 'ai' where id = (
  select id from public.transactions where vendor_normalized = 'figma' and category_account_id = tests.id('meals'));
select set_config('quickacct.rule_write', 'off', true);
select tests.login('ed');
select is((select sum(n)::int from public.ai_vendor_history(tests.id('A'), array['figma'])), 2,
  'choices the AI made are not history');

select tests.login('vic');
select throws_ok($$ select * from public.ai_vendor_history(tests.id('A'), array['figma']) $$, '42501', null,
  'viewers cannot read vendor history');
select tests.login('bob');
select throws_ok($$ select * from public.ai_vendor_history(tests.id('A'), array['figma']) $$, '42501', null,
  'outsiders cannot read vendor history');

-- ---------------------------------------------------------------------------
-- Runner-up
-- ---------------------------------------------------------------------------
select tests.login('ed');
select tests.rec('runner-up-1', jsonb_build_array(
  jsonb_build_object('transaction_id', tests.id('t1'), 'category_id', tests.id('a_soft'), 'confidence', 0.91,
    'reason', '', 'flags', '[]'::jsonb, 'runner_up_category_id', tests.id('meals'), 'runner_up_confidence', 0.06),
  jsonb_build_object('transaction_id', tests.id('t2'), 'category_id', tests.id('meals'), 'confidence', 0.93,
    'reason', '', 'flags', '[]'::jsonb, 'runner_up_category_id', tests.id('meals'), 'runner_up_confidence', 0.05)));

select is((select runner_up_category_account_id from public.ai_suggestions where transaction_id = tests.id('t1')),
  tests.id('meals'), 'the runner-up is stored');
select is((select runner_up_confidence from public.ai_suggestions where transaction_id = tests.id('t1')), 0.060::numeric,
  '...with its probability');
select is((select runner_up_category_account_id from public.ai_suggestions where transaction_id = tests.id('t2')), null,
  'a runner-up equal to the pick is dropped');
select is((select runner_up_confidence from public.ai_suggestions where transaction_id = tests.id('t2')), null,
  '...and so is its probability');
select is((select reason from public.ai_suggestions where transaction_id = tests.id('t1')), null,
  'an empty reason is stored as null');

select * from finish();
rollback;

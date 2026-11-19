-- Filters, summary, bulk categorize and rules for the transaction list.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('meals', tests.std('A', 'Meals')::text), tests.put('cc_hdr', tests.std('A', 'Credit Card')::text);
select tests.put('t1', tests.post('A', '2026-01-10', 'a_chk', 250000, 'Invoice 1001 paid', 'a_sales')::text);
select tests.put('t2', tests.post('A', '2026-02-03', 'a_chk', -4599, 'STARBUCKS #123', 'meals')::text);
select tests.put('t3', tests.post('A', '2026-02-15', 'a_card', -1250, 'SQ *BLUE BOTTLE')::text);
select tests.put('t4', tests.post('A', '2026-03-01', 'a_chk', -50000, 'Card payment', 'a_card')::text);
select tests.put('t5', tests.post('A', '2026-03-20', 'a_chk', -20000, 'Owner draw 50%', 'a_draws')::text);
select tests.put('t6', tests.post('A', '2026-03-21', 'a_chk', -999, 'Deleted one', 'meals')::text);
select public.soft_delete_transaction(tests.id('t6'));
reset role;
update public.transactions set vendor_normalized = 'starbucks', memo = 'team coffee' where id = tests.id('t2');
create function tests.ids(p_from date default null, p_to date default null, p_types text[] default null,
  p_cats uuid[] default null, p_accts uuid[] default null, p_min bigint default null, p_max bigint default null,
  p_sources public.transaction_source[] default null, p_q text default null)
returns uuid[] language sql as $$
  select coalesce(array_agg(id order by date), '{}') from public.search_transactions(tests.id('A'), p_from, p_to, p_types,
    p_cats, p_accts, p_min, p_max, p_sources, p_q)
$$;
grant execute on function tests.ids to authenticated;
select tests.login('ed');


select is(tests.ids(), array[tests.id('t1'), tests.id('t2'), tests.id('t3'), tests.id('t4'), tests.id('t5')], 'no filters: every live transaction');
select is(tests.ids(p_from => '2026-02-01', p_to => '2026-02-28'), array[tests.id('t2'), tests.id('t3')], 'date range');
select is(tests.ids(p_types => '{income}'), array[tests.id('t1')], 'type: income');
select is(tests.ids(p_types => '{expense}'), array[tests.id('t2')], 'type: expense');
select is(tests.ids(p_types => '{transfer}'), array[tests.id('t4')], 'type: transfer');
select is(tests.ids(p_types => '{equity}'), array[tests.id('t5')], 'type: equity');
select is(tests.ids(p_types => '{uncategorized}'), array[tests.id('t3')], 'type: uncategorized');
select is(tests.ids(p_types => '{income,uncategorized}'), array[tests.id('t1'), tests.id('t3')], 'types combine with OR');
select is(tests.ids(p_cats => array[tests.id('meals'), tests.id('a_sales')]), array[tests.id('t1'), tests.id('t2')], 'categories');
select is(tests.ids(p_accts => array[tests.id('a_card')]), array[tests.id('t3')], 'money account');
select is(tests.ids(p_min => 10000), array[tests.id('t1'), tests.id('t4'), tests.id('t5')], 'amount min compares size, in or out');
select is(tests.ids(p_min => 1000, p_max => 5000), array[tests.id('t2'), tests.id('t3')], 'amount range');
select is(tests.ids(p_sources => '{import}'), '{}'::uuid[], 'source');
select is(tests.ids(p_q => 'starbucks'), array[tests.id('t2')], 'search: description');
select is(tests.ids(p_q => 'TEAM'), array[tests.id('t2')], 'search: memo, any case');
select is(tests.ids(p_q => '50%'), array[tests.id('t5')], 'search: % is literal');
select is(tests.ids(p_q => '_'), '{}'::uuid[], 'search: _ is literal');

select results_eq($$ select count, total_in, total_out, net from public.summarize_transactions(tests.id('A')) $$,
  $$ values (5::bigint, 250000::bigint, -75849::bigint, 174151::bigint) $$, 'summary: count, in, out, net');
select results_eq($$ select count, total_in, total_out, net from public.summarize_transactions(tests.id('A'), p_types => '{expense,uncategorized}') $$,
  $$ values (2::bigint, 0::bigint, -5849::bigint, -5849::bigint) $$, 'summary follows the filters');

select tests.login('bob');
select is((select count(*)::int from public.search_transactions(tests.id('A'))), 0, 'outsiders get nothing');

-- Bulk categorize
select tests.login('ed');
select tests.put('u' || g, tests.post('A', '2026-04-01', 'a_chk', -100 * g, 'Bulk ' || g)::text) from generate_series(1, 200) g;
select is(public.categorize_transactions(array(select id from public.search_transactions(tests.id('A'), p_types => '{uncategorized}')), tests.id('meals')),
  201, 'bulk categorize changes every matching row');
select is((select count(*)::int from public.search_transactions(tests.id('A'), p_types => '{uncategorized}')), 0, 'nothing is left uncategorized');
select is(tests.balance('a_uncat'), 0::bigint, 'Uncategorized empties');
select is(tests.balance('meals'), (4599 + 1250 + 2010000)::bigint, 'and Meals picks up every amount');
select is((select count(*)::int from (select transaction_id from public.journal_lines where business_id = tests.id('A')
           group by 1 having sum(amount_cents) <> 0 or count(*) <> 2) x), 0, 'every transaction still balances');
select is(public.categorize_transactions(array[tests.id('t2')], tests.id('meals')), 0, 'rows already on that category are skipped');
select lives_ok($$ select public.categorize_transactions(array[tests.id('t3')], null) $$, 'categorize to none un-categorizes');
select is((select category_account_id from public.transactions where id = tests.id('t3')), null, '...');

select tests.login('alice');
update public.businesses set lock_date = '2026-01-31' where id = tests.id('A');
select tests.login('ed');
select throws_like($$ select public.categorize_transactions(array[tests.id('t1'), tests.id('t2')], tests.id('meals')) $$,
  '%locked%', 'a locked row aborts the whole batch');
select is((select category_account_id from public.transactions where id = tests.id('t2')), tests.id('meals'), 'nothing changed');
select tests.login('vic');
select throws_ok($$ select public.categorize_transactions(array[tests.id('t3')], tests.id('meals')) $$, '42501', null, 'viewers cannot categorize');

-- Rules
select tests.login('ed');
select lives_ok($$ select public.save_category_rule(tests.id('A'), 'starbucks', tests.id('meals')) $$, 'save a rule');
select lives_ok($$ select public.save_category_rule(tests.id('A'), 'starbucks', tests.id('a_soft')) $$, 'saving again updates it');
select results_eq($$ select category_account_id, source::text from public.category_rules where vendor_normalized = 'starbucks' $$,
  $$ values (tests.id('a_soft'), 'manual') $$, 'one rule per vendor');
select throws_ok($$ select public.save_category_rule(tests.id('A'), 'x', tests.id('a_uncat')) $$, '22023', null, 'rules cannot target system accounts');
select tests.login('vic');
select throws_ok($$ select public.save_category_rule(tests.id('A'), 'y', tests.id('meals')) $$, '42501', null, 'viewers cannot save rules');

select * from finish();
rollback;

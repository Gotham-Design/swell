-- Transactions screen: a search that reads as money also matches the amount; the summary
-- counts money in and out rows and uncategorized ones; the suggestion queue carries the
-- runner-up and whether the vendor has filing history.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('t1', tests.post('A', '2026-10-01', 'a_card', -3040, 'Amazon printer paper')::text);
select tests.put('t2', tests.post('A', '2026-10-02', 'a_card', -3040, 'Office depot', 'a_soft')::text);
select tests.put('t3', tests.post('A', '2026-10-03', 'a_chk', 125000, 'Invoice 30.40 paid', 'a_sales')::text);

select set_eq($$ select id from public.search_transactions(tests.id('A'), p_query => '30.40', p_query_cents => 3040) $$,
  $$ values (tests.id('t1')), (tests.id('t2')), (tests.id('t3')) $$, 'amount matches and text matches both count');
select set_eq($$ select id from public.search_transactions(tests.id('A'), p_query => 'amazon') $$,
  $$ values (tests.id('t1')) $$, 'plain text search is unchanged');
select results_eq(
  $$ select count, count_in, count_out, uncategorized, total_in, total_out from public.summarize_transactions(tests.id('A')) $$,
  $$ values (3::bigint, 1::bigint, 2::bigint, 1::bigint, 125000::bigint, -6080::bigint) $$, 'in/out and uncategorized counts');

select tests.login('alice');
update public.businesses set ai_enabled = true where id = tests.id('A');
select tests.login('ed');
select public.record_ai_suggestions(tests.id('A'), 'queue-test-1', 'jev-1.14.0', 'v', 1, 1, 0, jsonb_build_array(
  jsonb_build_object('transaction_id', tests.id('t1'), 'category_id', tests.id('a_soft'), 'confidence', 0.62,
    'reason', '', 'flags', '[]'::jsonb, 'runner_up_category_id', tests.std('A', 'Office Supplies'), 'runner_up_confidence', 0.3)));
select is((select runner_up_name from public.ai_suggestion_queue where transaction_id = tests.id('t1')), 'Office Supplies',
  'the queue names the runner-up');
select is((select vendor_has_history from public.ai_suggestion_queue where transaction_id = tests.id('t1')), false,
  'no filing history for this vendor yet');

select * from finish();
rollback;

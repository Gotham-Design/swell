-- Deleted view, bulk delete/restore, audit history, and lock-date refusal for each path.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('meals', tests.std('A', 'Meals')::text);
select tests.put('t1', tests.post('A', '2026-03-10', 'a_chk', -1000, 'Locked lunch', 'meals')::text);
select tests.put('t2', tests.post('A', '2026-05-01', 'a_chk', -2000, 'May lunch', 'meals')::text);
select tests.put('t3', tests.post('A', '2026-05-02', 'a_chk', -3000, 'May dinner', 'meals')::text);

-- Deleted view
select public.soft_delete_transaction(tests.id('t3'));
select results_eq($$ select id from public.search_transactions(tests.id('A'), p_deleted => true) $$,
  $$ values (tests.id('t3')) $$, 'p_deleted shows only deleted rows');
select is((select count(*)::int from public.search_transactions(tests.id('A'))), 2, 'the default view hides them');
select results_eq($$ select count, total_out from public.summarize_transactions(tests.id('A'), p_deleted => true) $$,
  $$ values (1::bigint, -3000::bigint) $$, 'the summary follows the deleted view');

-- Bulk delete and restore
select is(public.soft_delete_transactions(array[tests.id('t1'), tests.id('t2'), tests.id('t3')]), 2,
  'bulk delete counts only rows it changed');
select is((select count(*)::int from public.search_transactions(tests.id('A'))), 0, 'all gone from the live view');
select is(tests.balance('meals'), 0::bigint, 'and from balances');
select is(public.restore_transactions(array[tests.id('t1'), tests.id('t2')]), 2, 'bulk restore');
select is(tests.balance('meals'), 3000::bigint, 'restored rows count again');

-- Lock date: bulk delete/restore refuse locked rows, all or nothing
select tests.login('alice');
update public.businesses set lock_date = '2026-03-31' where id = tests.id('A');
select tests.login('ed');
select throws_like($$ select public.soft_delete_transactions(array[tests.id('t2'), tests.id('t1')]) $$, '%locked%',
  'bulk delete with a locked row is refused');
select is((select deleted_at from public.transactions where id = tests.id('t2')), null, '...and changes nothing');
select throws_like($$ select public.update_transaction(tests.id('t1'), '2026-03-10', tests.id('a_chk'), -1000, 'Edited', tests.id('meals'), null, null, null, null, null) $$,
  '%locked%', 'editing a locked row is refused at the database');

select tests.login('vic');
select throws_ok($$ select public.soft_delete_transactions(array[tests.id('t2')]) $$, '42501', null, 'viewers cannot bulk delete');
select throws_ok($$ select public.restore_transactions(array[tests.id('t3')]) $$, '42501', null, 'viewers cannot bulk restore');

-- History
select ok((select count(*) from public.transaction_history(tests.id('t2'))) >= 3, 'viewers can read a transaction''s history');
select results_eq($$ select action from public.transaction_history(tests.id('t2')) limit 3 $$,
  $$ values ('restore'), ('delete'), ('create') $$, 'newest first');
select ok((select bool_and(actor_email = 'ed@example.com') from public.transaction_history(tests.id('t2'))), 'each entry names who did it');
select tests.login('bob');
select throws_ok($$ select * from public.transaction_history(tests.id('t2')) $$, '42501', null, 'outsiders cannot read history');

select * from finish();
rollback;

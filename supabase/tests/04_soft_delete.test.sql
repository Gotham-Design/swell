-- Soft-deleted transactions keep their rows and lines but drop out of balances; restore
-- brings them back; both are audited.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('t_sale', tests.post('A', '2026-05-01', 'a_chk', 100000, 'Sale', 'a_sales')::text);
select tests.put('t_soft', tests.post('A', '2026-05-02', 'a_chk', -30000, 'Software', 'a_soft')::text);

select is(tests.balance('a_chk'), 70000::bigint, 'checking balance before delete');
select is(tests.balance('a_soft'), 30000::bigint, 'expense balance before delete');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('a_sales')), 100000::bigint,
  'income shows as a positive natural balance');

select public.soft_delete_transaction(tests.id('t_soft'));

select is(tests.balance('a_chk'), 100000::bigint, 'deleted transaction no longer counts toward checking');
select is(tests.balance('a_soft'), 0::bigint, 'deleted transaction no longer counts toward its category');
select is((select sum(balance_cents)::bigint from public.account_balances where business_id = tests.id('A')), 0::bigint,
  'balances still sum to zero after a delete');
select ok((select deleted_at is not null and deleted_by = tests.id('ed') from public.transactions where id = tests.id('t_soft')),
  'the row stays, marked deleted by the editor');
select is((select count(*)::int from public.journal_lines where transaction_id = tests.id('t_soft')), 2,
  'its journal lines stay too (nothing is reversed)');
select ok(
  (select before ->> 'deleted_at' is null and after ->> 'deleted_at' is not null and actor = tests.id('ed')
   from public.audit_log where entity_id = tests.id('t_soft') and action = 'delete'),
  'the delete is audited with who did it');

select lives_ok($$ select public.soft_delete_transaction(tests.id('t_soft')) $$, 'deleting twice is harmless');
select is((select count(*)::int from public.audit_log where entity_id = tests.id('t_soft') and action = 'delete'), 1,
  '...and is not audited twice');
select throws_ok($$ select tests.edit('t_soft', p_memo => 'edit while deleted') $$,
  '22023', null, 'a deleted transaction must be restored before editing');

select public.restore_transaction(tests.id('t_soft'));

select is(tests.balance('a_chk'), 70000::bigint, 'restore puts it back in the balance');
select is(tests.balance('a_soft'), 30000::bigint, 'restore puts it back in its category');
select ok((select deleted_at is null and deleted_by is null from public.transactions where id = tests.id('t_soft')),
  'restore clears the deleted marker');
select is((select count(*)::int from public.audit_log where entity_id = tests.id('t_soft') and action = 'restore'), 1,
  'the restore is audited');

select * from finish();
rollback;

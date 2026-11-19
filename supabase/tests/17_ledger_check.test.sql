-- Nightly ledger check: clean books produce no alerts; a corrupted line (bypassing the
-- triggers, as only a superuser could) is caught per transaction and in the trial
-- balance, shown to members only, and resolved once fixed.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('t1', tests.post('A', '2026-05-01', 'a_chk', 5000, 'Sale', 'a_sales')::text);
select tests.put('t2', tests.post('A', '2026-05-02', 'a_card', -1200, 'Software', 'a_soft')::text);
select tests.login('bob');
select tests.post('B', '2026-05-01', 'b_chk', 900, 'Bravo sale', 'b_sales');
reset role;

select is(private.check_ledger(), 0, 'clean books: no problems');
select is((select count(*)::int from public.ledger_alerts), 0, '...and no alerts');
select is((select problems from private.ledger_check_runs order by id desc limit 1), 0, 'the run is recorded');

-- Corrupt one line behind the triggers' back.
set constraints all immediate;
alter table public.journal_lines disable trigger journal_lines_balanced;
update public.journal_lines set amount_cents = amount_cents + 100
where transaction_id = tests.id('t1') and amount_cents > 0;
select is(private.check_ledger(), 2, 'a corrupted line: two problems');
select results_eq(
  $$ select kind, transaction_id, detail ->> 'sum_cents' from public.ledger_alerts where resolved_at is null order by kind $$,
  $$ values ('trial_balance', null::uuid, '100'), ('unbalanced_transaction', tests.id('t1'), '100') $$,
  'the transaction and the trial balance are flagged');
select is((select count(*)::int from public.ledger_alerts where business_id = tests.id('B')), 0, 'other businesses are unaffected');
select is(private.check_ledger(), 2, 'running again');
select is((select count(*)::int from public.ledger_alerts), 2, '...does not duplicate alerts');

delete from public.journal_lines where transaction_id = tests.id('t2') and amount_cents < 0;
select is(private.check_ledger(tests.id('A')), 4, 'a missing line too: two unbalanced transactions, a wrong line count, the trial balance');

select tests.login('vic');
select is((select count(*)::int from public.ledger_alerts where resolved_at is null), 4, 'members of the business see its alerts');
select tests.login('bob');
select is((select count(*)::int from public.ledger_alerts), 0, 'outsiders see none');
select throws_ok($$ select private.check_ledger() $$, '42501', null, 'users cannot run the check');
reset role;

-- Fix it: alerts resolve.
update public.journal_lines set amount_cents = amount_cents - 100 where transaction_id = tests.id('t1') and amount_cents > 0;
insert into public.journal_lines (business_id, transaction_id, account_id, amount_cents)
values (tests.id('A'), tests.id('t2'), tests.id('a_card'), -1200);
select is(private.check_ledger(), 0, 'fixed: no problems');
select is((select count(*)::int from public.ledger_alerts where resolved_at is null), 0, 'every alert is resolved');
alter table public.journal_lines enable trigger journal_lines_balanced;

select is((select schedule from cron.job where jobname = 'ledger-check-nightly'), '0 7 * * *', 'scheduled nightly');

select * from finish();
rollback;

-- Reconcile to statement: the lines, the running difference, finishing only at zero,
-- the next statement starting from the last, transfers clearing on each side, access.
begin;
\ir _setup.psql
select no_plan();

create function tests.summary(rec text) returns text language sql stable as $$
  select (beginning_cents, cleared_cents, cleared_count, statement_balance_cents, difference_cents)::text
  from public.reconciliation_summary(tests.id(rec))
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('ed');
select tests.put('dep',  tests.post('A', '2026-05-01', 'a_chk', 10000, 'Deposit', 'a_sales')::text);
select tests.put('fee',  tests.post('A', '2026-05-03', 'a_chk', -2500, 'Software', 'a_soft')::text);
select tests.put('pay',  tests.post('A', '2026-05-05', 'a_chk', -3000, 'Card payment', 'a_card')::text);
select tests.put('late', tests.post('A', '2026-05-20', 'a_chk', -1000, 'After the statement', 'a_soft')::text);
select tests.put('chg',  tests.post('A', '2026-05-04', 'a_card', -800, 'Card charge', 'a_soft')::text);

select tests.put('r1', public.start_reconciliation(tests.id('a_chk'), '2026-05-15', 4500)::text);
select results_eq($$ select transaction_id, amount_cents, cleared from public.reconciliation_lines(tests.id('r1')) $$,
  $$ values (tests.id('dep'), 10000::bigint, false), (tests.id('fee'), -2500::bigint, false), (tests.id('pay'), -3000::bigint, false) $$,
  'lines: this account, on or before the statement date, signed as the bank shows them');
select is(tests.summary('r1'), '(0,0,0,4500,4500)', 'nothing ticked: the whole balance is the difference');

select is(public.set_reconciliation_cleared(tests.id('r1'), array[tests.id('dep'), tests.id('fee'), tests.id('chg')], true), 2,
  'tick two (a card transaction on the list is ignored)');
select is(tests.summary('r1'), '(0,7500,2,4500,-3000)', 'difference after two ticks');
select throws_ok($$ select public.finish_reconciliation(tests.id('r1')) $$, '22023', null, 'cannot finish with a difference');
select public.set_reconciliation_cleared(tests.id('r1'), array[tests.id('pay')], true);
select is(tests.summary('r1'), '(0,4500,3,4500,0)', 'all three: difference 0');
select public.finish_reconciliation(tests.id('r1'));
select is((select status from public.reconciliations where id = tests.id('r1')), 'completed', 'finished');
select throws_ok($$ select public.set_reconciliation_cleared(tests.id('r1'), array[tests.id('pay')], false) $$, '22023', null,
  'a finished statement cannot change');

-- Next statement starts from this one.
select throws_ok($$ select public.start_reconciliation(tests.id('a_chk'), '2026-05-10', 0) $$, '22023', null,
  'a statement date before the last one is refused');
select tests.put('r2', public.start_reconciliation(tests.id('a_chk'), '2026-05-31', 3500)::text);
select results_eq($$ select transaction_id from public.reconciliation_lines(tests.id('r2')) $$, $$ values (tests.id('late')) $$,
  'cleared transactions are not offered again');
select public.set_reconciliation_cleared(tests.id('r2'), array[tests.id('late')], true);
select is(tests.summary('r2'), '(4500,-1000,1,3500,0)', 'beginning balance = last statement');
select public.start_reconciliation(tests.id('a_chk'), '2026-05-18', 3500);
select is((select count(*)::int from public.reconciliation_items where reconciliation_id = tests.id('r2')), 0,
  'moving the statement date earlier drops ticks after it');
select public.discard_reconciliation(tests.id('r2'));
select is((select count(*)::int from public.reconciliations where money_account_id = tests.id('a_chk')), 1, 'discard an unfinished one');

-- The card side of the same transfer clears separately, as amount owed.
select tests.put('rc', public.start_reconciliation(tests.id('a_card'), '2026-05-31', -2200)::text);
select results_eq($$ select transaction_id, amount_cents from public.reconciliation_lines(tests.id('rc')) $$,
  $$ values (tests.id('chg'), 800::bigint), (tests.id('pay'), -3000::bigint) $$,
  'card: a charge adds to what is owed, the payment reduces it');
select public.set_reconciliation_cleared(tests.id('rc'), array[tests.id('chg'), tests.id('pay')], true);
select is(tests.summary('rc'), '(0,-2200,2,-2200,0)', 'card reconciles (overpaid by $22)');

-- Access
select tests.login('vic');
select ok((select count(*) from public.reconciliations where business_id = tests.id('A')) > 0, 'viewers can see reconciliations');
select throws_ok($$ select public.start_reconciliation(tests.id('a_chk'), '2026-06-30', 0) $$, '42501', null, 'viewers cannot start one');
select tests.login('bob');
select is((select count(*)::int from public.reconciliations where business_id = tests.id('A')), 0, 'outsiders see nothing');
select throws_ok($$ select public.set_reconciliation_cleared(tests.id('rc'), array[tests.id('chg')], false) $$, '42501', null,
  'outsiders cannot tick');

select * from finish();
rollback;

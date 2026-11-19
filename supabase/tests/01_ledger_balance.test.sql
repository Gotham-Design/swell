-- Every posted transaction has exactly two journal lines that sum to zero, and lines can
-- only be written through the posting functions.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');

-- One of each kind.
select tests.put('t_sale',  tests.post('A', '2026-05-01', 'a_chk',  100000, 'Invoice 1001 paid', 'a_sales')::text);
select tests.put('t_soft',  tests.post('A', '2026-05-02', 'a_chk',   -4999, 'GITHUB.COM', 'a_soft')::text);
select tests.put('t_uncat', tests.post('A', '2026-05-03', 'a_chk',   -1234, 'SQ *MYSTERY')::text);
select tests.put('t_xfer',  tests.post('A', '2026-05-04', 'a_chk',  -50000, 'Card payment', 'a_card')::text);
select tests.put('t_draw',  tests.post('A', '2026-05-05', 'a_chk',  -20000, 'Owner draw', 'a_draws')::text);
select tests.put('t_equip', tests.post('A', '2026-05-06', 'a_card', -150000, 'Laptop', 'a_equip')::text);

-- ---------------------------------------------------------------------------
-- Balanced lines
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.transactions where business_id = tests.id('A')), 6,
  'six transactions posted');
select is(
  (select count(*)::int from public.transactions t
   where t.business_id = tests.id('A')
     and (select count(*) from public.journal_lines jl where jl.transaction_id = t.id) <> 2),
  0, 'every transaction has exactly two journal lines');
select is(
  (select count(*)::int from (
     select transaction_id from public.journal_lines where business_id = tests.id('A')
     group by transaction_id having sum(amount_cents) <> 0) x),
  0, 'every transaction''s lines sum to zero');
select is((select sum(amount_cents)::bigint from public.journal_lines where business_id = tests.id('A')), 0::bigint,
  'trial balance sums to zero');

select results_eq(
  $$ select account_id, amount_cents from public.journal_lines where transaction_id = tests.id('t_soft') order by amount_cents $$,
  $$ values (tests.id('a_chk'), -4999::bigint), (tests.id('a_soft'), 4999::bigint) $$,
  'an expense credits the money account and debits the category');
select results_eq(
  $$ select account_id, amount_cents from public.journal_lines where transaction_id = tests.id('t_uncat') order by amount_cents $$,
  $$ values (tests.id('a_chk'), -1234::bigint), (tests.id('a_uncat'), 1234::bigint) $$,
  'an uncategorized transaction posts its other side to the system Uncategorized account');
select results_eq(
  $$ select account_id, amount_cents from public.journal_lines where transaction_id = tests.id('t_xfer') order by amount_cents $$,
  $$ values (tests.id('a_chk'), -50000::bigint), (tests.id('a_card'), 50000::bigint) $$,
  'paying the card from checking moves money between the two money accounts');

select results_eq(
  $$ select kind::text from public.transactions
     where id in (tests.id('t_sale'), tests.id('t_soft'), tests.id('t_uncat'), tests.id('t_xfer'), tests.id('t_draw'), tests.id('t_equip'))
     order by date $$,
  $$ values ('income'), ('expense'), ('other'), ('transfer'), ('equity'), ('other') $$,
  'kind is derived from the category type');

-- ---------------------------------------------------------------------------
-- Editing reposts the lines
-- ---------------------------------------------------------------------------
select tests.edit('t_uncat', cat => 'a_soft');
select is(tests.balance('a_uncat'), 0::bigint, 'categorizing moves the amount out of Uncategorized');
select is(tests.balance('a_soft'), 6233::bigint, '...and into the chosen category');
select is((select kind::text from public.transactions where id = tests.id('t_uncat')), 'expense', 'kind follows the new category');

select tests.edit('t_soft', p_amount => -5999);
select results_eq(
  $$ select account_id, amount_cents from public.journal_lines where transaction_id = tests.id('t_soft') order by amount_cents $$,
  $$ values (tests.id('a_chk'), -5999::bigint), (tests.id('a_soft'), 5999::bigint) $$,
  'changing the amount reposts both lines');

select tests.edit('t_sale', uncategorize => true);
select is(tests.balance('a_uncat'), -100000::bigint, 'un-categorizing posts back to Uncategorized');
select is((select kind::text from public.transactions where id = tests.id('t_sale')), 'other', 'uncategorized kind is other');

select is(
  (select count(*)::int from (
     select transaction_id from public.journal_lines where business_id = tests.id('A')
     group by transaction_id having sum(amount_cents) <> 0 or count(*) <> 2) x),
  0, 'after edits, every transaction still has two lines summing to zero');
select is((select sum(amount_cents)::bigint from public.journal_lines where business_id = tests.id('A')), 0::bigint,
  'trial balance still zero after edits');

select ok(
  (select count(*) from public.audit_log where entity_id = tests.id('t_soft') and action = 'update'
     and before ->> 'amount_cents' = '-4999' and after ->> 'amount_cents' = '-5999') = 1,
  'edits are audited with before and after');
select is((select count(*)::int from public.audit_log where entity = 'transactions' and action = 'create'), 6,
  'every post is audited');

-- ---------------------------------------------------------------------------
-- Bad postings are refused
-- ---------------------------------------------------------------------------
select throws_ok($$ select tests.post('A', '2026-05-07', 'a_chk', 0, 'Zero') $$,
  '23514', null, 'zero amounts are refused');
select throws_ok($$ select tests.post('A', '2026-05-07', 'a_chk', -100, 'Self', 'a_chk') $$,
  '22023', null, 'a transaction cannot be categorized to its own money account');
select throws_ok($$ select tests.post('A', '2026-05-07', 'a_chk', -100, 'Sys', 'a_uncat') $$,
  '22023', null, 'system accounts cannot be picked as a category');
select throws_ok($$ select tests.post('A', '2026-05-07', 'a_sales', -100, 'Not money') $$,
  '22023', null, 'the money side must be a money account');
select throws_ok($$ select tests.post('A', '2026-05-07', 'a_chk', -100, '   ') $$,
  '23514', null, 'a description is required');

-- ---------------------------------------------------------------------------
-- Journal lines and transactions are never written directly
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.journal_lines (business_id, transaction_id, account_id, amount_cents)
     values (tests.id('A'), tests.id('t_soft'), tests.id('a_soft'), 1) $$,
  '42501', null, 'members cannot insert journal lines');
select throws_ok(
  $$ update public.journal_lines set amount_cents = 1 where transaction_id = tests.id('t_soft') $$,
  '42501', null, 'members cannot update journal lines');
select throws_ok(
  $$ delete from public.journal_lines where transaction_id = tests.id('t_soft') $$,
  '42501', null, 'members cannot delete journal lines');
select throws_ok(
  $$ update public.transactions set amount_cents = 1 where id = tests.id('t_soft') $$,
  '42501', null, 'members cannot update transactions directly');
select throws_ok(
  $$ insert into public.transactions (business_id, date, description_raw, amount_cents, money_account_id, kind)
     values (tests.id('A'), '2026-05-08', 'Sneaky', 100, tests.id('a_chk'), 'income') $$,
  '42501', null, 'members cannot insert transactions directly');

-- Even the database owner can't leave a transaction unbalanced: the deferred check fires.
reset role;
create function tests.unbalance() returns void language plpgsql as $$
begin
  insert into public.journal_lines (business_id, transaction_id, account_id, amount_cents)
  values (tests.id('A'), tests.id('t_soft'), tests.id('a_soft'), 1);
  set constraints all immediate;
end $$;
select throws_ok('select tests.unbalance()', '23514', null,
  'an unbalanced journal is rejected at commit, whoever writes it');

select * from finish();
rollback;

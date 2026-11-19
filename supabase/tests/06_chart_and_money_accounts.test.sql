-- Standard chart, pickers, archive/delete, merge, money accounts and opening balances.
begin;
\ir _setup.psql
select no_plan();

-- ---------------------------------------------------------------------------
-- Standard chart
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select type::text, count(*)::int from public.accounts
     where business_id = tests.id('A') and is_standard and not is_system group by type order by type $$,
  $$ values ('asset', 5), ('equity', 3), ('expense', 19), ('income', 5), ('liability', 3) $$,
  'every business gets the standard chart, by type');
select results_eq(
  $$ select name from public.accounts where business_id = tests.id('A') and is_system order by name $$,
  $$ values ('Retained Earnings'), ('Transfer Clearing'), ('Uncategorized') $$,
  'and the system accounts');
select is((select count(*)::int from public.accounts where business_id = tests.id('A') and is_standard
           and coalesce(length(description), 0) < 10), 0, 'every standard account has a description');
select ok((select is_hidden from public.accounts where id = tests.std('A', 'Accounts Receivable')),
  'Accounts Receivable is hidden in v1');
select is((select subtype from public.accounts where id = tests.std('A', 'Refunds & Returns')), 'contra',
  'Refunds & Returns is a contra-income account');

-- ---------------------------------------------------------------------------
-- Pickers: custom in, archived/hidden/system out
-- ---------------------------------------------------------------------------
select tests.login('ed');
select tests.put('c_cowork', tests.add_account('A', 'Coworking', 'expense')::text);
select tests.put('c_snacks', tests.add_account('A', 'Snacks', 'expense')::text);
select ok(exists (select 1 from public.category_picker where id = tests.id('c_cowork')), 'a custom category appears in the picker');
select ok(exists (select 1 from public.category_picker where id = tests.id('a_chk')), 'money accounts appear (as transfer targets)');
select ok(not exists (select 1 from public.category_picker where id = tests.id('a_uncat')), 'system accounts do not');
select ok(not exists (select 1 from public.category_picker where id = tests.std('A', 'Accounts Receivable')), 'hidden accounts do not');

update public.accounts set archived_at = now() where id = tests.id('c_cowork');
select ok(not exists (select 1 from public.category_picker where id = tests.id('c_cowork')), 'an archived category does not appear');
select throws_ok($$ select tests.post('A', '2026-05-01', 'a_chk', -100, 'Desk', 'c_cowork') $$,
  '22023', null, 'nothing can be posted to an archived category');
update public.accounts set archived_at = null where id = tests.id('c_cowork');
select ok(exists (select 1 from public.category_picker where id = tests.id('c_cowork')), 'unarchiving brings it back');

-- Users can't forge flags or make money accounts by hand.
select throws_ok($$ insert into public.accounts (business_id, name, type, is_standard) values (tests.id('A'), 'Fake', 'expense', true) $$,
  '42501', null, 'users cannot create standard accounts');
select throws_ok($$ insert into public.accounts (business_id, name, type, is_money_account) values (tests.id('A'), 'Fake Bank', 'asset', true) $$,
  '42501', null, 'money accounts are created only through create_money_account');
select throws_ok($$ update public.accounts set is_hidden = true where id = tests.id('c_snacks') $$,
  '42501', null, 'users cannot change hidden/standard flags');
select lives_ok($$ update public.accounts set name = 'Gross Sales', description = 'All sales' where id = tests.id('a_sales') $$,
  'standard categories can be renamed and described');

-- ---------------------------------------------------------------------------
-- Kinds: cash/card headers are transfers
-- ---------------------------------------------------------------------------
select tests.put('cc_hdr', tests.std('A', 'Credit Card')::text),
       tests.put('sav_hdr', tests.std('A', 'Savings')::text),
       tests.put('loan_hdr', tests.std('A', 'Loans Payable')::text);
select tests.put('t_cc', tests.post('A', '2026-05-01', 'a_chk', -30000, 'Pay untracked card', 'cc_hdr')::text);
select tests.put('t_sav', tests.post('A', '2026-05-01', 'a_chk', -10000, 'To savings', 'sav_hdr')::text);
select tests.put('t_loan', tests.post('A', '2026-05-01', 'a_chk', -5000, 'Loan principal', 'loan_hdr')::text);
select results_eq(
  $$ select kind::text from public.transactions where id in (tests.id('t_cc'), tests.id('t_sav'), tests.id('t_loan')) order by amount_cents $$,
  $$ values ('transfer'), ('transfer'), ('other') $$,
  'paying a card or moving to savings is a transfer; loan principal is other');

-- ---------------------------------------------------------------------------
-- Delete only if unused
-- ---------------------------------------------------------------------------
select tests.put('c_temp', tests.add_account('A', 'Temporary', 'expense')::text);
delete from public.accounts where id = tests.id('c_temp');
select ok(not exists (select 1 from public.accounts where id = tests.id('c_temp')), 'an unused category can be deleted');
select throws_ok($$ delete from public.accounts where id = tests.std('A', 'Credit Card') $$,
  '23503', null, 'a used category cannot be deleted');
select throws_ok($$ delete from public.accounts where id = tests.std('A', 'Opening Balance Equity') $$,
  '23514', null, 'Opening Balance Equity cannot be deleted');
select throws_ok($$ update public.accounts set archived_at = now() where id = tests.std('A', 'Opening Balance Equity') $$,
  '23514', null, 'or archived');
select is((select line_count from public.account_usage where account_id = tests.std('A', 'Credit Card')), 1,
  'account_usage reports how many lines use an account');

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------
select tests.put('m1', tests.post('A', '2026-05-02', 'a_chk', -500, 'Chips', 'c_snacks')::text);
select tests.put('m2', tests.post('A', '2026-05-03', 'a_card', -700, 'Soda', 'c_snacks')::text);
select tests.put('m3', tests.post('A', '2026-05-04', 'a_chk', -900, 'Cookies', 'c_snacks')::text);
select public.soft_delete_transaction(tests.id('m3'));
select tests.put('c_sub', tests.add_account('A', 'Healthy Snacks', 'expense')::text);
update public.accounts set parent_id = tests.id('c_snacks') where id = tests.id('c_sub');
insert into public.category_rules (business_id, vendor_normalized, category_account_id) values (tests.id('A'), 'costco', tests.id('c_snacks'));
select tests.put('meals', tests.std('A', 'Meals')::text);

select throws_ok($$ select public.merge_category(tests.id('c_snacks'), tests.id('a_sales')) $$, '22023', null, 'merging across types is refused');
select throws_ok($$ select public.merge_category(tests.id('c_snacks'), tests.id('a_uncat')) $$, '22023', null, 'merging into a system account is refused');
select throws_ok($$ select public.merge_category(tests.id('c_snacks'), tests.id('c_snacks')) $$, '22023', null, 'merging into itself is refused');
select tests.login('vic');
select throws_ok($$ select public.merge_category(tests.id('c_snacks'), tests.id('meals')) $$, '42501', null, 'viewers cannot merge');
select tests.login('bob');
select throws_ok($$ select public.merge_category(tests.id('c_snacks'), tests.id('meals')) $$, '42501', null, 'outsiders cannot merge');

select tests.login('ed');
select is(public.merge_category(tests.id('c_snacks'), tests.id('meals')), 3, 'merge reports every transaction moved');
select is((select count(*)::int from public.transactions where category_account_id = tests.id('c_snacks')), 0,
  'no transaction is left on the merged category');
select is((select count(*)::int from public.transactions where id in (tests.id('m1'), tests.id('m2'), tests.id('m3'))
           and category_account_id = tests.id('meals') and kind = 'expense'), 3,
  'every transaction moved, deleted ones included');
select is((select count(*)::int from public.journal_lines where account_id = tests.id('c_snacks')), 0,
  'no journal line is left on the merged category');
select is(tests.balance('meals'), 1200::bigint, 'the target balance picks up the live amounts');
select is((select count(*)::int from (select transaction_id from public.journal_lines where business_id = tests.id('A')
           group by 1 having sum(amount_cents) <> 0 or count(*) <> 2) x), 0, 'every transaction still balances');
select ok((select archived_at is not null from public.accounts where id = tests.id('c_snacks')), 'the merged category is archived');
select is((select parent_id from public.accounts where id = tests.id('c_sub')), tests.id('meals'), 'its children move to the target');
select is((select category_account_id from public.category_rules where vendor_normalized = 'costco'), tests.id('meals'), 'its rules move too');
select ok(exists (select 1 from public.audit_log where action = 'merge' and entity_id = tests.id('c_snacks')
                  and after ->> 'into' = tests.id('meals')::text and (after ->> 'transaction_count')::int = 3),
  'the merge is audited');

-- Locked transactions can't move.
select tests.put('c_old', tests.add_account('A', 'Old Stuff', 'expense')::text);
select tests.post('A', '2026-01-15', 'a_chk', -100, 'Old', 'c_old');
select tests.login('alice');
update public.businesses set lock_date = '2026-01-31' where id = tests.id('A');
select tests.login('ed');
select throws_like($$ select public.merge_category(tests.id('c_old'), tests.id('meals')) $$, '%lock date%',
  'merging is refused when it would change locked transactions');
select tests.login('alice');
update public.businesses set lock_date = null where id = tests.id('A');

-- ---------------------------------------------------------------------------
-- Money accounts and opening balances
-- ---------------------------------------------------------------------------
select tests.login('ed');
select tests.put('ops', public.create_money_account(tests.id('A'), 'Operating', 'checking', '1234', 500000, '2026-01-01')::text);
select tests.put('visa', public.create_money_account(tests.id('A'), 'Chase Ink', 'credit_card', '9876', 120000, '2026-01-01')::text);
select tests.put('obe', tests.std('A', 'Opening Balance Equity')::text);

select results_eq($$ select type::text, subtype, last4, parent_id from public.accounts where id = tests.id('ops') $$,
  $$ values ('asset', 'checking', '1234', tests.std('A', 'Checking')) $$, 'a checking account nests under Checking');
select is((select parent_id from public.accounts where id = tests.id('visa')), tests.std('A', 'Credit Card'), 'a card nests under Credit Card');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('ops')), 500000::bigint,
  'the opening balance makes the checking balance correct');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('visa')), 120000::bigint,
  'a card''s opening balance is what you owe');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('obe')), 380000::bigint,
  'Opening Balance Equity holds the difference');
select is((select sum(balance_cents)::bigint from public.account_balances where business_id = tests.id('A')), 0::bigint,
  'the books still balance');
select results_eq($$ select kind::text, category_account_id, date from public.transactions
                     where id = (select opening_transaction_id from public.accounts where id = tests.id('ops')) $$,
  $$ values ('equity', tests.id('obe'), '2026-01-01'::date) $$, 'the opening balance is an equity transaction on its date');

select public.set_opening_balance(tests.id('ops'), 650000, '2025-12-31');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('ops')), 650000::bigint,
  'changing the opening balance updates the account');
select is((select count(*)::int from public.transactions where money_account_id = tests.id('ops')), 1,
  '...by editing the same transaction, not adding one');
select public.set_opening_balance(tests.id('ops'), 0, null);
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('ops')), 0::bigint,
  'clearing it removes it from the balance');
select public.set_opening_balance(tests.id('ops'), 10000, '2026-01-01');
select is((select natural_balance_cents from public.account_balances where account_id = tests.id('ops')), 10000::bigint,
  'setting it again restores and updates the same transaction');
select is((select sum(balance_cents)::bigint from public.account_balances where business_id = tests.id('A')), 0::bigint,
  'the books balance after every change');

select tests.put('cashbox', public.create_money_account(tests.id('A'), 'Petty Cash', 'cash')::text);
select is((select opening_transaction_id from public.accounts where id = tests.id('cashbox')), null, 'no opening balance, no transaction');
select throws_ok($$ select public.create_money_account(tests.id('A'), 'Checking', 'checking') $$,
  '23505', null, 'money account names are unique alongside the chart');
select throws_ok($$ select public.create_money_account(tests.id('A'), 'Brokerage', 'brokerage') $$,
  '22023', null, 'unknown money account kinds are refused');
select throws_ok($$ select public.create_money_account(tests.id('A'), 'Bad Last4', 'checking', '12ab') $$,
  '23514', null, 'last 4 must be four digits');

select tests.login('vic');
select throws_ok($$ select public.create_money_account(tests.id('A'), 'Viewer Bank', 'checking') $$, '42501', null, 'viewers cannot add money accounts');
select throws_ok($$ select public.set_opening_balance(tests.id('ops'), 1, '2026-01-01') $$, '42501', null, 'viewers cannot change opening balances');
select tests.login('bob');
select throws_ok($$ select public.create_money_account(tests.id('A'), 'Bob Bank', 'checking') $$, '42501', null, 'outsiders cannot add money accounts');

select * from finish();
rollback;

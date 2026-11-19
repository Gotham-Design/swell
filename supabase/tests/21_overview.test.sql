-- Overview, money account and import screens: monthly income/expense, money movement,
-- the notes strip, month-end balances, last import per account, AI on by default.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('meals', tests.std('A', 'Meals')::text);
select tests.put('rent', tests.std('A', 'Rent')::text);
select tests.put('sav', tests.add_money('A', 'Acme Savings', 'savings', 100000, '2026-07-31')::text);

-- September: $1,000 sales, $200 software, $50 meals.
select tests.post('A', '2026-09-03', 'a_chk', 100000, 'Square deposit', 'a_sales');
select tests.post('A', '2026-09-10', 'a_card', -20000, 'Figma', 'a_soft');
select tests.post('A', '2026-09-12', 'a_card', -5000, 'Cafe', 'meals');
-- October: $1,500 sales in two deposits, $400 software, a $20 software refund, $300 equipment
-- (an asset, not an expense), a $500 card payment (transfer), a $90 uncategorized charge.
select tests.post('A', '2026-10-02', 'a_chk', 90000, 'Square deposit', 'a_sales');
select tests.post('A', '2026-10-09', 'a_chk', 60000, 'Client payment', 'a_sales');
select tests.post('A', '2026-10-05', 'a_card', -40000, 'Figma', 'a_soft');
select tests.post('A', '2026-10-06', 'a_card', 2000, 'Figma refund', 'a_soft');
select tests.post('A', '2026-10-07', 'a_chk', -30000, 'Oven', 'a_equip');
select tests.post('A', '2026-10-15', 'a_chk', -50000, 'Card payment', 'a_card');
select tests.post('A', '2026-10-20', 'a_card', -9000, 'Mystery charge');
-- A category used for the first time this month.
select tests.post('A', '2026-10-01', 'a_chk', -10000, 'Storage unit', 'rent');

-- ---------------------------------------------------------------------------
-- Monthly income and expense
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select month, income_cents, expense_cents from public.monthly_income_expense(tests.id('A'), 3, '2026-10-22') $$,
  $$ values ('2026-08-01'::date, 0::bigint, 0::bigint), ('2026-09-01', 100000, 25000), ('2026-10-01', 150000, 57000) $$,
  'one row per month, P&L signs: refunds reduce expense, assets and transfers stay out, uncategorized counts');

-- ---------------------------------------------------------------------------
-- Money movement (October)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select direction, rank, amount_cents, total_cents from public.money_movement(tests.id('A'), '2026-10-01', '2026-10-31') $$,
  $$ values ('in', 1, 150000::bigint, 152000::bigint), ('in', 2, 2000, 152000),
            ('out', 1, 40000, 89000), ('out', 2, 30000, 89000), ('out', 3, 19000, 89000) $$,
  'grouped by vendor, else category; top 2 per direction plus everything else; the card payment (a transfer) is left out');
select is((select label from public.money_movement(tests.id('A'), '2026-10-01', '2026-10-31') where direction = 'out' and rank = 3),
  'Everything else', 'the remainder is labeled');

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select kind from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') $$,
  $$ values ('category_change'), ('new_category'), ('largest_payment'), ('to_review') $$,
  'all four notes qualify, in order');
select is((select headline from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') where kind = 'category_change'),
  'Sales is up 50% from September', 'biggest change, named against the previous month');
select is((select detail from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') where kind = 'category_change'),
  '$1,500.00 this month vs. $1,000.00 last month', '...with both amounts');
select is((select headline from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') where kind = 'to_review'),
  '1 transaction to review', 'review count');
select is((select link_params from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') where kind = 'to_review'),
  '{"type": "uncategorized"}'::jsonb, 'notes carry the transaction-list filter they point at');
select is((select count(*)::int from public.overview_notes(tests.id('A'), '2026-10-01', '2026-10-31') where kind = 'new_category'), 1,
  'a category used for the first time is noted');

-- Small changes don't make a note: under $100 or under 10%.
select tests.post('A', '2026-11-03', 'a_chk', 150500, 'Square deposit', 'a_sales');
select is((select count(*)::int from public.overview_notes(tests.id('A'), '2026-11-01', '2026-11-30')
  where kind = 'category_change' and headline like 'Sales%'), 0, 'a $5 change is not news');

-- ---------------------------------------------------------------------------
-- Month-end balances
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select month_end, balance_cents from public.money_account_month_end(tests.id('A'), tests.id('a_card'), 2, '2026-10-22') $$,
  $$ values ('2026-09-30'::date, 25000::bigint), ('2026-10-31', 22000) $$,
  'a card reads as owed: charges add, payments and refunds reduce');
select results_eq(
  $$ select balance_cents from public.money_account_month_end(tests.id('A'), tests.id('sav'), 1, '2026-10-22') $$,
  $$ values (100000::bigint) $$, 'opening balances count');
select is((select count(*)::int from public.money_account_month_end(tests.id('A'), tests.id('a_sales'), 3, '2026-10-22')), 0,
  'not a money account: no rows');

-- ---------------------------------------------------------------------------
-- Last import per account, and access
-- ---------------------------------------------------------------------------
reset role;
insert into public.import_batches (business_id, money_account_id, status, file_name, committed_at, date_to) values
  (tests.id('A'), tests.id('a_chk'), 'committed', 'sep.csv', '2026-10-01 12:00+00', '2026-09-30'),
  (tests.id('A'), tests.id('a_chk'), 'committed', 'oct.csv', '2026-10-21 12:00+00', '2026-10-20'),
  (tests.id('A'), tests.id('a_card'), 'staged', 'draft.csv', null, null);
select tests.login('vic');
select results_eq(
  $$ select money_account_id, last_statement_date from public.money_account_last_import order by 1 $$,
  $$ values (tests.id('a_chk'), '2026-10-20'::date) $$,
  'latest committed import per account; staged ones do not count; viewers can read it');

select tests.login('bob');
select is((select count(*)::int from public.money_account_last_import), 0, 'other businesses see nothing');
select is((select count(*)::int from public.monthly_income_expense(tests.id('A'), 3, '2026-10-22') where income_cents <> 0), 0,
  'strangers get zeros, not Acme''s numbers');
select is((select count(*)::int from public.money_movement(tests.id('A'), '2026-10-01', '2026-10-31')), 0, '...and no movement');

-- ---------------------------------------------------------------------------
-- New businesses start with AI suggestions on
-- ---------------------------------------------------------------------------
select tests.login('alice');
select tests.put('C', public.create_business('Charlie')::text);
select is((select ai_enabled from public.businesses where id = tests.id('C')), true,
  'AI category suggestions are on for a new business');

select * from finish();
rollback;

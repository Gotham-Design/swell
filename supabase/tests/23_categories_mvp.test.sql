-- Categories screen: per-category period stats, one category's months, its top vendors.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('rent', tests.std('A', 'Rent')::text);

-- September: $1,000 sales, $200 software.
select tests.post('A', '2026-09-03', 'a_chk', 100000, 'Square deposit', 'a_sales');
select tests.post('A', '2026-09-10', 'a_card', -20000, 'Figma', 'a_soft');
-- October: $1,500 sales, $400 software less a $20 refund, $100 rent (first time),
-- a $500 card payment (transfer), a $90 uncategorized charge.
select tests.post('A', '2026-10-02', 'a_chk', 90000, 'Square deposit', 'a_sales');
select tests.post('A', '2026-10-09', 'a_chk', 60000, 'Client payment', 'a_sales');
select tests.post('A', '2026-10-05', 'a_card', -40000, 'Figma', 'a_soft');
select tests.post('A', '2026-10-06', 'a_card', 2000, 'Figma refund', 'a_soft');
select tests.post('A', '2026-10-01', 'a_chk', -10000, 'Storage unit', 'rent');
select tests.post('A', '2026-10-15', 'a_chk', -50000, 'Card payment', 'a_card');
select tests.post('A', '2026-10-20', 'a_card', -9000, 'Mystery charge');

select results_eq(
  $$ select grp, tx_count, total_cents, is_new from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')
     where category_account_id is not distinct from tests.id('a_sales') $$,
  $$ values ('income', 2::bigint, 150000::bigint, false) $$, 'income: count and positive total, used before');
select results_eq(
  $$ select grp, tx_count, total_cents, is_new from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')
     where category_account_id = tests.id('a_soft') $$,
  $$ values ('expense', 2::bigint, 38000::bigint, false) $$, 'expense: positive, the refund reduces it');
select is((select is_new from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')
  where category_account_id = tests.id('rent')), true, 'first use in the period is new');
select results_eq(
  $$ select grp, total_cents from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')
     where category_account_id = tests.id('a_card') $$,
  $$ values ('transfer', 50000::bigint) $$, 'a card payment is a transfer, sized by its amount');
select results_eq(
  $$ select tx_count, total_cents from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')
     where grp = 'uncategorized' $$,
  $$ values (1::bigint, 9000::bigint) $$, 'uncategorized rows are grouped together');

select results_eq(
  $$ select month, tx_count, total_cents from public.category_monthly(tests.id('A'), tests.id('a_soft'), 3, '2026-10-22') $$,
  $$ values ('2026-08-01'::date, 0::bigint, 0::bigint), ('2026-09-01', 1, 20000), ('2026-10-01', 2, 38000) $$,
  'every month present, oldest first');

select results_eq(
  $$ select vendor, total_cents from public.category_top_vendors(tests.id('A'), tests.id('a_sales'), '2026-10-01', '2026-10-31') $$,
  $$ values ('Square deposit', 90000::bigint), ('Client payment', 60000) $$, 'vendors by total, largest first');

-- Another business sees nothing.
select tests.login('bob');
select is((select count(*) from public.category_period_stats(tests.id('A'), '2026-10-01', '2026-10-31')), 0::bigint,
  'RLS: no rows for a business you are not in');

select * from finish();
rollback;

-- vendor_totals: vendors ranked by money out (or in), transfers left out, RLS applies.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.post('A', '2026-09-03', 'a_card', -20000, 'Figma', 'a_soft');
select tests.post('A', '2026-10-05', 'a_card', -40000, 'Figma', 'a_soft');
select tests.post('A', '2026-10-06', 'a_card', -15000, 'Adobe', 'a_soft');
select tests.post('A', '2026-10-20', 'a_card', -9000, 'Mystery charge');
select tests.post('A', '2026-10-15', 'a_chk', -50000, 'Card payment', 'a_card');
select tests.post('A', '2026-10-02', 'a_chk', 90000, 'Square deposit', 'a_sales');

select results_eq(
  $$ select vendor_normalized, tx_count, total_cents from public.vendor_totals(tests.id('A'), null, null, 'out', 10) $$,
  $$ values ('figma', 2::bigint, 60000::bigint), ('adobe', 1, 15000), ('mystery charge', 1, 9000) $$,
  'money out by vendor, largest first; the card payment (a transfer) is left out');
select results_eq(
  $$ select vendor_normalized, total_cents from public.vendor_totals(tests.id('A'), '2026-10-01', '2026-10-31', 'out', 1) $$,
  $$ values ('figma', 40000::bigint) $$, 'period and limit apply');
select results_eq(
  $$ select label, total_cents from public.vendor_totals(tests.id('A'), null, null, 'in', 10) $$,
  $$ values ('Square deposit', 90000::bigint) $$, 'money in, with the name as written');

select tests.login('bob');
select is((select count(*) from public.vendor_totals(tests.id('A'), null, null, 'out', 10)), 0::bigint,
  'RLS: nothing for a business you are not in');

select * from finish();
rollback;

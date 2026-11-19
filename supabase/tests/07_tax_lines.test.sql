-- Tax-line mapping: defaults for the standard chart, form consistency, access.
begin;
\ir _setup.psql
select no_plan();

select tests.login('alice');
select is((select count(*)::int from public.tax_lines where form = 'schedule_c'), 29, 'Schedule C lines are available');
select is((select count(*)::int from public.tax_lines where form = 'form_1120s'), 24, 'Form 1120-S lines are available');

select results_eq(
  $$ select t.form, t.line from public.account_tax_lines m join public.tax_lines t on t.id = m.tax_line_id
     where m.account_id = tests.std('A', 'Meals') order by t.form $$,
  $$ values ('form_1120s', '20'), ('schedule_c', '24b') $$,
  'standard categories get a default line on each form');
select is((select count(*)::int from public.account_tax_lines where business_id = tests.id('A') and form = 'schedule_c'), 23,
  'every standard P&L category is mapped for Schedule C, except interest (Schedule B)');
select is((select t.line from public.account_tax_lines m join public.tax_lines t on t.id = m.tax_line_id
           where m.account_id = tests.std('A', 'Owner Draws') and m.form = 'form_1120s'), 'Sch K 16d',
  'owner draws map to S-corp distributions');
select is((select count(*)::int from public.account_tax_lines where account_id = tests.std('A', 'Checking')), 0,
  'balance-sheet accounts are left for the accountant');

-- Editors set and change lines; the line must match the form.
select tests.login('ed');
select lives_ok($$ insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
                   values (tests.id('A'), tests.id('a_soft'), 'schedule_c', 'sch_c:18') $$, 'editors map a custom category');
select lives_ok($$ update public.account_tax_lines set tax_line_id = 'sch_c:22'
                   where account_id = tests.id('a_soft') and form = 'schedule_c' $$, 'and change it');
select throws_ok($$ insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
                    values (tests.id('A'), tests.id('a_soft'), 'form_1120s', 'sch_c:18') $$,
  '23503', null, 'a Schedule C line cannot be used for the 1120-S mapping');
select throws_ok($$ insert into public.tax_lines (id, form, tax_year, line, label, sort) values ('x', 'schedule_c', 2025, '99', 'Fake', 1) $$,
  '42501', null, 'nobody edits the reference lines');

select tests.login('vic');
select ok((select count(*) from public.account_tax_lines where business_id = tests.id('A')) > 0, 'viewers can read mappings');
select throws_ok($$ insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
                    values (tests.id('A'), tests.id('a_sales'), 'form_1120s', 'f1120s:5') $$, '42501', null, 'viewers cannot map');
select tests.login('bob');
select is((select count(*)::int from public.account_tax_lines where business_id = tests.id('A')), 0, 'outsiders cannot read mappings');
select throws_ok($$ insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
                    values (tests.id('B'), tests.id('a_soft'), 'form_1120s', 'f1120s:20') $$,
  '23503', null, 'a Bravo mapping cannot point at an Acme category');

select * from finish();
rollback;

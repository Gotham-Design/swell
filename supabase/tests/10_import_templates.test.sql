-- Saved import mappings: one per money account and header layout; members read,
-- owners/editors write, never across businesses.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select lives_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                   values (tests.id('A'), tests.id('a_chk'), 'date|description|amount', '{"date":0}') $$, 'editors save a template');
select throws_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                    values (tests.id('A'), tests.id('a_chk'), 'date|description|amount', '{"date":1}') $$,
  '23505', null, 'one template per account and layout (re-saving is an upsert)');
select lives_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                   values (tests.id('A'), tests.id('a_card'), 'date|description|amount', '{"date":0}') $$, 'another account can have its own');
select throws_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                    values (tests.id('A'), tests.id('a_sales'), 'x', '{}') $$, '23514', null, 'only money accounts have templates');
select throws_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                    values (tests.id('A'), tests.id('a_chk'), 'y', '[]') $$, '23514', null, 'the mapping is an object');

select tests.login('vic');
select is((select count(*)::int from public.import_templates where business_id = tests.id('A')), 2, 'viewers can read templates');
select throws_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                    values (tests.id('A'), tests.id('a_chk'), 'z', '{}') $$, '42501', null, 'viewers cannot save templates');

select tests.login('bob');
select is((select count(*)::int from public.import_templates where business_id = tests.id('A')), 0, 'outsiders see none');
select throws_ok($$ insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
                    values (tests.id('B'), tests.id('a_chk'), 'z', '{}') $$, '23503', null, 'a Bravo template cannot point at an Acme account');

select * from finish();
rollback;

-- Settings: industry values and archiving a business (owners only).
begin;
\ir _setup.psql
select no_plan();

select tests.login('alice');
update public.businesses set industry = 'food_beverage' where id = tests.id('A');
select is((select industry from public.businesses where id = tests.id('A')), 'food_beverage', 'an owner sets the industry');
select throws_ok($$ update public.businesses set industry = 'space_mining' where id = tests.id('A') $$, '23514', null, 'industry is one of the list');

select tests.login('ed');
select throws_ok($$ select public.set_business_archived(tests.id('A'), true) $$, '42501', null, 'an editor cannot archive');

select tests.login('alice');
select lives_ok($$ select public.set_business_archived(tests.id('A'), true) $$, 'the owner archives');
select isnt((select archived_at from public.businesses where id = tests.id('A')), null, 'archived_at is set');
select lives_ok($$ select public.set_business_archived(tests.id('A'), false) $$, 'and restores');
select is((select archived_at from public.businesses where id = tests.id('A')), null, 'archived_at is cleared');

select * from finish();
rollback;

-- A user in business A can never read or write business B.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('t_a', tests.post('A', '2026-05-01', 'a_chk', 100000, 'Acme sale', 'a_sales')::text);
select tests.put('t_a_del', tests.post('A', '2026-05-02', 'a_chk', -500, 'Acme fee', 'a_soft')::text);
select public.soft_delete_transaction(tests.id('t_a_del'));
select tests.login('bob');
select tests.put('t_b', tests.post('B', '2026-05-01', 'b_chk', 2500, 'Bravo sale', 'b_sales')::text);

-- ---------------------------------------------------------------------------
-- Reads: bob sees only Bravo
-- ---------------------------------------------------------------------------
select tests.login('bob');
select results_eq($$ select id from public.businesses $$, $$ values (tests.id('B')) $$,
  'bob sees only his own business');
select is((select count(*)::int from public.business_members where business_id = tests.id('A')), 0, 'bob cannot list Acme members');
select is((select count(*)::int from public.accounts where business_id = tests.id('A')), 0, 'bob cannot read Acme accounts');
select is((select count(*)::int from public.transactions where business_id = tests.id('A')), 0, 'bob cannot read Acme transactions');
select is((select count(*)::int from public.transactions where id = tests.id('t_a')), 0, '...not even by id');
select is((select count(*)::int from public.journal_lines where business_id = tests.id('A')), 0, 'bob cannot read Acme journal lines');
select is((select count(*)::int from public.audit_log where business_id = tests.id('A')), 0, 'bob cannot read Acme audit log');
select is((select count(*)::int from public.account_balances where business_id = tests.id('A')), 0, 'bob cannot read Acme balances');
select ok((select count(*) from public.transactions) = 1, 'bob still sees his own transaction');

select tests.login('alice');
select results_eq($$ select id from public.businesses $$, $$ values (tests.id('A')) $$,
  'alice sees only Acme');
select is((select count(*)::int from public.transactions where business_id = tests.id('B')), 0, 'alice cannot read Bravo transactions');

-- ---------------------------------------------------------------------------
-- Writes: bob cannot touch Acme
-- ---------------------------------------------------------------------------
select tests.login('bob');
select throws_ok($$ select tests.post('A', '2026-05-03', 'a_chk', -100, 'Into Acme', 'a_soft') $$,
  '42501', null, 'bob cannot post into Acme');
select throws_ok($$ select tests.post('B', '2026-05-03', 'a_chk', -100, 'Acme money account') $$,
  '23503', null, 'bob cannot post against an Acme money account from Bravo');
select throws_ok($$ select tests.post('B', '2026-05-03', 'b_chk', -100, 'Acme category', 'a_sales') $$,
  '23503', null, 'bob cannot categorize to an Acme category from Bravo');
select throws_ok($$ select public.update_transaction(tests.id('t_a'), '2026-05-01', tests.id('a_chk'), 1, 'x', null, null, null, null, null, null) $$,
  '42501', null, 'bob cannot edit an Acme transaction');
select throws_ok($$ select public.soft_delete_transaction(tests.id('t_a')) $$,
  '42501', null, 'bob cannot delete an Acme transaction');
select throws_ok($$ select public.restore_transaction(tests.id('t_a_del')) $$,
  '42501', null, 'bob cannot restore an Acme transaction');
select throws_ok($$ select public.update_transaction(tests.id('t_b'), '2026-05-01', tests.id('b_chk'), 1, 'x', tests.id('a_sales'), null, null, null, null, null) $$,
  '23503', null, 'bob cannot move his own transaction onto an Acme category');

select throws_ok($$ select tests.add_account('A', 'Bob was here', 'expense') $$,
  '42501', null, 'bob cannot add an account to Acme');
select throws_ok($$ insert into public.business_members (business_id, user_id, role) values (tests.id('A'), tests.id('bob'), 'owner') $$,
  '42501', null, 'bob cannot add himself to Acme');
select throws_ok($$ insert into public.category_rules (business_id, vendor_normalized, category_account_id) values (tests.id('A'), 'github', tests.id('a_soft')) $$,
  '42501', null, 'bob cannot add an Acme category rule');
select throws_ok($$ insert into public.import_batches (business_id, money_account_id) values (tests.id('A'), tests.id('a_chk')) $$,
  '42501', null, 'bob cannot start an Acme import');

update public.accounts set name = 'Hacked' where id = tests.id('a_sales');
delete from public.accounts where id = tests.id('a_equip');
update public.businesses set lock_date = '2030-01-01', name = 'Hacked' where id = tests.id('A');
delete from public.businesses where id = tests.id('A');

-- Pointing his own rows at Acme data is refused by the (business_id, id) foreign keys.
select throws_ok($$ insert into public.category_rules (business_id, vendor_normalized, category_account_id) values (tests.id('B'), 'github', tests.id('a_soft')) $$,
  '23503', null, 'a Bravo rule cannot point at an Acme category');
select throws_ok($$ insert into public.accounts (business_id, name, type, parent_id) values (tests.id('B'), 'Child', 'income', tests.id('a_sales')) $$,
  '23503', null, 'a Bravo account cannot have an Acme parent');

reset role;
select is((select name from public.accounts where id = tests.id('a_sales')), 'Sales', 'bob''s account rename did nothing');
select ok(exists (select 1 from public.accounts where id = tests.id('a_equip')), 'bob''s account delete did nothing');
select results_eq($$ select name, lock_date from public.businesses where id = tests.id('A') $$,
  $$ values ('Acme'::text, null::date) $$, 'bob''s business update and delete did nothing');

-- Signed-out visitors get nothing at all.
select tests.login_anon();
select throws_ok($$ select * from public.transactions $$, '42501', null, 'anon cannot read transactions');
select throws_ok($$ select * from public.businesses $$, '42501', null, 'anon cannot read businesses');
select throws_ok($$ select public.create_business('Anon Inc') $$, '42501', null, 'anon cannot create a business');

select * from finish();
rollback;

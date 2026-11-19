-- Viewers are read-only; owners and editors write; the lock date closes a period.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select tests.put('t_mar', tests.post('A', '2026-03-10', 'a_chk', -2000, 'March fee', 'a_soft')::text);
select tests.put('t_mar_del', tests.post('A', '2026-03-20', 'a_chk', -300, 'March deleted', 'a_soft')::text);
select public.soft_delete_transaction(tests.id('t_mar_del'));
select tests.put('t_may', tests.post('A', '2026-05-01', 'a_chk', 90000, 'May sale', 'a_sales')::text);

-- ---------------------------------------------------------------------------
-- Viewer
-- ---------------------------------------------------------------------------
select tests.login('vic');
select is((select count(*)::int from public.transactions where business_id = tests.id('A')), 3, 'viewer can read transactions');
select ok((select count(*) from public.account_balances where business_id = tests.id('A')) > 0, 'viewer can read balances');
select throws_ok($$ select tests.post('A', '2026-05-02', 'a_chk', -100, 'Viewer post', 'a_soft') $$,
  '42501', null, 'viewer cannot post');
select throws_ok($$ select tests.edit('t_may', p_memo => 'viewer edit') $$,
  '42501', null, 'viewer cannot edit');
select throws_ok($$ select public.soft_delete_transaction(tests.id('t_may')) $$,
  '42501', null, 'viewer cannot delete');
select throws_ok($$ select public.restore_transaction(tests.id('t_mar_del')) $$,
  '42501', null, 'viewer cannot restore');
select throws_ok($$ select tests.add_account('A', 'Viewer category', 'expense') $$,
  '42501', null, 'viewer cannot add a category');
select throws_ok($$ insert into public.category_rules (business_id, vendor_normalized, category_account_id) values (tests.id('A'), 'github', tests.id('a_soft')) $$,
  '42501', null, 'viewer cannot add a category rule');
select throws_ok($$ insert into public.business_members (business_id, user_id, role) values (tests.id('A'), tests.id('bob'), 'viewer') $$,
  '42501', null, 'viewer cannot invite members');
update public.accounts set name = 'Viewer rename' where id = tests.id('a_soft');
update public.businesses set lock_date = '2030-01-01' where id = tests.id('A');
update public.business_members set role = 'owner' where user_id = tests.id('vic');

-- ---------------------------------------------------------------------------
-- Editor: writes transactions and categories, not business settings
-- ---------------------------------------------------------------------------
select tests.login('ed');
update public.businesses set lock_date = '2030-01-01' where id = tests.id('A');
update public.business_members set role = 'owner' where user_id = tests.id('ed');
update public.accounts set name = 'Renamed' where id = tests.id('a_uncat');
select throws_ok($$ insert into public.accounts (business_id, name, type, is_system) values (tests.id('A'), 'Fake system', 'expense', true) $$,
  '42501', null, 'editor cannot create a system account');

reset role;
select is((select name from public.accounts where id = tests.id('a_soft')), 'Software', 'viewer rename did nothing');
select is((select lock_date from public.businesses where id = tests.id('A')), null::date, 'neither viewer nor editor can set the lock date');
select results_eq(
  $$ select role::text from public.business_members where business_id = tests.id('A')
     and user_id in (tests.id('alice'), tests.id('ed'), tests.id('vic')) order by user_id $$,
  $$ values ('owner'), ('editor'), ('viewer') $$, 'viewer and editor cannot promote themselves');
select is((select name from public.accounts where id = tests.id('a_uncat')), 'Uncategorized', 'system accounts cannot be renamed');

-- Owner can't leave the business ownerless.
select tests.login('alice');
select throws_ok($$ update public.business_members set role = 'editor' where user_id = tests.id('alice') $$,
  '23514', null, 'the last owner cannot demote themselves');
select throws_ok($$ delete from public.business_members where user_id = tests.id('alice') $$,
  '23514', null, 'the last owner cannot leave');

-- Account type is fixed once something has posted to it.
select tests.login('ed');
select throws_ok($$ update public.accounts set type = 'income' where id = tests.id('a_soft') $$,
  '23514', null, 'a used category cannot change type');
select throws_ok($$ update public.accounts set parent_id = tests.id('a_sales') where id = tests.id('a_draws') $$,
  '23514', null, 'a parent must have the same type');

-- ---------------------------------------------------------------------------
-- Lock date: owner closes March
-- ---------------------------------------------------------------------------
select tests.login('alice');
update public.businesses set lock_date = '2026-03-31' where id = tests.id('A');
select is((select lock_date from public.businesses where id = tests.id('A')), '2026-03-31'::date, 'owner sets the lock date');

select tests.login('ed');
select throws_like($$ select tests.post('A', '2026-03-31', 'a_chk', -100, 'On lock date', 'a_soft') $$,
  '%locked%', 'posting on the lock date is refused');
select throws_like($$ select tests.post('A', '2026-03-15', 'a_chk', -100, 'Before lock date', 'a_soft') $$,
  '%locked%', 'posting before the lock date is refused');
select lives_ok($$ select tests.post('A', '2026-04-01', 'a_chk', -100, 'After lock date', 'a_soft') $$,
  'posting after the lock date works');

select throws_like($$ select tests.edit('t_mar', p_memo => 'late note') $$,
  '%locked%', 'editing a locked transaction is refused, even just the memo');
select throws_like($$ select tests.edit('t_mar', cat => 'a_draws') $$,
  '%locked%', 'recategorizing a locked transaction is refused');
select throws_like($$ select tests.edit('t_mar', p_date => '2026-04-15') $$,
  '%locked%', 'moving a locked transaction out of the closed period is refused');
select throws_like($$ select tests.edit('t_may', p_date => '2026-03-01') $$,
  '%locked%', 'moving an open transaction into the closed period is refused');
select throws_like($$ select public.soft_delete_transaction(tests.id('t_mar')) $$,
  '%locked%', 'deleting a locked transaction is refused');
select throws_like($$ select public.restore_transaction(tests.id('t_mar_del')) $$,
  '%locked%', 'restoring a locked transaction is refused');
select lives_ok($$ select tests.edit('t_may', p_memo => 'still open') $$,
  'transactions after the lock date can still be edited');

select tests.login('alice');
select throws_like($$ select tests.post('A', '2026-03-15', 'a_chk', -100, 'Owner too', 'a_soft') $$,
  '%locked%', 'the lock applies to owners too');

reset role;
select is((select memo from public.transactions where id = tests.id('t_mar')), null, 'the locked transaction is unchanged');

select * from finish();
rollback;

-- Owners invite by email; the invitee joins with that role when they sign in.
begin;
\ir _setup.psql
select no_plan();

select tests.put('newbie', 'cccccccc-0000-0000-0000-000000000001');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000', tests.id('newbie'), 'authenticated', 'authenticated', 'Newbie@Example.com', now());

-- Owner invites; others cannot.
select tests.login('alice');
select tests.put('inv', public.invite_member(tests.id('A'), '  Newbie@Example.COM ', 'viewer')::text);
select is((select email from public.business_invites where id = tests.id('inv')), 'newbie@example.com', 'invite email is normalized');
select lives_ok($$ select public.invite_member(tests.id('A'), 'newbie@example.com', 'editor') $$, 're-inviting updates the pending invite');
select results_eq($$ select role::text from public.business_invites where business_id = tests.id('A') and accepted_at is null $$,
  $$ values ('editor') $$, '...with the new role, not a second invite');
select throws_ok($$ select public.invite_member(tests.id('A'), 'ed@example.com', 'viewer') $$,
  '23505', null, 'existing members cannot be invited again');
select throws_ok($$ select public.invite_member(tests.id('A'), 'not-an-email', 'viewer') $$,
  '22023', null, 'invalid emails are refused');

select tests.login('ed');
select throws_ok($$ select public.invite_member(tests.id('A'), 'x@example.com', 'viewer') $$, '42501', null, 'editors cannot invite');
select is((select count(*)::int from public.business_invites), 0, 'editors cannot see invites');
select tests.login('vic');
select throws_ok($$ select public.invite_member(tests.id('A'), 'x@example.com', 'viewer') $$, '42501', null, 'viewers cannot invite');
select tests.login('bob');
select throws_ok($$ select public.invite_member(tests.id('A'), 'x@example.com', 'owner') $$, '42501', null, 'outsiders cannot invite');
select is((select count(*)::int from public.business_invites where business_id = tests.id('A')), 0, 'outsiders cannot see invites');
select throws_ok($$ insert into public.business_invites (business_id, email, role) values (tests.id('A'), 'y@example.com', 'owner') $$,
  '42501', null, 'invites cannot be inserted directly');

-- The invitee joins on sign-in.
select tests.login('newbie');
select is((select count(*)::int from public.businesses), 0, 'before accepting, the invitee sees no business');
select results_eq($$ select * from public.accept_my_invites() $$, $$ values (tests.id('A')) $$, 'accepting joins the invited business');
select results_eq($$ select role::text from public.business_members where user_id = tests.id('newbie') $$,
  $$ values ('editor') $$, '...with the invited role');
select is((select count(*)::int from public.businesses), 1, 'the invitee now sees the business');
select is((select count(*)::int from public.accept_my_invites()), 0, 'accepting again is a no-op');

-- Expired invites and unconfirmed emails don't join.
select tests.login('alice');
select tests.put('inv2', public.invite_member(tests.id('A'), 'bob@example.com', 'viewer')::text);
reset role;
update public.business_invites set expires_at = now() - interval '1 day' where id = tests.id('inv2');
select tests.login('bob');
select is((select count(*)::int from public.accept_my_invites()), 0, 'an expired invite is not accepted');
select is((select count(*)::int from public.business_members where business_id = tests.id('A') and user_id = tests.id('bob')), 0,
  '...and bob is still not a member');

-- Member list with emails: members only.
select tests.login('vic');
select ok((select count(*) from public.business_member_list(tests.id('A'))) = 4, 'members can list members with emails');
select ok(exists (select 1 from public.business_member_list(tests.id('A')) where email = 'alice@example.com' and role = 'owner'),
  'the list shows emails and roles');
select tests.login('bob');
select throws_ok($$ select * from public.business_member_list(tests.id('A')) $$, '42501', null, 'outsiders cannot list members');

-- Business settings changes are audited.
select tests.login('alice');
update public.businesses set lock_date = '2026-03-31' where id = tests.id('A');
select ok(exists (select 1 from public.audit_log where entity = 'businesses' and action = 'update'
                  and before ->> 'lock_date' is null and after ->> 'lock_date' = '2026-03-31'),
  'setting the lock date is audited');

select * from finish();
rollback;

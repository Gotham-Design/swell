-- Firms: admins manage the team; staff see every client or the ones picked, editing or
-- view only; leaving the firm takes every client away; other firms see nothing.
begin;
\ir _setup.psql
select no_plan();

select tests.put('sam', 'cccccccc-0000-0000-0000-000000000001');
select tests.put('kim', 'cccccccc-0000-0000-0000-000000000002');
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000000', tests.id('sam'), 'authenticated', 'authenticated', 'sam@example.com', now()),
  ('00000000-0000-0000-0000-000000000000', tests.id('kim'), 'authenticated', 'authenticated', 'kim@example.com', now());
update auth.users set email_confirmed_at = now() where id = tests.id('ed');

create function tests.sees(biz text) returns boolean language sql stable as
  $$ select exists (select 1 from public.businesses where id = tests.id(biz)) $$;
create function tests.can(biz text, roles public.member_role[]) returns boolean language sql stable as
  $$ select tests.id(biz) in (select private.my_business_ids(roles)) $$;
grant execute on all functions in schema tests to authenticated;

-- Every client lands in its creator's firm.
select tests.login('alice');
select tests.put('F', (select firm_id from public.my_firms())::text);
select is((select role::text from public.my_firms()), 'admin', 'the creator of a client is its firm''s admin');
select is((select firm_id from public.businesses where id = tests.id('A')), tests.id('F'), 'Acme is in that firm');
select tests.put('A2', public.create_business('Acme Two')::text);
set constraints all immediate;
set constraints all deferred;
select is((select firm_id from public.businesses where id = tests.id('A2')), tests.id('F'), 'a second client joins the same firm');
select isnt((select firm_id from public.businesses where id = tests.id('B')), tests.id('F'), 'Bob''s client is in his own firm');

-- Invite Sam as staff on Acme Two only, view only.
select lives_ok($$ select public.invite_firm_member(tests.id('F'), 'Sam@Example.com', 'staff', false, 'viewer', array[tests.id('A2')]) $$,
  'an admin invites staff for picked clients');
select tests.login('sam');
select results_eq($$ select * from public.accept_my_invites() $$, $$ values (tests.id('A2')) $$, 'Sam joins and gets Acme Two');
select ok(tests.can('A2', '{viewer}') and not tests.can('A2', '{owner,editor}'), 'view only on Acme Two');
select ok(not tests.sees('A'), 'and doesn''t see Acme');
select throws_ok($$ select public.invite_firm_member(tests.id('F'), 'x@example.com', 'staff') $$, '42501', null, 'staff can''t invite');
select is((select count(*)::int from public.firm_member_list(tests.id('F'))), 2, 'staff see who''s on the team');

-- All clients, can edit.
select tests.login('alice');
select lives_ok($$ select public.update_firm_member(tests.id('F'), tests.id('sam'), 'staff', true, 'editor', '{}') $$, 'move Sam to every client');
select tests.login('sam');
select ok(tests.can('A', '{editor}') and tests.can('A2', '{editor}'), 'Sam edits both clients');
select ok(not tests.sees('B'), 'never another firm''s client');

-- A client Sam makes stays his, even with picked clients.
select tests.login('alice');
select lives_ok($$ select public.update_firm_member(tests.id('F'), tests.id('sam'), 'staff', false, 'editor', array[tests.id('A2')]) $$, 'back to picked clients');
select tests.login('sam');
select tests.put('A3', public.create_business('Acme Three')::text);
set constraints all immediate;
set constraints all deferred;
select ok(tests.can('A3', '{editor}'), 'Sam keeps the client he made');
select ok(not tests.sees('A'), 'still not Acme');
select tests.login('alice');
select ok(tests.can('A3', '{owner}'), 'the admin owns it too');

-- Ed was invited to Acme directly; joining the firm as staff on Acme Two, the firm decides.
select lives_ok($$ select public.invite_firm_member(tests.id('F'), 'ed@example.com', 'staff', false, 'editor', array[tests.id('A2')]) $$, 'invite Ed to the firm');
select tests.login('ed');
select ok(tests.can('A', '{editor}'), 'before accepting, Ed keeps his direct access');
select lives_ok($$ select public.accept_my_invites() $$, 'Ed accepts');
select ok(tests.can('A2', '{editor}') and not tests.sees('A'), 'now the firm decides: Acme Two, not Acme');
select ok(tests.can('A', '{viewer}') is false, 'and Ed''s old Acme access is gone');
select tests.login('vic');
select ok(tests.can('A', '{viewer}'), 'a direct member outside the firm (the client''s own login) is left alone');

-- Leaving the firm takes every client.
select tests.login('alice');
select lives_ok($$ select public.remove_firm_member(tests.id('F'), tests.id('sam')) $$, 'remove Sam');
select tests.login('sam');
select ok(not tests.sees('A2') and not tests.sees('A3'), 'Sam sees nothing, not even the client he made');

-- The firm keeps an admin; its clients stay put; other firms can't reach in.
select tests.login('alice');
select throws_ok($$ select public.remove_firm_member(tests.id('F'), tests.id('alice')) $$, '23514', null, 'can''t remove the last admin');
select throws_ok($$ select public.update_firm_member(tests.id('F'), tests.id('alice'), 'staff', true, 'editor', '{}') $$, '23514', null, 'or demote them');
select throws_ok($$ update public.businesses set firm_id = null where id = tests.id('A') $$, '42501', null, 'a client can''t be moved out of its firm');
select lives_ok($$ select public.invite_firm_member(tests.id('F'), 'kim@example.com', 'admin') $$, 'invite a second admin');
select tests.login('kim');
select lives_ok($$ select public.accept_my_invites() $$, 'Kim accepts');
select ok(tests.can('A', '{owner}') and tests.can('A2', '{owner}') and tests.can('A3', '{owner}'), 'an admin owns every client');
select tests.login('bob');
select is((select count(*)::int from public.firm_members where firm_id = tests.id('F')), 0, 'another firm can''t see the team');
select throws_ok($$ select public.firm_member_list(tests.id('F')) $$, '42501', null, 'or list it');
select throws_ok($$ select public.invite_firm_member(tests.id('F'), 'x@example.com', 'admin') $$, '42501', null, 'or invite into it');
select throws_ok($$ select public.invite_firm_member(tests.id('F'), 'x@example.com', 'staff', false, 'editor', array[tests.id('B')]) $$,
  '42501', null, 'or hand out its own clients there');
select tests.login('alice');
select throws_ok($$ select public.invite_firm_member(tests.id('F'), 'x@example.com', 'staff', false, 'editor', array[tests.id('B')]) $$,
  '22023', null, 'an admin can only hand out the firm''s own clients');

select * from finish();
rollback;

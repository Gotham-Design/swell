-- Statement requests: writers create and revoke links; uploads are written only by the server
-- job; nobody else sees either.
begin;
\ir _setup.psql
select no_plan();

select tests.login('ed');
select lives_ok($$ insert into public.statement_requests (business_id, token_hash, from_name)
  values (tests.id('A'), repeat('a', 64), 'Ed at Acme Books') $$, 'an editor creates a request');
select tests.put('req', (select id from public.statement_requests where token_hash = repeat('a', 64))::text);
select throws_ok($$ insert into public.statement_requests (business_id, token_hash, from_name)
  values (tests.id('A'), 'not-a-hash', 'Ed') $$, '23514', null, 'only a hash is stored');
select throws_ok($$ insert into public.statement_uploads (business_id, request_id, file_name, file_size_bytes, content_type, storage_path)
  values (tests.id('A'), tests.id('req'), 'x.pdf', 10, 'application/pdf', 'a/b/x.pdf') $$, '42501', null,
  'members cannot write uploads themselves');
select lives_ok($$ update public.statement_requests set revoked_at = now() where id = tests.id('req') $$, 'an editor revokes');
select throws_ok($$ update public.statement_requests set token_hash = repeat('b', 64) where id = tests.id('req') $$, '42501', null,
  'the token never changes');

-- The server job writes an upload.
reset role;
insert into public.statement_uploads (business_id, request_id, file_name, file_size_bytes, content_type, storage_path)
values (tests.id('A'), tests.id('req'), 'september.pdf', 2048, 'application/pdf', tests.id('A')::text || '/' || tests.id('req')::text || '/x.pdf');

select tests.login('ed');
select is((select count(*) from public.statement_uploads where business_id = tests.id('A')), 1::bigint, 'editors see uploads');
select lives_ok($$ update public.statement_uploads set deleted_at = now() where business_id = tests.id('A') $$, 'and can mark them deleted');

select tests.login('vic');
select is((select count(*) from public.statement_requests), 0::bigint, 'viewers see no requests');
select is((select count(*) from public.statement_uploads), 0::bigint, 'or uploads');
select tests.login('bob');
select is((select count(*) from public.statement_requests), 0::bigint, 'other businesses see nothing');

select * from finish();
rollback;

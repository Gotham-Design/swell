-- Security invariants for the whole schema, so a new table or function can't quietly
-- skip them: RLS on every public table, a policy on every business table, no anon
-- access, no RLS-bypassing views, pinned search_path on security definer functions.
begin;
select no_plan();

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null, 'every public table has RLS enabled');

select is(
  (select array_agg(t.table_name order by t.table_name) from information_schema.columns t
   where t.table_schema = 'public' and t.column_name = 'business_id'
     and t.table_name in (select relname from pg_class where relkind = 'r')
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name)),
  null, 'every table with business_id has at least one policy');

select is(
  (select array_agg(distinct table_name::text order by table_name::text) from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'business_id')),
  null, 'anon has no privileges on business tables');

select is(
  (select array_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)),
  null, 'every public view runs as the caller (security_invoker), so RLS applies');

select is(
  (select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  null, 'every security definer function pins search_path');

select is(
  (select array_agg(policyname order by policyname) from pg_policies
   where schemaname = 'public' and (qual ~ 'has_role\(' or with_check ~ 'has_role\(')),
  null, 'no policy calls has_role per row (use my_business_ids)');

select is(
  (select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon cannot execute private functions');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'journal_lines' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'nobody writes journal lines through the API');

select is(
  (select array_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
  null, 'anon cannot execute public functions');

select ok(not has_function_privilege('authenticated', 'public.rate_limit_hit(text, text, integer, integer)', 'execute'),
  'signed-in users cannot touch rate limit counters');
select ok(not has_table_privilege('authenticated', 'private.rate_limits', 'select'), 'rate limit table is private');

select ok(public.rate_limit_hit('test', 'k', 2, 60), 'first hit allowed');
select ok(public.rate_limit_hit('test', 'k', 2, 60), 'second hit allowed');
select ok(not public.rate_limit_hit('test', 'k', 2, 60), 'third hit over the limit');
select ok(public.rate_limit_hit('test', 'other', 2, 60), 'keys count separately');

select * from finish();
rollback;

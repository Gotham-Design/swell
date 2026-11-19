-- RLS performance. Policies called private.has_role(business_id) for every row a query
-- touched, so reading one business with 20k transactions ran ~60k membership lookups and
-- could pass the API timeout. Rewritten as `business_id IN (SELECT my_business_ids(...))`:
-- the subquery doesn't depend on the row, so Postgres runs it once per query and checks
-- each row against that small set. Who can see or write what is unchanged
-- (supabase/tests/02_business_isolation and 03_roles_and_lock cover it).

create function private.my_business_ids(p_roles public.member_role[] default '{owner,editor,viewer}')
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select business_id from public.business_members where user_id = (select auth.uid()) and role = any (p_roles)
$$;
revoke all on function private.my_business_ids(public.member_role[]) from public;
grant execute on function private.my_business_ids(public.member_role[]) to authenticated;

do $$
declare
  p record;
  q text;
  c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := p.qual;
    c := p.with_check;
    -- private.has_role(col)  ->  (col IN (SELECT private.my_business_ids()))
    q := regexp_replace(q, 'private\.has_role\((\w+)\)', '(\1 IN (SELECT private.my_business_ids()))', 'g');
    c := regexp_replace(c, 'private\.has_role\((\w+)\)', '(\1 IN (SELECT private.my_business_ids()))', 'g');
    -- private.has_role(col, '{roles}'::member_role[])  ->  (col IN (SELECT private.my_business_ids('{roles}'::member_role[])))
    q := regexp_replace(q, 'private\.has_role\((\w+), (''\{[a-z,]+\}''::member_role\[\])\)', '(\1 IN (SELECT private.my_business_ids(\2)))', 'g');
    c := regexp_replace(c, 'private\.has_role\((\w+), (''\{[a-z,]+\}''::member_role\[\])\)', '(\1 IN (SELECT private.my_business_ids(\2)))', 'g');
    if q is distinct from p.qual or c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I %s %s', p.policyname, p.schemaname, p.tablename,
        case when q is not null then 'using (' || q || ')' else '' end,
        case when c is not null then 'with check (' || c || ')' else '' end);
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public'
             and (coalesce(qual, '') like '%has_role%' or coalesce(with_check, '') like '%has_role%')) then
    raise exception 'A policy still calls has_role per row';
  end if;
end $$;

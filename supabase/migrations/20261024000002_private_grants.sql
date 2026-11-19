-- Hardening: functions in the private schema were executable by PUBLIC (Postgres's
-- default). anon has no USAGE on the schema, so nothing was reachable, but the grant
-- shouldn't depend on that. Revoke it, and grant back only what signed-in users call
-- directly (RLS policies and security-invoker report functions). Security definer
-- functions call the rest as their owner; trigger functions need no EXECUTE grant.
revoke execute on all functions in schema private from public, anon;
alter default privileges in schema private revoke execute on functions from public;
grant execute on function private.my_business_ids(public.member_role[]) to authenticated;
grant execute on function private.fiscal_year_start(date, integer) to authenticated;

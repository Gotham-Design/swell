-- Security hardening before delivery.
--  1. Rate limits: a fixed-window counter for endpoints people could spam (sign-in emails,
--     invites, client uploads, AI calls, exports). Only the service role can call it; the
--     app reaches it through the `rate-limit` named server job (src/lib/security/rate-limit.ts).
--  2. Bulk transaction functions refuse before locking any row when one of the ids belongs to
--     a business the caller can't write (the per-row functions refused too, but only after the
--     loop had locked other businesses' rows).
--  3. No anon execute on any public function.

-- 1. Rate limits ------------------------------------------------------------------------
create table private.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key, window_start)
);
create index rate_limits_window_idx on private.rate_limits (window_start);
revoke all on private.rate_limits from public, anon, authenticated;

-- Count one hit; true while the caller is within p_max hits for the current window.
create function public.rate_limit_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_max < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limits as r (bucket, key, window_start, hits)
  values (left(p_bucket, 64), left(p_key, 256), v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  -- Old windows are useless; sweep them now and then instead of on every call.
  if random() < 0.01 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end $$;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;

-- 2. Bulk transaction functions: skip other businesses' rows up front ------------------
create or replace function public.categorize_transactions(p_transaction_ids uuid[], p_category_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Categorize at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  if exists (select 1 from public.transactions where id = any (p_transaction_ids)
             and business_id not in (select private.my_business_ids('{owner,editor}'))) then
    raise exception 'Only owners and editors can change these transactions' using errcode = '42501';
  end if;
  for t in
    select * from public.transactions
    where id = any (p_transaction_ids)
      and business_id in (select private.my_business_ids('{owner,editor}'))
    order by id for update
  loop
    if t.category_account_id is not distinct from p_category_account_id then
      continue;
    end if;
    perform public.update_transaction(t.id, t.date, t.money_account_id, t.amount_cents, t.description_raw,
      p_category_account_id, t.description_clean, t.vendor_normalized, t.memo, t.reference, t.dedupe_hash);
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

create or replace function public.restore_transactions(p_transaction_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Restore at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  if exists (select 1 from public.transactions where id = any (p_transaction_ids)
             and business_id not in (select private.my_business_ids('{owner,editor}'))) then
    raise exception 'Only owners and editors can change these transactions' using errcode = '42501';
  end if;
  for t in
    select * from public.transactions
    where id = any (p_transaction_ids)
      and business_id in (select private.my_business_ids('{owner,editor}'))
    order by id for update
  loop
    if t.deleted_at is not null then
      perform public.restore_transaction(t.id);
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end $$;

create or replace function public.soft_delete_transactions(p_transaction_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Delete at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  if exists (select 1 from public.transactions where id = any (p_transaction_ids)
             and business_id not in (select private.my_business_ids('{owner,editor}'))) then
    raise exception 'Only owners and editors can change these transactions' using errcode = '42501';
  end if;
  for t in
    select * from public.transactions
    where id = any (p_transaction_ids)
      and business_id in (select private.my_business_ids('{owner,editor}'))
    order by id for update
  loop
    if t.deleted_at is null then
      perform public.soft_delete_transaction(t.id);
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end $$;

-- 3. No anon execute on public functions ------------------------------------------------
-- depreciation_through is pure math, but it was the one function anon could still call
-- (through the PUBLIC default). Signed-in users and server jobs keep it.
revoke execute on function public.depreciation_through(text, bigint, bigint, integer, date, date, date) from public, anon;
grant execute on function public.depreciation_through(text, bigint, bigint, integer, date, date, date) to authenticated, service_role;
revoke execute on all functions in schema public from anon;
alter default privileges in schema public revoke execute on functions from anon;

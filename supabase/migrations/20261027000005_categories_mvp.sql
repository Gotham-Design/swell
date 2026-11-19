-- Categories screen (MVP). Plain SQL over transactions, run as the caller (RLS decides what
-- they see), keyed on business_id. Totals use P&L signs: income and expense both positive,
-- refunds reduce them; transfers are their size (abs). Integer cents only.
--
-- 1. category_period_stats   per category: count, total, "new" (first used in the period).
-- 2. category_monthly        one category's month totals for the detail panel's bars.
-- 3. category_top_vendors    one category's biggest vendors in a period.

-- Total for a category from the money account's view of each transaction.
create function private.category_total(p_type public.account_type, p_kind public.transaction_kind, p_sum bigint, p_abs bigint)
returns bigint
language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'transfer' then p_abs
    when p_type = 'income' then p_sum
    else -p_sum
  end
$$;
grant execute on function private.category_total(public.account_type, public.transaction_kind, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Per-category stats for a period. One row per category used in the period;
--    category_account_id is null for uncategorized rows (group 'uncategorized').
-- ---------------------------------------------------------------------------
create function public.category_period_stats(p_business_id uuid, p_from date, p_to date)
returns table (category_account_id uuid, grp text, tx_count bigint, total_cents bigint, is_new boolean)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select t.category_account_id as cat, t.kind, t.amount_cents, a.type, a.subtype, a.is_system
    from public.transactions t
    left join public.accounts a on a.business_id = t.business_id and a.id = t.category_account_id
    where t.business_id = p_business_id
      and t.deleted_at is null
      and t.date between p_from and p_to
  ),
  grouped as (
    select
      case when b.cat is null or b.subtype = 'uncategorized' then null else b.cat end as cat,
      case
        when b.cat is null or b.subtype = 'uncategorized' then 'uncategorized'
        when bool_or(b.kind = 'transfer') then 'transfer'
        else min(b.type::text)
      end as grp,
      count(*)::bigint as n,
      sum(private.category_total(b.type, b.kind, b.amount_cents, abs(b.amount_cents)))::bigint as total
    from base b
    group by 1, (b.cat is null or b.subtype = 'uncategorized')
  )
  select g.cat, g.grp, g.n,
    case when g.grp = 'uncategorized' then abs(g.total) else g.total end,
    g.cat is not null and not exists (
      select 1 from public.transactions p
      where p.business_id = p_business_id and p.category_account_id = g.cat
        and p.deleted_at is null and p.date < p_from)
  from grouped g
  order by g.grp, g.total desc
$$;

-- ---------------------------------------------------------------------------
-- 2. One category's month totals, oldest first, every month present.
-- ---------------------------------------------------------------------------
create function public.category_monthly(p_business_id uuid, p_account_id uuid, p_months int, p_through date default current_date)
returns table (month date, tx_count bigint, total_cents bigint)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select generate_series(
      (date_trunc('month', p_through) - make_interval(months => greatest(least(p_months, 36), 1) - 1))::date,
      date_trunc('month', p_through)::date, interval '1 month')::date as m
  ),
  acct as (select type from public.accounts where business_id = p_business_id and id = p_account_id),
  tx as (
    select date_trunc('month', t.date)::date as m, t.kind, t.amount_cents
    from public.transactions t
    where t.business_id = p_business_id and t.category_account_id = p_account_id
      and t.deleted_at is null
      and t.date >= (select min(m) from months)
      and t.date < ((select max(m) from months) + interval '1 month')::date
  )
  select m.m, count(tx.m)::bigint,
    coalesce(sum(private.category_total((select type from acct), tx.kind, tx.amount_cents, abs(tx.amount_cents))), 0)::bigint
  from months m left join tx on tx.m = m.m
  group by m.m order by m.m
$$;

-- ---------------------------------------------------------------------------
-- 3. Top vendors in one category for a period (vendor, else the cleaned description).
-- ---------------------------------------------------------------------------
create function public.category_top_vendors(p_business_id uuid, p_account_id uuid, p_from date, p_to date, p_limit int default 3)
returns table (vendor text, tx_count bigint, total_cents bigint)
language sql stable security invoker set search_path = '' as $$
  with acct as (select type from public.accounts where business_id = p_business_id and id = p_account_id)
  select coalesce(nullif(t.vendor_normalized, ''), t.description_clean, t.description_raw) as vendor,
    count(*)::bigint,
    sum(private.category_total((select type from acct), t.kind, t.amount_cents, abs(t.amount_cents)))::bigint as total
  from public.transactions t
  where t.business_id = p_business_id and t.category_account_id = p_account_id
    and t.deleted_at is null and t.date between p_from and p_to
  group by 1
  order by total desc, vendor
  limit greatest(least(p_limit, 10), 1)
$$;

revoke all on function public.category_period_stats(uuid, date, date),
  public.category_monthly(uuid, uuid, int, date),
  public.category_top_vendors(uuid, uuid, date, date, int) from public, anon;
grant execute on function public.category_period_stats(uuid, date, date),
  public.category_monthly(uuid, uuid, int, date),
  public.category_top_vendors(uuid, uuid, date, date, int) to authenticated;
revoke all on function private.category_total(public.account_type, public.transaction_kind, bigint, bigint) from public;
grant execute on function private.category_total(public.account_type, public.transaction_kind, bigint, bigint) to authenticated;

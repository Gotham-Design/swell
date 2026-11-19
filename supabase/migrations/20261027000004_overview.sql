-- Overview, money accounts and import screens (MVP). All plain SQL over the ledger, run as
-- the caller (RLS decides what they see), keyed on business_id so the indexes work. Money
-- stays in integer cents; nothing here is summed in JS.
--
-- 1. money_account_last_import   last committed import per money account (freshness).
-- 2. monthly_income_expense      income and expense per month for the overview chart.
-- 3. money_movement              money in / out with the top 2 sources each and the rest.
-- 4. overview_notes              up to 4 deterministic notes for the rotating strip.
-- 5. money_account_month_end     month-end balances for an account card's bars.
-- 6. New businesses start with AI category suggestions on.

-- ---------------------------------------------------------------------------
-- 1. Last import per money account
-- ---------------------------------------------------------------------------
create view public.money_account_last_import with (security_invoker = true) as
select b.business_id, b.money_account_id,
  max(b.committed_at) as last_committed_at,
  max(b.date_to) as last_statement_date
from public.import_batches b
where b.status = 'committed' and b.undone_at is null
group by b.business_id, b.money_account_id;

revoke all on public.money_account_last_import from anon;
grant select on public.money_account_last_import to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Income and expense per month (P&L signs: both positive; refunds reduce them)
-- ---------------------------------------------------------------------------
create function public.monthly_income_expense(p_business_id uuid, p_months int, p_through date default current_date)
returns table (month date, income_cents bigint, expense_cents bigint)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select generate_series(
      (date_trunc('month', p_through) - make_interval(months => greatest(least(p_months, 36), 1) - 1))::date,
      date_trunc('month', p_through)::date, interval '1 month')::date as m
  ),
  lines as (
    select date_trunc('month', t.date)::date as m, a.type, jl.amount_cents
    from public.transactions t
    join public.journal_lines jl on jl.business_id = t.business_id and jl.transaction_id = t.id
    join public.accounts a on a.business_id = jl.business_id and a.id = jl.account_id
    where t.business_id = p_business_id
      and t.deleted_at is null
      and t.date >= (select min(m) from months)
      and t.date < ((select max(m) from months) + interval '1 month')::date
      and a.type in ('income', 'expense')
  )
  select m.m,
    coalesce(-sum(l.amount_cents) filter (where l.type = 'income'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.type = 'expense'), 0)::bigint
  from months m
  left join lines l on l.m = m.m
  group by m.m
  order by m.m
$$;

-- ---------------------------------------------------------------------------
-- 3. Money movement: in and out, top 2 groups each, then everything else.
--    Groups are vendors (falling back to the category name). Transfers are excluded.
-- ---------------------------------------------------------------------------
create function public.money_movement(p_business_id uuid, p_from date, p_to date)
returns table (direction text, rank int, label text, amount_cents bigint, total_cents bigint, is_vendor boolean)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select case when t.amount_cents > 0 then 'in' else 'out' end as dir,
      coalesce(nullif(t.vendor_normalized, ''), a.name, 'Uncategorized') as grp,
      nullif(t.vendor_normalized, '') is not null as is_vendor,
      abs(t.amount_cents) as amt
    from public.transactions t
    left join public.accounts a on a.business_id = t.business_id and a.id = t.category_account_id
    where t.business_id = p_business_id
      and t.deleted_at is null
      and t.date between p_from and p_to
      and t.kind <> 'transfer'
      and t.amount_cents <> 0
  ),
  grouped as (
    select dir, grp, bool_or(is_vendor) as is_vendor, sum(amt)::bigint as amt,
      row_number() over (partition by dir order by sum(amt) desc, grp) as rn
    from base group by dir, grp
  ),
  totals as (select dir, sum(amt)::bigint as total from base group by dir)
  select g.dir, g.rn::int, g.grp, g.amt, t.total, g.is_vendor
  from grouped g join totals t using (dir)
  where g.rn <= 2
  union all
  select g.dir, 3, 'Everything else', sum(g.amt)::bigint, max(t.total), false
  from grouped g join totals t using (dir)
  where g.rn > 2
  group by g.dir
  order by 1, 2
$$;

-- ---------------------------------------------------------------------------
-- 4. Overview notes: up to 4, each a fact plus a detail, in this order:
--    category_change (>= 10% and >= $100 vs the previous period), new_category,
--    largest_payment, to_review. None qualify -> no rows.
-- ---------------------------------------------------------------------------
create function private.money_text(p_cents bigint)
returns text
language sql immutable set search_path = '' as $$
  select case when p_cents < 0 then '-' else '' end || '$' || to_char(abs(p_cents)::numeric / 100, 'FM999,999,999,990.00')
$$;
grant execute on function private.money_text(bigint) to authenticated;

create function public.overview_notes(p_business_id uuid, p_from date, p_to date)
returns table (kind text, headline text, detail text, link_params jsonb)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_whole_months boolean := extract(day from p_from) = 1 and extract(day from p_to + 1) = 1;
  v_months int;
  v_prev_from date;
  v_prev_to date := p_from - 1;
  v_prev_label text;
  v_cats jsonb;
  r record;
begin
  if v_whole_months then
    v_months := (extract(year from p_to + 1) * 12 + extract(month from p_to + 1))
              - (extract(year from p_from) * 12 + extract(month from p_from));
    v_prev_from := (p_from - make_interval(months => v_months))::date;
    v_prev_label := case when v_months = 1 then trim(to_char(v_prev_from, 'FMMonth')) else 'the period before' end;
  else
    v_prev_from := p_from - (p_to - p_from + 1);
    v_prev_label := 'the period before';
  end if;

  -- Category totals for both periods, signed as the P&L reads them.
  v_cats := coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'cur', x.cur, 'prev', x.prev, 'n_cur', x.n_cur))
    from (
      select a.id, a.name,
        coalesce((case when a.type = 'income' then -1 else 1 end) * sum(jl.amount_cents) filter (where t.date between p_from and p_to), 0)::bigint as cur,
        coalesce((case when a.type = 'income' then -1 else 1 end) * sum(jl.amount_cents) filter (where t.date between v_prev_from and v_prev_to), 0)::bigint as prev,
        (count(*) filter (where t.date between p_from and p_to))::int as n_cur
      from public.transactions t
      join public.journal_lines jl on jl.business_id = t.business_id and jl.transaction_id = t.id
      join public.accounts a on a.business_id = jl.business_id and a.id = jl.account_id
      where t.business_id = p_business_id and t.deleted_at is null
        and t.date between v_prev_from and p_to
        and a.type in ('income', 'expense') and not a.is_system
      group by a.id, a.name, a.type
    ) x), '[]');

  -- Biggest category change.
  select c.* into r from jsonb_to_recordset(v_cats) as c(id uuid, name text, cur bigint, prev bigint, n_cur int)
  where c.prev > 0 and abs(c.cur - c.prev) >= 10000 and abs(c.cur - c.prev) * 10 >= c.prev
  order by abs(c.cur - c.prev) desc, c.name limit 1;
  if found then
    kind := 'category_change';
    headline := r.name || ' is ' || case when r.cur > r.prev then 'up ' else 'down ' end
      || round(abs(r.cur - r.prev) * 100.0 / r.prev)::int || '% from ' || v_prev_label;
    detail := case when v_whole_months and v_months = 1
      then private.money_text(r.cur) || ' this month vs. ' || private.money_text(r.prev) || ' last month'
      else private.money_text(r.cur) || ' this period vs. ' || private.money_text(r.prev) || ' the period before' end;
    link_params := jsonb_build_object('cat', r.id);
    return next;
  end if;

  -- A category used for the first time.
  select c.* into r from jsonb_to_recordset(v_cats) as c(id uuid, name text, cur bigint, prev bigint, n_cur int)
  where c.n_cur > 0 and c.cur <> 0
    and not exists (
      select 1 from public.transactions t
      join public.journal_lines jl on jl.business_id = t.business_id and jl.transaction_id = t.id
      where t.business_id = p_business_id and t.deleted_at is null and t.date < p_from and jl.account_id = c.id)
  order by abs(c.cur) desc, c.name limit 1;
  if found then
    kind := 'new_category';
    headline := 'First time using ' || r.name;
    detail := private.money_text(abs(r.cur)) || ' across ' || r.n_cur || ' transaction' || case when r.n_cur = 1 then '' else 's' end;
    link_params := jsonb_build_object('cat', r.id);
    return next;
  end if;

  -- Largest single payment.
  select t.id, t.amount_cents, coalesce(t.vendor_normalized, t.description_clean, t.description_raw) as who, t.date into r
  from public.transactions t
  where t.business_id = p_business_id and t.deleted_at is null and t.date between p_from and p_to
    and t.amount_cents < 0 and t.kind <> 'transfer'
  order by t.amount_cents, t.date desc, t.id limit 1;
  if found then
    kind := 'largest_payment';
    headline := 'Largest payment: ' || private.money_text(-r.amount_cents) || ' to ' || initcap(r.who);
    detail := 'On ' || trim(to_char(r.date, 'FMMon FMDD'));
    link_params := jsonb_build_object('q', r.who);
    return next;
  end if;

  -- Transactions waiting for a category (any date, live).
  select count(*)::int as n, coalesce(sum(abs(t.amount_cents)), 0)::bigint as total into r
  from public.transactions t
  where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null;
  if r.n > 0 then
    kind := 'to_review';
    headline := r.n || ' transaction' || case when r.n = 1 then '' else 's' end || ' to review';
    detail := private.money_text(r.total) || ' waiting for a category';
    link_params := jsonb_build_object('type', 'uncategorized');
    return next;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Month-end balances for one money account (as people read them: cards as owed)
-- ---------------------------------------------------------------------------
create function public.money_account_month_end(p_business_id uuid, p_account_id uuid, p_months int, p_through date default current_date)
returns table (month_end date, balance_cents bigint)
language sql stable security invoker set search_path = '' as $$
  with acct as (
    select a.id, a.type from public.accounts a
    where a.business_id = p_business_id and a.id = p_account_id and a.is_money_account
  ),
  months as (
    select (generate_series(
      (date_trunc('month', p_through) - make_interval(months => greatest(least(p_months, 36), 1) - 1))::date,
      date_trunc('month', p_through)::date, interval '1 month') + interval '1 month - 1 day')::date as e
  )
  select m.e,
    ((case when (select type from acct) = 'liability' then -1 else 1 end) * coalesce((
      select sum(jl.amount_cents)
      from public.journal_lines jl
      join public.transactions t on t.business_id = jl.business_id and t.id = jl.transaction_id
      where jl.business_id = p_business_id and jl.account_id = (select id from acct)
        and t.deleted_at is null and t.date <= m.e), 0))::bigint
  from months m
  where exists (select 1 from acct)
  order by m.e
$$;

revoke all on function
  public.monthly_income_expense(uuid, int, date), public.money_movement(uuid, date, date),
  public.overview_notes(uuid, date, date), public.money_account_month_end(uuid, uuid, int, date)
  from public, anon;
grant execute on function
  public.monthly_income_expense(uuid, int, date), public.money_movement(uuid, date, date),
  public.overview_notes(uuid, date, date), public.money_account_month_end(uuid, uuid, int, date)
  to authenticated;
revoke execute on function private.money_text(bigint) from public, anon;

-- ---------------------------------------------------------------------------
-- 6. AI category suggestions are on for new businesses
-- ---------------------------------------------------------------------------
alter table public.businesses alter column ai_enabled set default true;

-- Reports (SPEC Prompt 8): Profit & Loss over a date range and Balance Sheet as of a date,
-- both computed here from journal lines (cash basis), never aggregated in JS. Each returns
-- display rows in order: accounts with their own and subtree amounts, then the totals.
-- Both run as the caller, so RLS decides what they can see.

-- First day of the fiscal year containing p_date.
create function private.fiscal_year_start(p_date date, p_start_month int)
returns date
language sql immutable set search_path = '' as $$
  select make_date(
    extract(year from p_date)::int - case when extract(month from p_date)::int < p_start_month then 1 else 0 end,
    p_start_month, 1)
$$;
grant execute on function private.fiscal_year_start(date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Profit & Loss
--
-- Amounts are signed the way people read them: income positive (credits), expenses
-- positive (debits); refunds (contra income) come out negative. Only income and expense
-- accounts take part, so transfers, owner draws and contributions never appear.
-- Rows (line_type):
--   account  one per income/expense account with activity in either period, or with a
--            descendant that has some. own_* = lines on that account; total_* = its subtree.
--   total    income_total, expense_total, net_income.
-- ---------------------------------------------------------------------------
create function public.report_pnl(
  p_business_id uuid,
  p_from date,
  p_to date,
  p_cmp_from date default null,
  p_cmp_to date default null
) returns table (
  sort_order int,
  line_type text,
  section text,            -- income | expense | null for net_income
  key text,                -- account id, or the total's name
  account_id uuid,
  parent_id uuid,
  depth int,
  name text,
  is_uncategorized boolean,
  has_children boolean,
  subtree_ids uuid[],      -- for drilling into the transaction list
  own_cents bigint,
  total_cents bigint,
  cmp_own_cents bigint,
  cmp_total_cents bigint
)
language sql stable security invoker set search_path = '' as $$
  with recursive
  acct as (
    select a.id, a.parent_id, a.name, a.type, a.subtype
    from public.accounts a
    where a.business_id = p_business_id and a.type in ('income', 'expense')
  ),
  -- Root-to-account path, for subtree sums and ordering.
  tree as (
    select a.id, array[a.id] as ids, array[lower(a.name) || ' ' || a.id::text] as names, 0 as depth
    from acct a
    where a.parent_id is null or a.parent_id not in (select id from acct)
    union all
    select c.id, t.ids || c.id, t.names || (lower(c.name) || ' ' || c.id::text), t.depth + 1
    from acct c join tree t on c.parent_id = t.id
  ),
  sums as (
    select jl.account_id,
      coalesce(sum(jl.amount_cents) filter (where t.date between p_from and p_to), 0) as cur,
      coalesce(sum(jl.amount_cents) filter (where t.date between p_cmp_from and p_cmp_to), 0) as cmp,
      count(*) as n
    from public.transactions t
    join public.journal_lines jl on jl.business_id = t.business_id and jl.transaction_id = t.id
    where t.business_id = p_business_id
      and t.deleted_at is null
      and (t.date between p_from and p_to or t.date between p_cmp_from and p_cmp_to)
      and jl.account_id in (select id from acct)
    group by jl.account_id
  ),
  own as (
    select a.id, a.parent_id, a.name, a.type, a.subtype, tr.ids, tr.names, tr.depth,
      (case when a.type = 'income' then -1 else 1 end) * coalesce(s.cur, 0) as cur,
      (case when a.type = 'income' then -1 else 1 end) * coalesce(s.cmp, 0) as cmp,
      coalesce(s.n, 0) as n
    from acct a join tree tr on tr.id = a.id
    left join sums s on s.account_id = a.id
  ),
  rolled as (
    select o.*,
      (select sum(d.cur) from own d where o.id = any (d.ids))::bigint as total_cur,
      (select sum(d.cmp) from own d where o.id = any (d.ids))::bigint as total_cmp,
      (select sum(d.n) from own d where o.id = any (d.ids)) as total_n,
      (select array_agg(d.id) from own d where o.id = any (d.ids)) as sub_ids
    from own o
  ),
  shown as (
    select r.*,
      r.subtype = 'uncategorized' as is_uncat,
      -- Children that will be shown (an account with activity only on itself is a leaf).
      exists (select 1 from rolled k where k.parent_id = r.id and k.total_n > 0) as shown_kids
    from rolled r
    where r.total_n > 0
  ),
  totals as (
    select
      coalesce(sum(cur) filter (where type = 'income'), 0)::bigint as inc,
      coalesce(sum(cmp) filter (where type = 'income'), 0)::bigint as inc_cmp,
      coalesce(sum(cur) filter (where type = 'expense'), 0)::bigint as exp,
      coalesce(sum(cmp) filter (where type = 'expense'), 0)::bigint as exp_cmp
    from own
  ),
  has_cmp as (select p_cmp_from is not null and p_cmp_to is not null as yes)
  select
    (row_number() over (order by x.sec, x.pos, x.names))::int,
    x.line_type, x.section, x.key, x.account_id, x.parent_id, x.depth, x.name, x.is_uncategorized,
    x.has_children, x.subtree_ids, x.own_cents, x.total_cents,
    case when (select yes from has_cmp) then x.cmp_own_cents end,
    case when (select yes from has_cmp) then x.cmp_total_cents end
  from (
    select
      -- Uncategorized goes last among the expenses, on its own line.
      case s.type when 'income' then 1 else 2 end as sec, case when s.is_uncat then 1 else 0 end as pos, s.names,
      'account' as line_type, s.type::text as section, s.id::text as key, s.id as account_id,
      s.parent_id, s.depth, s.name, s.is_uncat as is_uncategorized, s.shown_kids as has_children,
      s.sub_ids as subtree_ids, s.cur::bigint as own_cents, s.total_cur as total_cents,
      s.cmp::bigint as cmp_own_cents, s.total_cmp as cmp_total_cents
    from shown s
    union all
    select 1, 9, array[''], 'total', 'income', 'income_total', null, null, 0, 'Gross income', false, false,
      null, t.inc, t.inc, t.inc_cmp, t.inc_cmp from totals t
    union all
    select 2, 9, array[''], 'total', 'expense', 'expense_total', null, null, 0, 'Total expenses', false, false,
      null, t.exp, t.exp, t.exp_cmp, t.exp_cmp from totals t
    union all
    select 3, 9, array[''], 'total', null, 'net_income', null, null, 0, 'Net income', false, false,
      null, t.inc - t.exp, t.inc - t.exp, t.inc_cmp - t.exp_cmp, t.inc_cmp - t.exp_cmp from totals t
  ) x
  where exists (select 1 from public.businesses b where b.id = p_business_id)
  order by 1
$$;

-- ---------------------------------------------------------------------------
-- Balance Sheet
--
-- Balances of asset, liability and equity accounts at the end of p_as_of, signed the
-- way people read them (assets debit-positive; liabilities and equity credit-positive).
-- Profit has no account of its own until it's closed, so equity gets two calculated lines:
--   Retained Earnings     the Retained Earnings account plus net income of every fiscal
--                         year before the one containing the as-of date;
--   Current Year Earnings net income from that fiscal year's start to the as-of date.
-- Rows (line_type):
--   account  asset/liability/equity accounts with activity up to either date (or with a
--            descendant that has some), plus Retained Earnings and Current Year Earnings
--            (account_id null for the latter) always.
--   total    total_assets, total_liabilities, total_equity, total_liabilities_equity,
--            difference (assets - liabilities - equity; zero when the books balance).
-- ---------------------------------------------------------------------------
create function public.report_balance_sheet(
  p_business_id uuid,
  p_as_of date,
  p_cmp_as_of date default null
) returns table (
  sort_order int,
  line_type text,
  section text,            -- asset | liability | equity | null for the cross-section totals
  key text,
  account_id uuid,
  parent_id uuid,
  depth int,
  name text,
  subtype text,
  is_money_account boolean,
  has_children boolean,
  subtree_ids uuid[],
  own_cents bigint,
  total_cents bigint,
  cmp_own_cents bigint,
  cmp_total_cents bigint
)
language sql stable security invoker set search_path = '' as $$
  with recursive
  biz as (
    select b.fiscal_year_start_month as m from public.businesses b where b.id = p_business_id
  ),
  -- Column 1 = as of, column 2 = comparison (if any).
  cols as (
    select 1 as col, p_as_of as as_of, private.fiscal_year_start(p_as_of, (select m from biz)) as fy
    union all
    select 2, p_cmp_as_of, private.fiscal_year_start(p_cmp_as_of, (select m from biz)) where p_cmp_as_of is not null
  ),
  acct as (
    select a.id, a.parent_id, a.name, a.type, a.subtype, a.is_money_account
    from public.accounts a
    where a.business_id = p_business_id
  ),
  lines as (
    select jl.account_id, jl.amount_cents, t.date
    from public.transactions t
    join public.journal_lines jl on jl.business_id = t.business_id and jl.transaction_id = t.id
    where t.business_id = p_business_id
      and t.deleted_at is null
      and t.date <= greatest(p_as_of, coalesce(p_cmp_as_of, p_as_of))
  ),
  -- Debit-positive balance per account per column, and income/expense split by fiscal year.
  bal as (
    select l.account_id, c.col, sum(l.amount_cents)::bigint as debit, count(*) as n
    from lines l join cols c on l.date <= c.as_of
    group by l.account_id, c.col
  ),
  earnings as (
    select c.col,
      -- Net income is the credit balance of income and expense accounts: -(debits).
      -coalesce(sum(b.amount_cents) filter (where b.date < c.fy), 0)::bigint as prior,
      -coalesce(sum(b.amount_cents) filter (where b.date >= c.fy and b.date <= c.as_of), 0)::bigint as current
    from cols c
    left join (
      select l.* from lines l join acct a on a.id = l.account_id and a.type in ('income', 'expense')
    ) b on b.date <= c.as_of
    group by c.col
  ),
  bs as (select * from acct where type in ('asset', 'liability', 'equity')),
  tree as (
    select a.id, array[a.id] as ids, array[lower(a.name) || ' ' || a.id::text] as names, 0 as depth
    from bs a
    where a.parent_id is null or a.parent_id not in (select id from bs)
    union all
    select c.id, t.ids || c.id, t.names || (lower(c.name) || ' ' || c.id::text), t.depth + 1
    from bs c join tree t on c.parent_id = t.id
  ),
  own as (
    select a.id, a.parent_id, a.name, a.type, a.subtype, a.is_money_account, tr.ids, tr.names, tr.depth,
      (case when a.type = 'asset' then 1 else -1 end) * coalesce(b1.debit, 0)
        + case when a.subtype = 'retained_earnings' then (select prior from earnings where col = 1) else 0 end as cur,
      (case when a.type = 'asset' then 1 else -1 end) * coalesce(b2.debit, 0)
        + case when a.subtype = 'retained_earnings' then coalesce((select prior from earnings where col = 2), 0) else 0 end as cmp,
      coalesce(b1.n, 0) + coalesce(b2.n, 0)
        + case when a.subtype = 'retained_earnings' then 1 else 0 end as n
    from bs a join tree tr on tr.id = a.id
    left join bal b1 on b1.account_id = a.id and b1.col = 1
    left join bal b2 on b2.account_id = a.id and b2.col = 2
  ),
  rolled as (
    select o.*,
      (select sum(d.cur) from own d where o.id = any (d.ids))::bigint as total_cur,
      (select sum(d.cmp) from own d where o.id = any (d.ids))::bigint as total_cmp,
      (select sum(d.n) from own d where o.id = any (d.ids)) as total_n,
      (select array_agg(d.id) from own d where o.id = any (d.ids)) as sub_ids
    from own o
  ),
  shown as (
    select r.*, exists (select 1 from rolled k where k.parent_id = r.id and k.total_n > 0) as shown_kids
    from rolled r
    where r.total_n > 0
  ),
  cye as (
    select
      (select current from earnings where col = 1) as cur,
      (select current from earnings where col = 2) as cmp
  ),
  sec as (
    select
      coalesce(sum(cur) filter (where type = 'asset'), 0)::bigint as a,
      coalesce(sum(cmp) filter (where type = 'asset'), 0)::bigint as a2,
      coalesce(sum(cur) filter (where type = 'liability'), 0)::bigint as l,
      coalesce(sum(cmp) filter (where type = 'liability'), 0)::bigint as l2,
      coalesce(sum(cur) filter (where type = 'equity'), 0)::bigint + (select cur from cye) as e,
      coalesce(sum(cmp) filter (where type = 'equity'), 0)::bigint + coalesce((select cmp from cye), 0) as e2
    from own
  ),
  has_cmp as (select p_cmp_as_of is not null as yes)
  select
    (row_number() over (order by x.sec, x.pos, x.names))::int,
    x.line_type, x.section, x.key, x.account_id, x.parent_id, x.depth, x.name, x.subtype, x.is_money_account,
    x.has_children, x.subtree_ids, x.own_cents, x.total_cents,
    case when (select yes from has_cmp) then x.cmp_own_cents end,
    case when (select yes from has_cmp) then x.cmp_total_cents end
  from (
    select
      case s.type when 'asset' then 1 when 'liability' then 2 else 3 end as sec,
      -- Equity: contributions, draws and other accounts first, then the earnings lines.
      case when s.subtype = 'retained_earnings' then 1 else 0 end as pos, s.names,
      'account' as line_type, s.type::text as section, s.id::text as key, s.id as account_id, s.parent_id,
      s.depth, s.name, s.subtype, s.is_money_account, s.shown_kids as has_children, s.sub_ids as subtree_ids,
      s.cur::bigint as own_cents, s.total_cur as total_cents, s.cmp::bigint as cmp_own_cents, s.total_cmp as cmp_total_cents
    from shown s
    union all
    select 3, 2, array[''], 'account', 'equity', 'current_year_earnings', null, null, 0, 'Current Year Earnings',
      'current_year_earnings', false, false, null, c.cur, c.cur, c.cmp, c.cmp from cye c
    union all
    select 1, 9, array[''], 'total', 'asset', 'total_assets', null, null, 0, 'Total assets', null, false, false, null,
      s.a, s.a, s.a2, s.a2 from sec s
    union all
    select 2, 9, array[''], 'total', 'liability', 'total_liabilities', null, null, 0, 'Total liabilities', null, false, false, null,
      s.l, s.l, s.l2, s.l2 from sec s
    union all
    select 3, 9, array[''], 'total', 'equity', 'total_equity', null, null, 0, 'Total equity', null, false, false, null,
      s.e, s.e, s.e2, s.e2 from sec s
    union all
    select 4, 0, array[''], 'total', null, 'total_liabilities_equity', null, null, 0, 'Total liabilities and equity', null, false, false, null,
      s.l + s.e, s.l + s.e, s.l2 + s.e2, s.l2 + s.e2 from sec s
    union all
    select 4, 1, array[''], 'total', null, 'difference', null, null, 0, 'Difference', null, false, false, null,
      s.a - s.l - s.e, s.a - s.l - s.e, s.a2 - s.l2 - s.e2, s.a2 - s.l2 - s.e2 from sec s
  ) x
  where exists (select 1 from biz)
  order by 1
$$;

revoke all on function public.report_pnl(uuid, date, date, date, date) from public, anon;
revoke all on function public.report_balance_sheet(uuid, date, date) from public, anon;
grant execute on function public.report_pnl(uuid, date, date, date, date) to authenticated;
grant execute on function public.report_balance_sheet(uuid, date, date) to authenticated;

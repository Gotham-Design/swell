-- Reports: exact P&L and balance sheet figures for a fixture business with a July fiscal
-- year, net income ties to the change in earnings, the balance sheet balances on random
-- dates, and transfers / owner equity never reach the P&L.
begin;
\ir _setup.psql
select no_plan();

-- One P&L or balance-sheet figure by row key (an account id or a total's name).
create function tests.pnl(p_from date, p_to date, k text, cmp_from date default null, cmp_to date default null,
  col text default 'total') returns bigint language sql stable as $$
  select case col when 'total' then total_cents when 'own' then own_cents
                  when 'cmp' then cmp_total_cents end
  from public.report_pnl(tests.id('F'), p_from, p_to, cmp_from, cmp_to)
  where key = coalesce(tests.id(k)::text, k)
$$;
create function tests.bs(p_as_of date, k text, cmp date default null, col text default 'total')
returns bigint language sql stable as $$
  select case col when 'total' then total_cents when 'own' then own_cents when 'cmp' then cmp_total_cents end
  from public.report_balance_sheet(tests.id('F'), p_as_of, cmp)
  where key = coalesce(tests.id(k)::text, k)
$$;
-- (tests.id() of a total's name is null, so those keys pass through.)
create function tests.earnings(d date) returns bigint language sql stable as $$
  select coalesce(tests.bs(d, 'f_re'), 0) + tests.bs(d, 'current_year_earnings')
$$;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Fixture: fiscal year starts in July. Opening balance $1,000 on 2024-07-01.
-- ---------------------------------------------------------------------------
select tests.login('alice');
select tests.put('F', public.create_business('Fixture Co', null, 'USD', 7::smallint, '2024-07-01')::text);
select tests.put('f_chk',  tests.add_money('F', 'Fixture Checking', 'checking', 100000, '2024-07-01')::text);
select tests.put('f_sav',  tests.add_money('F', 'Fixture Savings', 'savings')::text);
select tests.put('f_card', tests.add_money('F', 'Fixture Card', 'credit_card')::text);
select tests.put('f_sales',   tests.std('F', 'Sales')::text);
select tests.put('f_service', tests.std('F', 'Service Revenue')::text);
select tests.put('f_refunds', tests.std('F', 'Refunds & Returns')::text);
select tests.put('f_rent',    tests.std('F', 'Rent')::text);
select tests.put('f_meals',   tests.std('F', 'Meals')::text);
select tests.put('f_draws',   tests.std('F', 'Owner Draws')::text);
select tests.put('f_contrib', tests.std('F', 'Owner Contributions')::text);
select tests.put('f_obe',     tests.std('F', 'Opening Balance Equity')::text);
select tests.put('f_re', (select id from public.accounts where business_id = tests.id('F') and subtype = 'retained_earnings')::text);
select tests.put('f_uncat', (select id from public.accounts where business_id = tests.id('F') and subtype = 'uncategorized')::text);
select tests.put('f_tech', tests.add_account('F', 'Tech', 'expense')::text);
with i as (insert into public.accounts (business_id, name, type, parent_id)
  values (tests.id('F'), 'Hosting', 'expense', tests.id('f_tech')) returning id)
select tests.put('f_hosting', id::text) from i;

-- FY2025 (2024-07-01 .. 2025-06-30): net income 5,000 - 1,200 - 300 = 3,500.
select tests.post('F', '2024-08-15', 'f_chk', 500000, 'Big sale', 'f_sales');
select tests.post('F', '2024-09-01', 'f_chk', -120000, 'Rent', 'f_rent');
select tests.post('F', '2025-03-10', 'f_card', -30000, 'Client dinner', 'f_meals');
-- FY2026 (from 2025-07-01).
select tests.post('F', '2025-07-05', 'f_chk', 200000, 'Consulting', 'f_service');
select tests.post('F', '2025-07-20', 'f_chk', -15000, 'Refund', 'f_refunds');
select tests.post('F', '2025-08-01', 'f_chk', -50000, 'Owner draw', 'f_draws');
select tests.post('F', '2025-08-02', 'f_chk', 100000, 'Owner put money in', 'f_contrib');
select tests.post('F', '2025-08-10', 'f_chk', -20000, 'Card payment', 'f_card');
select tests.post('F', '2025-08-11', 'f_chk', -100000, 'To savings', 'f_sav');
select tests.post('F', '2025-09-01', 'f_card', -4000, 'Hosting', 'f_hosting');
select tests.post('F', '2025-09-02', 'f_card', -6000, 'Laptop stand', 'f_tech');
select tests.post('F', '2025-09-15', 'f_chk', -2500, 'Mystery charge');
select tests.put('deleted', tests.post('F', '2025-09-20', 'f_chk', -9999, 'Deleted rent', 'f_rent')::text);
select public.soft_delete_transaction(tests.id('deleted'));

-- ---------------------------------------------------------------------------
-- P&L, Q1 of FY2026 (Jul–Sep 2025), compared with the same period last year
-- ---------------------------------------------------------------------------
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_service'), 200000::bigint, 'P&L: service revenue');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_refunds'), -15000::bigint, 'P&L: refunds reduce income');
select is(tests.pnl('2025-07-01', '2025-09-30', 'income_total'), 185000::bigint, 'P&L: gross income');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_tech'), 10000::bigint, 'P&L: parent subtotal includes its child');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_tech', col => 'own'), 6000::bigint, 'P&L: parent own amount');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_hosting'), 4000::bigint, 'P&L: child amount');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_uncat'), 2500::bigint, 'P&L: uncategorized on its own line');
select is(tests.pnl('2025-07-01', '2025-09-30', 'expense_total'), 12500::bigint, 'P&L: total expenses (deleted rent excluded)');
select is(tests.pnl('2025-07-01', '2025-09-30', 'net_income'), 172500::bigint, 'P&L: net income');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_rent'), null, 'P&L: no line for an account with no activity');
select is(tests.pnl('2025-07-01', '2025-09-30', 'net_income', '2024-07-01', '2024-09-30', 'cmp'), 380000::bigint,
  'P&L: comparison column, same period last year');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_sales', '2024-07-01', '2024-09-30'), 0::bigint,
  'P&L: an account active only in the comparison period shows with zero');
select is(tests.pnl('2025-07-01', '2025-09-30', 'f_sales', '2024-07-01', '2024-09-30', 'cmp'), 500000::bigint,
  'P&L: ...and its comparison amount');
select is(tests.pnl('2025-07-01', '2025-09-30', 'net_income', col => 'cmp'), null, 'P&L: no comparison unless asked');
select is(
  (select array_agg(key order by sort_order) from public.report_pnl(tests.id('F'), '2025-07-01', '2025-09-30')),
  array[tests.id('f_refunds')::text, tests.id('f_service')::text, 'income_total',
        tests.id('f_tech')::text, tests.id('f_hosting')::text, tests.id('f_uncat')::text, 'expense_total', 'net_income'],
  'P&L: rows in order — income, expenses with children under parents, Uncategorized last, totals');
select is(
  (select array_length(subtree_ids, 1) from public.report_pnl(tests.id('F'), '2025-07-01', '2025-09-30') where account_id = tests.id('f_tech')),
  2, 'P&L: a parent drills into itself and its children');
select ok(
  (select has_children and depth = 0 from public.report_pnl(tests.id('F'), '2025-07-01', '2025-09-30') where account_id = tests.id('f_tech'))
  and (select not has_children and depth = 1 and parent_id = tests.id('f_tech') from public.report_pnl(tests.id('F'), '2025-07-01', '2025-09-30') where account_id = tests.id('f_hosting')),
  'P&L: parent/child structure');
select is(tests.pnl('2024-07-01', '2025-06-30', 'net_income'), 350000::bigint, 'P&L: FY2025 net income');

-- ---------------------------------------------------------------------------
-- Transfers and owner equity never appear on the P&L
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.report_pnl(tests.id('F'), '2024-01-01', '2026-12-31') p
   join public.accounts a on a.id = p.account_id where a.type not in ('income', 'expense')),
  0, 'P&L: only income and expense accounts, ever');
select is(
  (select count(*)::int from public.report_pnl(tests.id('F'), '2025-08-01', '2025-08-11') where line_type = 'account'),
  0, 'P&L: a period with only draws, contributions and transfers has no lines');
select is(tests.pnl('2025-08-01', '2025-08-11', 'net_income'), 0::bigint, '...and zero net income');

-- ---------------------------------------------------------------------------
-- Balance sheet as of 2025-09-30, compared with the end of FY2025
-- ---------------------------------------------------------------------------
select is(tests.bs('2025-09-30', 'f_chk'), 592500::bigint, 'BS: checking');
select is(tests.bs('2025-09-30', 'f_sav'), 100000::bigint, 'BS: savings');
select is(tests.bs('2025-09-30', 'f_card'), 20000::bigint, 'BS: card owed');
select is(tests.bs('2025-09-30', 'total_assets'), 692500::bigint, 'BS: total assets');
select is(tests.bs('2025-09-30', 'total_liabilities'), 20000::bigint, 'BS: total liabilities');
select is(tests.bs('2025-09-30', 'f_obe'), 100000::bigint, 'BS: opening balance equity');
select is(tests.bs('2025-09-30', 'f_contrib'), 100000::bigint, 'BS: contributions');
select is(tests.bs('2025-09-30', 'f_draws'), -50000::bigint, 'BS: draws reduce equity');
select is(tests.bs('2025-09-30', 'f_re'), 350000::bigint, 'BS: retained earnings = prior fiscal years');
select is(tests.bs('2025-09-30', 'current_year_earnings'), 172500::bigint, 'BS: current year earnings from Jul 1');
select is(tests.bs('2025-09-30', 'total_equity'), 672500::bigint, 'BS: total equity');
select is(tests.bs('2025-09-30', 'total_liabilities_equity'), 692500::bigint, 'BS: liabilities + equity');
select is(tests.bs('2025-09-30', 'difference'), 0::bigint, 'BS: balances');
select is(tests.bs('2025-09-30', 'f_re', '2025-06-30', 'cmp'), 0::bigint, 'BS comparison: no retained earnings in the first year');
select is(tests.bs('2025-09-30', 'current_year_earnings', '2025-06-30', 'cmp'), 350000::bigint, 'BS comparison: FY2025 earnings still current on Jun 30');
select is(tests.bs('2025-09-30', 'total_assets', '2025-06-30', 'cmp'), 480000::bigint, 'BS comparison: total assets');
select is(tests.bs('2025-09-30', 'difference', '2025-06-30', 'cmp'), 0::bigint, 'BS comparison: balances');
select is(tests.bs('2025-09-30', 'f_sav', '2025-06-30', 'cmp'), 0::bigint, 'BS comparison: an account opened later shows zero');
select is(tests.bs('2024-06-30', 'total_assets'), 0::bigint, 'BS: nothing before the books start');
select is(
  (select array_agg(key order by sort_order) filter (where section = 'equity') from public.report_balance_sheet(tests.id('F'), '2025-09-30')),
  (select array_agg(k) from unnest(array[tests.id('f_obe')::text, tests.id('f_contrib')::text, tests.id('f_draws')::text]) k)
    || array[tests.id('f_re')::text, 'current_year_earnings', 'total_equity'],
  'BS: equity accounts, then retained and current year earnings, then the total');

-- ---------------------------------------------------------------------------
-- Net income for a period = change in Retained Earnings + Current Year Earnings
-- ---------------------------------------------------------------------------
select is(tests.pnl(p.f, p.t, 'net_income'), tests.earnings(p.t) - tests.earnings(p.f - 1),
  format('net income %s..%s = change in RE + CYE', p.f, p.t))
from (values ('2025-07-01'::date, '2025-09-30'::date), ('2024-07-01', '2025-06-30'), ('2025-01-01', '2025-12-31'),
             ('2024-08-15', '2025-09-15'), ('2025-09-02', '2025-09-02')) p(f, t);

-- ---------------------------------------------------------------------------
-- The balance sheet balances on 10 random dates (and its comparison column too)
-- ---------------------------------------------------------------------------
select setseed(0.42);
select is(
  (select array_agg(d order by d) from (
     select d from (select ('2024-06-01'::date + (random() * 900)::int) as d from generate_series(1, 10)) r
     where tests.bs(d, 'difference') <> 0 or tests.bs(d, 'difference', d - 45, 'cmp') <> 0) bad),
  null, 'BS: assets = liabilities + equity on 10 random dates');

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select tests.login('bob');
select is((select count(*)::int from public.report_pnl(tests.id('F'), '2024-01-01', '2026-12-31')), 0, 'outsiders get no P&L');
select is((select count(*)::int from public.report_balance_sheet(tests.id('F'), '2026-12-31')), 0, 'outsiders get no balance sheet');
select tests.login_anon();
select throws_ok($$ select * from public.report_pnl(tests.id('F'), '2024-01-01', '2026-12-31') $$, '42501', null, 'anon cannot run reports');

select * from finish();
rollback;

-- account_balances could take 5–30s right after a large import. The planner estimates
-- one business's rows from table statistics that describe the other tenants: until the
-- next ANALYZE, a business that just imported 20k rows looks like it has a handful. It
-- then joined every journal line to every transaction with a filter
-- (400M comparisons for 20k rows) instead of looking each one up.
--
-- This shape doesn't depend on that estimate: each account sums its own lines through
-- (business_id, account_id), and soft-deleted transactions are excluded with an anti-join
-- against a small partial index of deleted ids. Same columns, same results.
create index transactions_deleted_ids_idx on public.transactions (id) where deleted_at is not null;

create or replace view public.account_balances with (security_invoker = true) as
select
  a.business_id,
  a.id as account_id,
  a.name,
  a.type,
  a.is_money_account,
  -- Debit-positive sum of live journal lines.
  coalesce(b.debit, 0)::bigint as balance_cents,
  -- Same, signed the way people read it: positive for a normal balance of that type
  -- (assets and expenses debit; liabilities, equity and income credit).
  ((case when a.type in ('asset', 'expense') then 1 else -1 end) * coalesce(b.debit, 0))::bigint as natural_balance_cents
from public.accounts a
left join lateral (
  select sum(jl.amount_cents) as debit
  from public.journal_lines jl
  where jl.business_id = a.business_id and jl.account_id = a.id
    and not exists (select 1 from public.transactions t where t.id = jl.transaction_id and t.deleted_at is not null)
) b on true;

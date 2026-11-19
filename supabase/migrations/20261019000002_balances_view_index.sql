-- account_balances scanned every journal line in the database before narrowing to one
-- business (and, as a signed-in user, ran the RLS check per scanned row). Joining lines
-- on business_id too lets a business filter use journal_lines_account_idx
-- (business_id, account_id), so cost follows one business's data, not everyone's.
create or replace view public.account_balances with (security_invoker = true) as
select
  a.business_id,
  a.id as account_id,
  a.name,
  a.type,
  a.is_money_account,
  -- Debit-positive sum of live journal lines.
  coalesce(sum(jl.amount_cents) filter (where t.deleted_at is null), 0)::bigint as balance_cents,
  -- Same, signed the way people read it: positive for a normal balance of that type
  -- (assets and expenses debit; liabilities, equity and income credit).
  (case when a.type in ('asset', 'expense') then 1 else -1 end
    * coalesce(sum(jl.amount_cents) filter (where t.deleted_at is null), 0))::bigint as natural_balance_cents
from public.accounts a
left join public.journal_lines jl on jl.business_id = a.business_id and jl.account_id = a.id
left join public.transactions t on t.business_id = jl.business_id and t.id = jl.transaction_id
group by a.business_id, a.id;

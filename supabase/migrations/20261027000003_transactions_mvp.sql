-- Transactions screen (MVP reskin).
--
-- 1. ai_suggestion_queue also carries the runner-up category and whether people have
--    filed this vendor before (the drawer's fixed reason line shows only then).
-- 2. search_transactions / summarize_transactions: a search that reads as an amount also
--    matches that amount (p_query_cents), and the summary counts money-in and money-out
--    rows separately ("14 deposits", "44 payments").

-- ---------------------------------------------------------------------------
-- 1. Suggestion queue: new columns go at the end (create or replace view)
-- ---------------------------------------------------------------------------
create or replace view public.ai_suggestion_queue with (security_invoker = true) as
select s.id, s.business_id, s.transaction_id, s.category_account_id, a.name as category_name, s.confidence, s.reason,
  s.flags, s.model, s.created_at, t.date, t.description_raw, t.description_clean, t.amount_cents, t.money_account_id,
  s.runner_up_category_account_id, ra.name as runner_up_name, s.runner_up_confidence, t.vendor_normalized,
  exists (select 1 from public.transaction_patterns p
          where p.business_id = s.business_id and p.kind = 'vendor'
            and p.vendor_normalized = t.vendor_normalized and p.typical_category_id is not null) as vendor_has_history
from public.ai_suggestions s
join public.transactions t on t.business_id = s.business_id and t.id = s.transaction_id
join public.accounts a on a.business_id = s.business_id and a.id = s.category_account_id
left join public.accounts ra on ra.business_id = s.business_id and ra.id = s.runner_up_category_account_id
  and ra.archived_at is null
join public.businesses b on b.id = s.business_id
where s.status = 'pending' and t.deleted_at is null and t.category_account_id is null
  and (b.lock_date is null or t.date > b.lock_date);

revoke all on public.ai_suggestion_queue from anon;

-- ---------------------------------------------------------------------------
-- 2. Search by amount, and in/out counts
-- ---------------------------------------------------------------------------
drop function public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[]);
drop function public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[]);

create function public.search_transactions(
  p_business_id uuid, p_from date default null, p_to date default null, p_types text[] default null,
  p_category_ids uuid[] default null, p_money_account_ids uuid[] default null, p_amount_min bigint default null,
  p_amount_max bigint default null, p_sources public.transaction_source[] default null, p_query text default null,
  p_import_batch_id uuid default null, p_deleted boolean default false, p_categorized_by text[] default null,
  -- The search text read as money (size, in cents): rows of that amount match too.
  p_query_cents bigint default null
) returns setof public.transactions
language sql stable set search_path = '' as $$
  select t.*
  from public.transactions t
  where t.business_id = p_business_id
    and (t.deleted_at is not null) = coalesce(p_deleted, false)
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and (p_types is null
         or (t.category_account_id is null and 'uncategorized' = any (p_types))
         or (t.category_account_id is not null and t.kind::text = any (p_types)))
    and (p_category_ids is null or t.category_account_id = any (p_category_ids))
    and (p_money_account_ids is null or t.money_account_id = any (p_money_account_ids))
    and (p_amount_min is null or abs(t.amount_cents) >= p_amount_min)
    and (p_amount_max is null or abs(t.amount_cents) <= p_amount_max)
    and (p_sources is null or t.source = any (p_sources))
    and (p_import_batch_id is null or t.import_batch_id = p_import_batch_id)
    and (p_categorized_by is null
         or (t.category_account_id is null and 'uncategorized' = any (p_categorized_by))
         or (t.category_source = 'rule' and 'rule' = any (p_categorized_by))
         or (t.category_source = 'ai' and 'ai' = any (p_categorized_by))
         or (t.category_source in ('user', 'import') and 'hand' = any (p_categorized_by)))
    and (nullif(btrim(p_query), '') is null
         or (p_query_cents is not null and abs(t.amount_cents) = abs(p_query_cents))
         or (
      with q as (
        select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
      )
      select t.description_raw ilike q.pattern
          or t.description_clean ilike q.pattern
          or t.vendor_normalized ilike q.pattern
          or t.memo ilike q.pattern
      from q))
$$;

create function public.summarize_transactions(
  p_business_id uuid, p_from date default null, p_to date default null, p_types text[] default null,
  p_category_ids uuid[] default null, p_money_account_ids uuid[] default null, p_amount_min bigint default null,
  p_amount_max bigint default null, p_sources public.transaction_source[] default null, p_query text default null,
  p_import_batch_id uuid default null, p_deleted boolean default false, p_categorized_by text[] default null,
  p_query_cents bigint default null
) returns table (count bigint, total_in bigint, total_out bigint, net bigint, count_in bigint, count_out bigint, uncategorized bigint)
language sql stable set search_path = '' as $$
  select count(*),
         coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint,
         coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)::bigint,
         coalesce(sum(amount_cents), 0)::bigint,
         count(*) filter (where amount_cents > 0),
         count(*) filter (where amount_cents < 0),
         count(*) filter (where category_account_id is null)
  from public.search_transactions(p_business_id, p_from, p_to, p_types, p_category_ids, p_money_account_ids,
                                  p_amount_min, p_amount_max, p_sources, p_query, p_import_batch_id, p_deleted,
                                  p_categorized_by, p_query_cents)
$$;

revoke all on function
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[], bigint),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[], bigint)
  from public, anon;
grant execute on function
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[], bigint),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean, text[], bigint)
  to authenticated;

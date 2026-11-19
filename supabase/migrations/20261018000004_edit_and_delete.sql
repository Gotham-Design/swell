-- Add, edit and delete (SPEC Prompt 5): a "Deleted" view in the list, bulk delete and
-- restore, and a readable audit trail per transaction.

-- ---------------------------------------------------------------------------
-- Search gains p_deleted: false = live rows (default), true = only soft-deleted rows.
-- Dropped and recreated: an extra defaulted parameter would make calls ambiguous.
-- ---------------------------------------------------------------------------
drop function public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid);
drop function public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid);

create function public.search_transactions(
  p_business_id uuid,
  p_from date default null,
  p_to date default null,
  p_types text[] default null,               -- income, expense, transfer, equity, uncategorized
  p_category_ids uuid[] default null,
  p_money_account_ids uuid[] default null,
  p_amount_min bigint default null,          -- cents, compared to abs(amount)
  p_amount_max bigint default null,
  p_sources public.transaction_source[] default null,
  p_query text default null,                 -- description (raw or clean), vendor, memo
  p_import_batch_id uuid default null,
  p_deleted boolean default false            -- true: only soft-deleted rows
) returns setof public.transactions
language sql stable security invoker set search_path = '' as $$
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
    and (nullif(btrim(p_query), '') is null or (
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
  p_business_id uuid,
  p_from date default null,
  p_to date default null,
  p_types text[] default null,
  p_category_ids uuid[] default null,
  p_money_account_ids uuid[] default null,
  p_amount_min bigint default null,
  p_amount_max bigint default null,
  p_sources public.transaction_source[] default null,
  p_query text default null,
  p_import_batch_id uuid default null,
  p_deleted boolean default false
) returns table (count bigint, total_in bigint, total_out bigint, net bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*),
         coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint,
         coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)::bigint,
         coalesce(sum(amount_cents), 0)::bigint
  from public.search_transactions(p_business_id, p_from, p_to, p_types, p_category_ids, p_money_account_ids,
                                  p_amount_min, p_amount_max, p_sources, p_query, p_import_batch_id, p_deleted)
$$;

-- ---------------------------------------------------------------------------
-- Bulk delete / restore: each row through the single-row function (role, lock date,
-- audit), all or nothing. Return how many rows changed.
-- ---------------------------------------------------------------------------
create function public.soft_delete_transactions(p_transaction_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Delete at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  for t in select * from public.transactions where id = any (p_transaction_ids) order by id for update loop
    if t.deleted_at is null then
      perform public.soft_delete_transaction(t.id);
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end $$;

create function public.restore_transactions(p_transaction_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Restore at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  for t in select * from public.transactions where id = any (p_transaction_ids) order by id for update loop
    if t.deleted_at is not null then
      perform public.restore_transaction(t.id);
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end $$;

-- ---------------------------------------------------------------------------
-- Audit order: created_at is now(), which is the same for every row written in one
-- database transaction (a bulk edit), so add a sequence that always increases.
-- ---------------------------------------------------------------------------
alter table public.audit_log add column seq bigint generated always as identity;
create index audit_log_entity_seq_idx on public.audit_log (business_id, entity, entity_id, seq desc);

-- ---------------------------------------------------------------------------
-- Audit trail for one transaction, newest first, with who did it (auth.users isn't
-- readable directly). Members only.
-- ---------------------------------------------------------------------------
create function public.transaction_history(p_transaction_id uuid)
returns table (at timestamptz, action text, actor_email text, before jsonb, after jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_business uuid;
begin
  select business_id into v_business from public.transactions where id = p_transaction_id;
  if v_business is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(v_business, '{owner,editor,viewer}');
  return query
    select l.created_at, l.action, u.email::text, l.before, l.after
    from public.audit_log l
    left join auth.users u on u.id = l.actor
    where l.business_id = v_business and l.entity = 'transactions' and l.entity_id = p_transaction_id
    order by l.seq desc;
end $$;

revoke all on function public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean) from public, anon;
revoke all on function public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean) from public, anon;
revoke all on function public.soft_delete_transactions(uuid[]) from public, anon;
revoke all on function public.restore_transactions(uuid[]) from public, anon;
revoke all on function public.transaction_history(uuid) from public, anon;
grant execute on function
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid, boolean),
  public.soft_delete_transactions(uuid[]),
  public.restore_transactions(uuid[]),
  public.transaction_history(uuid)
to authenticated;

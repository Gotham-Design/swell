-- Transaction list (SPEC Prompt 4): one filter function shared by the page, its summary
-- bar and "select all matching"; bulk categorize; category rules from "apply to similar".

-- Every filter the list supports. Runs as the caller (RLS applies). Soft-deleted rows are
-- excluded; amounts are compared by size, so "over $100" matches in and out.
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
  p_import_batch_id uuid default null
) returns setof public.transactions
language sql stable security invoker set search_path = '' as $$
  select t.*
  from public.transactions t
  where t.business_id = p_business_id
    and t.deleted_at is null
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
        -- Escape LIKE wildcards so "50%" means the text 50%.
        select '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
      )
      select t.description_raw ilike q.pattern
          or t.description_clean ilike q.pattern
          or t.vendor_normalized ilike q.pattern
          or t.memo ilike q.pattern
      from q))
$$;

-- Count and totals for the same filters (the summary bar).
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
  p_import_batch_id uuid default null
) returns table (count bigint, total_in bigint, total_out bigint, net bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*),
         coalesce(sum(amount_cents) filter (where amount_cents > 0), 0)::bigint,
         coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)::bigint,
         coalesce(sum(amount_cents), 0)::bigint
  from public.search_transactions(p_business_id, p_from, p_to, p_types, p_category_ids, p_money_account_ids,
                                  p_amount_min, p_amount_max, p_sources, p_query, p_import_batch_id)
$$;

-- Set one category (or none) on many transactions at once. Each row goes through
-- update_transaction, so validation, the lock date, reposting and the audit trail are
-- exactly the single-row path. All or nothing. Returns how many rows changed.
create function public.categorize_transactions(p_transaction_ids uuid[], p_category_account_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  v_changed int := 0;
begin
  if cardinality(p_transaction_ids) > 5000 then
    raise exception 'Categorize at most 5,000 transactions at a time' using errcode = '22023';
  end if;
  for t in
    select * from public.transactions where id = any (p_transaction_ids) order by id for update
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

-- Saving "apply to similar" as a rule: vendor → category. Re-saving updates the rule.
create function public.save_category_rule(p_business_id uuid, p_vendor_normalized text, p_category_account_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_vendor text := nullif(btrim(p_vendor_normalized), '');
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if v_vendor is null then
    raise exception 'A rule needs a vendor' using errcode = '22023';
  end if;
  if not exists (select 1 from public.accounts where id = p_category_account_id and business_id = p_business_id
                 and not is_system and archived_at is null) then
    raise exception 'Pick an active category from this business' using errcode = '22023';
  end if;
  insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, created_by)
  values (p_business_id, v_vendor, p_category_account_id, 'manual', (select auth.uid()))
  on conflict (business_id, vendor_normalized)
  do update set category_account_id = excluded.category_account_id, enabled = true
  returning id into v_id;
  perform private.audit(p_business_id, 'save_rule', 'category_rules', v_id, null,
    jsonb_build_object('vendor_normalized', v_vendor, 'category_account_id', p_category_account_id));
  return v_id;
end $$;

revoke all on function public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid) from public, anon;
revoke all on function public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid) from public, anon;
revoke all on function public.categorize_transactions(uuid[], uuid) from public, anon;
revoke all on function public.save_category_rule(uuid, text, uuid) from public, anon;
grant execute on function
  public.search_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid),
  public.summarize_transactions(uuid, date, date, text[], uuid[], uuid[], bigint, bigint, public.transaction_source[], text, uuid),
  public.categorize_transactions(uuid[], uuid),
  public.save_category_rule(uuid, text, uuid)
to authenticated;

-- Listing newest first within a business is the default view.
create index transactions_business_date_desc_idx on public.transactions (business_id, date desc, created_at desc)
  where deleted_at is null;

-- Auto-file confident suggestions (MVP). People shouldn't have to click through suggestions the
-- engine is sure about. After each suggestion run, a pending suggestion is filed for them when:
--   * the business has ai_auto_file on (default on), and
--   * it comes from vendor history (people filed this vendor the same way 2+ times, every
--     time: the business has taught it), or from Jev / Claude at 0.9+, and
--   * it carries no flag (possible transfer, owner draw, personal, refund): those wait for a person.
-- Filed rows are marked category_source = 'ai', so the list can show and filter them, and any
-- edit makes them 'user'. Separate from ai_auto_apply (the Phase 2 setting inside
-- record_ai_suggestions, which ignores flags); that one stays off.

alter table public.businesses add column ai_auto_file boolean not null default true;
grant update (ai_auto_file) on public.businesses to authenticated;

create function public.auto_file_suggestions(p_business_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if not (select ai_auto_file from public.businesses where id = p_business_id) then
    return 0;
  end if;
  for r in
    select q.id, q.transaction_id, q.category_account_id
    from public.ai_suggestion_queue q   -- pending, uncategorized, live, after the lock date
    where q.business_id = p_business_id
      and cardinality(q.flags) = 0
      and (q.confidence >= 0.9 or q.model = 'vendor-history')
    order by q.date, q.id
  loop
    perform private.categorize_one(r.transaction_id, r.category_account_id);
    update public.transactions set category_source = 'ai' where id = r.transaction_id;
    n := n + 1;
  end loop;

  -- Then any uncategorized row whose vendor people have filed the same way 2+ times, every
  -- time, whether or not it has a suggestion yet (a vendor they've just taught it).
  for r in
    with taught as (
      select h.vendor_normalized, min(h.category_account_id::text)::uuid as category_account_id
      from public.transactions h
      where h.business_id = p_business_id and h.deleted_at is null and h.category_source = 'user'
        and h.vendor_normalized is not null and h.category_account_id is not null
      group by h.vendor_normalized
      having count(*) >= 2 and count(distinct h.category_account_id) = 1
    )
    select t.id, k.category_account_id
    from public.transactions t
    join taught k on k.vendor_normalized = t.vendor_normalized
    join public.businesses b on b.id = t.business_id
    where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null
      and (b.lock_date is null or t.date > b.lock_date)
      and private.ai_category_ok(p_business_id, k.category_account_id)
      -- A flagged suggestion still waits for a person.
      and not exists (select 1 from public.ai_suggestions s where s.transaction_id = t.id
                      and s.status = 'pending' and cardinality(s.flags) > 0)
    order by t.date, t.id
  loop
    perform private.categorize_one(r.id, r.category_account_id);
    update public.transactions set category_source = 'ai' where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.auto_file_suggestions(uuid) from public, anon;
grant execute on function public.auto_file_suggestions(uuid) to authenticated;

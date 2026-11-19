-- Vendors ranked by money out (or in) for a period, for the Ask bar's "who do we pay the
-- most" and "biggest vendors" answers. Transfers and owner equity are left out: money moved
-- between your own accounts isn't spending. Uncategorized rows count (they're still money
-- out). Read as the caller, so RLS applies.
create function public.vendor_totals(
  p_business_id uuid, p_from date default null, p_to date default null, p_direction text default 'out', p_limit int default 10
)
returns table (vendor_normalized text, label text, tx_count bigint, total_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(t.vendor_normalized, lower(coalesce(t.description_clean, t.description_raw))),
         -- The way the vendor is most often written.
         mode() within group (order by coalesce(t.description_clean, t.description_raw)),
         count(*)::bigint,
         sum(abs(t.amount_cents))::bigint
  from public.transactions t
  where t.business_id = p_business_id
    and t.deleted_at is null
    and (p_from is null or t.date >= p_from)
    and (p_to is null or t.date <= p_to)
    and t.kind not in ('transfer', 'equity')
    and case when p_direction = 'in' then t.amount_cents > 0 else t.amount_cents < 0 end
  group by 1
  order by 4 desc, 1
  limit greatest(1, least(coalesce(p_limit, 10), 50))
$$;

revoke all on function public.vendor_totals(uuid, date, date, text, int) from public, anon;
grant execute on function public.vendor_totals(uuid, date, date, text, int) to authenticated;

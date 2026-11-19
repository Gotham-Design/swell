-- Bulk transactions for the 100k performance check. Run as postgres with
-- seed.business and seed.count set. Posts through private.post_lines_for, like an import does.
do $$
declare
  b uuid := current_setting('seed.business')::uuid;
  n int := current_setting('seed.count')::int;
  chk uuid;
  card uuid;
  exp uuid[];
  inc uuid[];
  ids uuid[];
begin
  select id into chk from public.accounts where business_id = b and is_money_account and subtype = 'checking' limit 1;
  select id into card from public.accounts where business_id = b and is_money_account and subtype = 'credit_card' limit 1;
  select array_agg(id order by name) into exp from public.accounts
    where business_id = b and type = 'expense' and not is_system and not is_hidden and not is_money_account;
  select array_agg(id order by name) into inc from public.accounts
    where business_id = b and type = 'income' and not is_system and not is_hidden and subtype is null;

  with rows as (
    select g, 1 + (g * 7919) % 300 as v,
      case when g % 12 = 0 then null
           when g % 10 = 0 then inc[1 + g % array_length(inc, 1)]
           else exp[1 + g % array_length(exp, 1)] end as cat
    from generate_series(1, n) g
  ), ins as (
    insert into public.transactions (business_id, date, description_raw, description_clean, vendor_normalized, amount_cents,
      money_account_id, category_account_id, kind, source, created_at)
    select b, current_date - ((g::bigint * 104729) % 1095)::int, 'VENDOR ' || v || ' PURCHASE #' || g, 'Vendor ' || v, 'vendor ' || v,
      case when g % 10 = 0 then 50000 + (g * 31) % 450000 else -(100 + (g * 37) % 50000) end,
      case when g % 3 = 0 and g % 10 <> 0 then card else chk end,
      cat,
      (case when cat is null then 'other' when g % 10 = 0 then 'income' else 'expense' end)::public.transaction_kind,
      'manual', now() - make_interval(secs => g)
    from rows
    returning id
  )
  select array_agg(id) into ids from ins;
  perform private.post_lines_for(ids);
end $$;

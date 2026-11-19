-- Category suggestions with Jev (TypeSafe) and a local vendor-history tier.
--
-- 1. ai_vendor_history: how people already filed each vendor (user choices only), with
--    counts, so a vendor that is always filed the same way gets a suggestion without
--    any outside call.
-- 2. record_ai_suggestions: also stores the runner-up category and its probability.
--    Same signature, so callers and grants are unchanged.

-- ---------------------------------------------------------------------------
-- 1. Vendor history
-- ---------------------------------------------------------------------------
create function public.ai_vendor_history(p_business_id uuid, p_vendors text[])
returns table (vendor_normalized text, category_account_id uuid, n integer, vendor_total integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  return query
  with counts as (
    select t.vendor_normalized, t.category_account_id, count(*)::int as n
    from public.transactions t
    join public.accounts a on a.id = t.category_account_id
    where t.business_id = p_business_id
      and t.vendor_normalized = any (p_vendors)
      and t.deleted_at is null
      and t.category_source = 'user'
      and a.archived_at is null and not a.is_system and not a.is_money_account and not a.is_hidden
    group by t.vendor_normalized, t.category_account_id
  )
  select c.vendor_normalized, c.category_account_id, c.n,
    (sum(c.n) over (partition by c.vendor_normalized))::int
  from counts c;
end $$;

revoke all on function public.ai_vendor_history(uuid, text[]) from public, anon;
grant execute on function public.ai_vendor_history(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Record suggestions, now with an optional runner-up
-- ---------------------------------------------------------------------------
create or replace function public.record_ai_suggestions(
  p_business_id uuid,
  p_request_key text,
  p_model text,
  p_prompt_version text,
  p_latency_ms integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_suggestions jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.businesses;
  s jsonb;
  v_txn uuid;
  v_cat uuid;
  v_conf numeric;
  v_alt uuid;
  v_alt_conf numeric;
  v_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_applied int := 0;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if p_request_key is null or length(p_request_key) < 8 then
    raise exception 'A request key is required' using errcode = '22023';
  end if;
  select * into b from public.businesses where id = p_business_id;

  insert into public.ai_usage (business_id, month, input_tokens, output_tokens, calls)
  values (p_business_id, date_trunc('month', now() at time zone 'utc')::date,
          greatest(coalesce(p_input_tokens, 0), 0), greatest(coalesce(p_output_tokens, 0), 0), 1)
  on conflict (business_id, month) do update set
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    calls = public.ai_usage.calls + 1;

  for s in select * from jsonb_array_elements(coalesce(p_suggestions, '[]'::jsonb)) loop
    v_txn := (s ->> 'transaction_id')::uuid;
    v_cat := (s ->> 'category_id')::uuid;
    v_conf := least(greatest((s ->> 'confidence')::numeric, 0), 1);
    if not private.ai_category_ok(p_business_id, v_cat)
       or not exists (select 1 from public.transactions where id = v_txn and business_id = p_business_id
                      and deleted_at is null and category_account_id is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The runner-up is kept only when it is a usable category different from the pick.
    v_alt := nullif(s ->> 'runner_up_category_id', '')::uuid;
    v_alt_conf := least(greatest(nullif(s ->> 'runner_up_confidence', '')::numeric, 0), 1);
    if v_alt is not null and (v_alt = v_cat or not private.ai_category_ok(p_business_id, v_alt)) then
      v_alt := null;
    end if;
    if v_alt is null then
      v_alt_conf := null;
    end if;

    -- Same batch again: nothing to add.
    continue when exists (select 1 from public.ai_suggestions where business_id = p_business_id
                          and request_key = p_request_key and transaction_id = v_txn);
    -- One pending suggestion per transaction: the newer one replaces it.
    update public.ai_suggestions set status = 'superseded' where transaction_id = v_txn and status = 'pending';
    insert into public.ai_suggestions (business_id, transaction_id, category_account_id, confidence, reason, flags,
      model, prompt_version, request_key, latency_ms, input_tokens, output_tokens,
      runner_up_category_account_id, runner_up_confidence)
    values (p_business_id, v_txn, v_cat, round(v_conf, 3), left(nullif(s ->> 'reason', ''), 300),
      coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'flags', '[]'::jsonb))), '{}'),
      p_model, p_prompt_version, p_request_key, p_latency_ms, p_input_tokens, p_output_tokens,
      v_alt, round(v_alt_conf, 3))
    on conflict (business_id, request_key, transaction_id) do nothing
    returning id into v_id;
    continue when v_id is null;
    v_inserted := v_inserted + 1;

    if b.ai_auto_apply and v_conf >= 0.9 then
      perform private.categorize_one(v_txn, v_cat);
      update public.transactions set category_source = 'ai' where id = v_txn;
      v_applied := v_applied + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'auto_applied', v_applied);
end $$;

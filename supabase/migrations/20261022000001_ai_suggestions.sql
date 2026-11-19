-- Claude category suggestions (SPEC Prompt 10). The model call happens in the Next.js
-- server; the database decides what may be sent (ai_context, ai_candidates), records
-- results and token usage (record_ai_suggestions), and is the only place a suggestion
-- turns into a category (accept / bulk accept, or auto-apply when the owner opted in).

-- Auto-applied categories are their own source, so they never count as a person's choice.
alter type public.category_source add value if not exists 'ai';

alter table public.businesses
  -- null = the server default (ANTHROPIC_MODEL, else Claude Haiku 5.5).
  add column ai_model text check (ai_model is null or ai_model in ('claude-haiku-5-5', 'claude-sonnet-5-5')),
  -- Apply suggestions at 90%+ confidence without asking. Off by default.
  add column ai_auto_apply boolean not null default false,
  -- Send memos with transactions. Off by default.
  add column ai_share_memos boolean not null default false,
  add column ai_monthly_token_budget bigint not null default 2000000 check (ai_monthly_token_budget > 0);
grant update (ai_model, ai_auto_apply, ai_share_memos, ai_monthly_token_budget) on public.businesses to authenticated;

-- ---------------------------------------------------------------------------
-- Usage per business per calendar month (UTC), for the budget and the settings meter.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  business_id uuid not null references public.businesses (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  calls integer not null default 0 check (calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, month)
);
create trigger touch_updated_at before update on public.ai_usage
  for each row execute function private.touch_updated_at();
alter table public.ai_usage enable row level security;
create policy "members read" on public.ai_usage for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.ai_usage from authenticated;
revoke all on public.ai_usage from anon;

-- Suggestions change only through the functions below.
revoke insert, update, delete, truncate on public.ai_suggestions from authenticated;
create index ai_suggestions_pending_idx on public.ai_suggestions (business_id, transaction_id) where status = 'pending';
create index ai_suggestions_transaction_idx on public.ai_suggestions (transaction_id);

create function public.ai_budget(p_business_id uuid)
returns table (month date, used bigint, budget bigint, remaining bigint)
language sql stable security invoker set search_path = '' as $$
  select m.month, coalesce(u.input_tokens + u.output_tokens, 0)::bigint, b.ai_monthly_token_budget,
    greatest(b.ai_monthly_token_budget - coalesce(u.input_tokens + u.output_tokens, 0), 0)::bigint
  from public.businesses b
  cross join (select date_trunc('month', now() at time zone 'utc')::date as month) m
  left join public.ai_usage u on u.business_id = b.id and u.month = m.month
  where b.id = p_business_id
$$;

-- Categories a suggestion may use: active, visible, not system, not a money account.
create function private.ai_category_ok(p_business_id uuid, p_account_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts a where a.id = p_account_id and a.business_id = p_business_id
    and a.archived_at is null and not a.is_system and not a.is_money_account and not a.is_hidden)
$$;

-- ---------------------------------------------------------------------------
-- What the server may send. Everything the request contains comes from these two
-- functions; account numbers, emails and (unless opted in) memos are never in them.
-- ---------------------------------------------------------------------------
create function public.ai_context(p_business_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.businesses;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  select * into b from public.businesses where id = p_business_id;
  return jsonb_build_object(
    'enabled', b.ai_enabled,
    'model', b.ai_model,
    'share_memos', b.ai_share_memos,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'description', a.description)
                       order by a.type, a.name)
      from public.accounts a
      where a.business_id = p_business_id and a.archived_at is null and not a.is_system
        and not a.is_money_account and not a.is_hidden), '[]'),
    -- Up to 20 recent choices people made, one per vendor.
    'examples', coalesce((
      select jsonb_agg(jsonb_build_object('description', e.description_clean, 'category', e.category) order by e.date desc)
      from (
        select d.* from (
          select distinct on (coalesce(t.vendor_normalized, t.description_clean)) t.description_clean, a.name as category, t.date
          from public.transactions t join public.accounts a on a.id = t.category_account_id
          where t.business_id = p_business_id and t.deleted_at is null and t.category_source = 'user'
            and t.description_clean is not null and a.archived_at is null
          order by coalesce(t.vendor_normalized, t.description_clean), t.date desc
        ) d
        order by d.date desc limit 20
      ) e), '[]'),
    -- Up to 10 recent rejected suggestions (and what the person picked instead).
    'rejections', coalesce((
      select jsonb_agg(r.j) from (
        select jsonb_build_object('description', t.description_clean, 'not_category', sa.name, 'chosen_category', ca.name) as j
        from public.ai_suggestions s
        join public.transactions t on t.id = s.transaction_id
        join public.accounts sa on sa.id = s.category_account_id
        left join public.accounts ca on ca.id = t.category_account_id
        where s.business_id = p_business_id and s.status = 'rejected' and t.description_clean is not null
        order by s.decided_at desc nulls last limit 10) r), '[]')
  );
end $$;

-- Uncategorized live transactions with no matching rule, no pending suggestion, not
-- rejected twice already, and not in a locked period. Includes Prompt 9 patterns.
create function public.ai_candidates(p_business_id uuid, p_limit integer default 50)
returns table (
  id uuid, date date, description_clean text, vendor_normalized text, amount_cents bigint,
  money_account_kind text, memo text, recurring_cadence text, is_large boolean, vendor_categories text[]
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare b public.businesses;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  select * into b from public.businesses bz where bz.id = p_business_id;
  return query
  select t.id, t.date, coalesce(t.description_clean, t.description_raw), t.vendor_normalized, t.amount_cents,
    m.subtype,
    case when b.ai_share_memos then t.memo end,
    (select p.cadence from public.transaction_patterns p where p.business_id = t.business_id and p.kind = 'recurring'
       and p.vendor_normalized = t.vendor_normalized and p.direction = case when t.amount_cents < 0 then 'out' else 'in' end),
    exists (select 1 from public.transaction_patterns p where p.business_id = t.business_id and p.kind = 'large' and p.transaction_id = t.id),
    coalesce((select array_agg(distinct a.name order by a.name) from public.transactions o
       join public.accounts a on a.id = o.category_account_id
       where o.business_id = t.business_id and o.vendor_normalized = t.vendor_normalized and o.deleted_at is null
         and o.category_source = 'user'), '{}')
  from public.transactions t
  join public.accounts m on m.id = t.money_account_id
  where t.business_id = p_business_id and t.deleted_at is null and t.category_account_id is null
    and (b.lock_date is null or t.date > b.lock_date)
    and not exists (select 1 from public.category_rules r where r.business_id = t.business_id
                    and r.vendor_normalized = t.vendor_normalized and r.enabled and r.deleted_at is null)
    and not exists (select 1 from public.ai_suggestions s where s.transaction_id = t.id and s.status = 'pending')
    and (select count(*) from public.ai_suggestions s where s.transaction_id = t.id and s.status = 'rejected') < 2
  order by t.date desc, t.created_at desc, t.id
  limit least(greatest(p_limit, 1), 50);
end $$;

create function public.ai_request_done(p_business_id uuid, p_request_key text)
returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.ai_suggestions where business_id = p_business_id and request_key = p_request_key)
$$;

-- ---------------------------------------------------------------------------
-- Categorize one transaction, keeping every other field (the bulk-categorize path).
-- ---------------------------------------------------------------------------
create function private.categorize_one(p_transaction_id uuid, p_category_account_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id;
  perform public.update_transaction(t.id, t.date, t.money_account_id, t.amount_cents, t.description_raw,
    p_category_account_id, t.description_clean, t.vendor_normalized, t.memo, t.reference, t.dedupe_hash);
end $$;

-- When a pending suggestion's transaction gets a category by any path (accept, the
-- picker, the drawer, bulk), the suggestion is decided: accepted if it matches,
-- rejected (corrected) otherwise.
create function private.decide_ai_suggestions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_account_id is not null and new.category_account_id is distinct from old.category_account_id then
    update public.ai_suggestions
    set status = case when category_account_id = new.category_account_id then 'accepted' else 'rejected' end::public.ai_suggestion_status,
        decided_at = now(), decided_by = (select auth.uid())
    where transaction_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger decide_ai_suggestions after update of category_account_id on public.transactions
  for each row execute function private.decide_ai_suggestions();

-- ---------------------------------------------------------------------------
-- Record a batch: usage always; suggestions that name an allowed category for a still
-- uncategorized transaction. Re-running the same request_key adds nothing. Older pending
-- suggestions for the same transaction are superseded. Auto-apply only when the owner
-- turned it on, and only at 0.9+.
-- ---------------------------------------------------------------------------
create function public.record_ai_suggestions(
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
    -- Same batch again: nothing to add.
    continue when exists (select 1 from public.ai_suggestions where business_id = p_business_id
                          and request_key = p_request_key and transaction_id = v_txn);
    -- One pending suggestion per transaction: the newer one replaces it.
    update public.ai_suggestions set status = 'superseded' where transaction_id = v_txn and status = 'pending';
    insert into public.ai_suggestions (business_id, transaction_id, category_account_id, confidence, reason, flags,
      model, prompt_version, request_key, latency_ms, input_tokens, output_tokens)
    values (p_business_id, v_txn, v_cat, round(v_conf, 3), left(s ->> 'reason', 300),
      coalesce(array(select jsonb_array_elements_text(s -> 'flags')), '{}'),
      p_model, p_prompt_version, p_request_key, p_latency_ms, p_input_tokens, p_output_tokens)
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

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------
create function public.accept_ai_suggestion(p_suggestion_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.ai_suggestions;
begin
  select * into s from public.ai_suggestions where id = p_suggestion_id;
  if s.id is null then
    raise exception 'Suggestion not found' using errcode = '42501';
  end if;
  perform private.require_role(s.business_id, '{owner,editor}');
  if s.status <> 'pending' then
    raise exception 'This suggestion was already %', s.status using errcode = '22023';
  end if;
  perform private.categorize_one(s.transaction_id, s.category_account_id);
  return s.transaction_id;
end $$;

create function public.reject_ai_suggestion(p_suggestion_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare s public.ai_suggestions;
begin
  select * into s from public.ai_suggestions where id = p_suggestion_id;
  if s.id is null then
    raise exception 'Suggestion not found' using errcode = '42501';
  end if;
  perform private.require_role(s.business_id, '{owner,editor}');
  update public.ai_suggestions set status = 'rejected', decided_at = now(), decided_by = (select auth.uid())
  where id = s.id and status = 'pending';
end $$;

-- Pending suggestions people can act on, with their transaction (review mode, chips).
create view public.ai_suggestion_queue with (security_invoker = true) as
select s.id, s.business_id, s.transaction_id, s.category_account_id, a.name as category_name, s.confidence, s.reason,
  s.flags, s.model, s.created_at, t.date, t.description_raw, t.description_clean, t.amount_cents, t.money_account_id
from public.ai_suggestions s
join public.transactions t on t.business_id = s.business_id and t.id = s.transaction_id
join public.accounts a on a.business_id = s.business_id and a.id = s.category_account_id
join public.businesses b on b.id = s.business_id
where s.status = 'pending' and t.deleted_at is null and t.category_account_id is null
  and (b.lock_date is null or t.date > b.lock_date);

-- "Accept all above X%": the preview count and the action use the same filter; the
-- action refuses if the count changed since the preview.
create function public.count_ai_suggestions_above(p_business_id uuid, p_min_confidence numeric)
returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::int from public.ai_suggestion_queue where business_id = p_business_id and confidence >= p_min_confidence
$$;

create function public.accept_ai_suggestions_above(p_business_id uuid, p_min_confidence numeric, p_expected_count integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  v_ids := array(select id from public.ai_suggestion_queue
                 where business_id = p_business_id and confidence >= p_min_confidence order by date, id);
  if cardinality(v_ids) <> p_expected_count then
    raise exception 'The suggestions changed (% now match, you confirmed %). Review again.', cardinality(v_ids), p_expected_count
      using errcode = '40001';
  end if;
  foreach v_id in array v_ids loop
    perform public.accept_ai_suggestion(v_id);
  end loop;
  return cardinality(v_ids);
end $$;

revoke all on function private.ai_category_ok(uuid, uuid) from public;
revoke all on function private.categorize_one(uuid, uuid) from public;
revoke all on function public.ai_budget(uuid), public.ai_context(uuid), public.ai_candidates(uuid, integer),
  public.ai_request_done(uuid, text), public.record_ai_suggestions(uuid, text, text, text, integer, integer, integer, jsonb),
  public.accept_ai_suggestion(uuid), public.reject_ai_suggestion(uuid), public.count_ai_suggestions_above(uuid, numeric),
  public.accept_ai_suggestions_above(uuid, numeric, integer) from public, anon;
grant execute on function public.ai_budget(uuid), public.ai_context(uuid), public.ai_candidates(uuid, integer),
  public.ai_request_done(uuid, text), public.record_ai_suggestions(uuid, text, text, text, integer, integer, integer, jsonb),
  public.accept_ai_suggestion(uuid), public.reject_ai_suggestion(uuid), public.count_ai_suggestions_above(uuid, numeric),
  public.accept_ai_suggestions_above(uuid, numeric, integer) to authenticated;
revoke all on public.ai_suggestion_queue from anon;

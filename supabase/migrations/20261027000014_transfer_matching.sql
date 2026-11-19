-- Transfer matching. A card payment from checking shows up on both statements: money out of
-- checking, money in on the card. Filed separately, each as a transfer to the other account,
-- it counts twice. A confirmed match files both sides to the system Transfer Clearing account
-- instead: checking -> clearing, clearing -> card. Each account still shows its own row (and
-- reconciles on its own), the money moves once, and clearing nets to zero.
--
-- The accountant confirms every pair (transfer_match_candidates suggests them); "not a match"
-- is remembered. Money moving to or from an account that isn't in the books (a personal
-- account) has no pair: candidates list it too, for the accountant to file (often an owner
-- contribution or draw).

-- 1. Kinds: Transfer Clearing is a transfer.
create or replace function private.category_kind(p_type public.account_type, p_is_money boolean, p_subtype text)
returns public.transaction_kind
language sql immutable set search_path = '' as $$
  select (case
    when p_type is null then 'other'                       -- uncategorized
    when p_type = 'income' then 'income'
    when p_type = 'expense' then 'expense'
    when p_type = 'equity' then 'equity'
    when p_is_money or p_subtype in ('checking', 'savings', 'cash', 'credit_card', 'transfer_clearing') then 'transfer'
    else 'other'
  end)::public.transaction_kind
$$;

-- 2. Transfer Clearing can't be picked, but a matched transaction may keep it when edited
--    (update_transaction passes the current category in p_allow_archived), and the matching
--    functions set it (quickacct.transfer_write).
create or replace function private.resolve_kind(
  p_business_id uuid,
  p_money_account_id uuid,
  p_category_account_id uuid,
  p_allow_archived uuid[] default '{}'
) returns public.transaction_kind
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.accounts;
  c public.accounts;
begin
  select * into m from public.accounts where id = p_money_account_id and business_id = p_business_id;
  if m.id is null then
    raise exception 'Money account not found in this business' using errcode = '23503';
  end if;
  if not m.is_money_account then
    raise exception '% is not a money account', m.name using errcode = '22023';
  end if;
  if m.archived_at is not null and not (m.id = any (p_allow_archived)) then
    raise exception 'Money account % is archived', m.name using errcode = '22023';
  end if;
  if p_category_account_id is null then
    return private.category_kind(null, false, null);
  end if;
  select * into c from public.accounts where id = p_category_account_id and business_id = p_business_id;
  if c.id is null then
    raise exception 'Category not found in this business' using errcode = '23503';
  end if;
  if c.id = m.id then
    raise exception 'A transaction cannot be categorized to its own money account' using errcode = '22023';
  end if;
  if c.is_system and not (c.subtype = 'transfer_clearing'
      and (c.id = any (p_allow_archived) or current_setting('quickacct.transfer_write', true) = 'on')) then
    raise exception '% is a system account and cannot be picked as a category', c.name using errcode = '22023';
  end if;
  if c.archived_at is not null and not (c.id = any (p_allow_archived)) then
    raise exception 'Category % is archived', c.name using errcode = '22023';
  end if;
  return private.category_kind(c.type, c.is_money_account, c.subtype);
end $$;

-- 3. Matches (confirmed) and pairs the accountant said aren't (dismissed).
create table public.transfer_matches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  out_transaction_id uuid not null,
  -- Null for a dismissed one-sided transfer ("not a transfer").
  in_transaction_id uuid,
  status text not null check (status in ('confirmed', 'dismissed')),
  -- What each side was filed as before the match, put back on unmatch.
  out_prev_category_id uuid,
  in_prev_category_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (status = 'dismissed' or in_transaction_id is not null),
  check (in_transaction_id is null or in_transaction_id <> out_transaction_id),
  foreign key (business_id, out_transaction_id) references public.transactions (business_id, id) on delete cascade,
  foreign key (business_id, in_transaction_id) references public.transactions (business_id, id) on delete cascade
);
create unique index transfer_matches_out_confirmed on public.transfer_matches (out_transaction_id) where status = 'confirmed';
create unique index transfer_matches_in_confirmed on public.transfer_matches (in_transaction_id) where status = 'confirmed';
create unique index transfer_matches_pair on public.transfer_matches (out_transaction_id, coalesce(in_transaction_id, out_transaction_id));
create index transfer_matches_in_idx on public.transfer_matches (in_transaction_id);
create index transfer_matches_business_idx on public.transfer_matches (business_id);

alter table public.transfer_matches enable row level security;
create policy "members read" on public.transfer_matches for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor,viewer}')));
-- Written only by the functions below.
revoke insert, update, delete on public.transfer_matches from authenticated;

-- 4. A matched transaction can't be re-filed, re-signed, moved or deleted without unmatching.
create function private.guard_matched_transfer()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('quickacct.transfer_write', true) = 'on' then
    return new;
  end if;
  if (new.category_account_id is distinct from old.category_account_id
      or new.amount_cents <> old.amount_cents
      or new.money_account_id <> old.money_account_id
      or (new.deleted_at is not null and old.deleted_at is null))
    and exists (select 1 from public.transfer_matches m
                where m.status = 'confirmed' and (m.out_transaction_id = old.id or m.in_transaction_id = old.id)) then
    raise exception 'This is a matched transfer. Unmatch it first.' using errcode = '22023', hint = 'matched_transfer';
  end if;
  return new;
end $$;
create trigger guard_matched_transfer before update on public.transactions
  for each row execute function private.guard_matched_transfer();

-- 5. Suggested pairs (and one-sided transfers), newest first. Read as the caller.
create function public.transfer_match_candidates(p_business_id uuid, p_limit int default 100)
returns table (
  kind text, out_transaction_id uuid, in_transaction_id uuid,
  out_account_id uuid, in_account_id uuid, out_date date, in_date date, amount_cents bigint,
  out_description text, in_description text, days int, worded boolean
)
language sql stable security invoker set search_path = '' as $$
  with live as (
    select t.id, t.money_account_id, t.date, t.amount_cents, coalesce(t.description_clean, t.description_raw) as description,
      coalesce(t.description_raw, '') || ' ' || coalesce(t.description_clean, '') ~* '(transfer|xfer|payment|pymt|pmt|thank you|autopay|epay|card ?payment|to (checking|savings|card)|from (checking|savings|card)|zelle|venmo)' as worded
    from public.transactions t
    where t.business_id = p_business_id and t.deleted_at is null
      -- The last two years: keeps the pairing join small on big ledgers.
      and t.date >= current_date - 730
      -- Not yet filed, filed automatically, or filed as a transfer (which is where the double count hides).
      and (t.category_account_id is null or t.kind = 'transfer' or t.category_source in ('ai', 'rule'))
      and not exists (select 1 from public.transfer_matches m where m.status = 'confirmed'
                      and (m.out_transaction_id = t.id or m.in_transaction_id = t.id))
  ),
  pairs as (
    select o.id as out_id, i.id as in_id, o.money_account_id as out_acct, i.money_account_id as in_acct,
      o.date as out_date, i.date as in_date, i.amount_cents as amount, o.description as out_desc, i.description as in_desc,
      abs(i.date - o.date) as days, (o.worded or i.worded) as worded,
      row_number() over (partition by o.id order by abs(i.date - o.date), (o.worded or i.worded) desc, i.id) as ro,
      row_number() over (partition by i.id order by abs(i.date - o.date), (o.worded or i.worded) desc, o.id) as ri
    from live o
    join live i on i.money_account_id <> o.money_account_id and i.amount_cents = -o.amount_cents
      and i.date between o.date - 5 and o.date + 5
    where o.amount_cents < 0
      and not exists (select 1 from public.transfer_matches d where d.status = 'dismissed'
                      and d.out_transaction_id = o.id and d.in_transaction_id = i.id)
  ),
  best as (select * from pairs where ro = 1 and ri = 1),
  lonely as (
    select l.* from live l
    where l.worded
      and not exists (select 1 from best b where b.out_id = l.id or b.in_id = l.id)
      and not exists (select 1 from public.transfer_matches d where d.status = 'dismissed'
                      and d.out_transaction_id = l.id and d.in_transaction_id is null)
  )
  select * from (
    select 'pair', b.out_id, b.in_id, b.out_acct, b.in_acct, b.out_date, b.in_date, b.amount, b.out_desc, b.in_desc, b.days, b.worded
    from best b
    union all
    -- Signed, so the screen knows money in from money out.
    select 'unpaired', l.id, null, l.money_account_id, null, l.date, null, l.amount_cents, l.description, null, null,
      true
    from lonely l
  ) x
  order by 1, 6 desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;

-- 6. Confirm a pair: both sides filed to Transfer Clearing.
create function public.confirm_transfer_match(p_out_transaction_id uuid, p_in_transaction_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.transactions;
  i public.transactions;
  v_clearing uuid;
  v_id uuid;
begin
  select * into o from public.transactions where id = p_out_transaction_id for update;
  select * into i from public.transactions where id = p_in_transaction_id for update;
  if o.id is null or i.id is null or o.business_id <> i.business_id then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(o.business_id, '{owner,editor}');
  if o.deleted_at is not null or i.deleted_at is not null then
    raise exception 'Restore both transactions before matching them' using errcode = '22023';
  end if;
  if o.amount_cents >= 0 or i.amount_cents <> -o.amount_cents then
    raise exception 'A transfer match is the same amount out of one account and into another' using errcode = '22023';
  end if;
  if o.money_account_id = i.money_account_id then
    raise exception 'Both sides are on the same account' using errcode = '22023';
  end if;
  if exists (select 1 from public.transfer_matches m where m.status = 'confirmed'
             and (m.out_transaction_id in (o.id, i.id) or m.in_transaction_id in (o.id, i.id))) then
    raise exception 'One of these is already matched' using errcode = '22023';
  end if;
  perform private.require_unlocked(o.business_id, o.date);
  perform private.require_unlocked(i.business_id, i.date);
  select id into v_clearing from public.accounts where business_id = o.business_id and is_system and subtype = 'transfer_clearing';

  perform set_config('quickacct.transfer_write', 'on', true);
  update public.ai_suggestions set status = 'superseded' where transaction_id in (o.id, i.id) and status = 'pending';
  update public.transactions set category_account_id = v_clearing, kind = 'transfer', category_rule_id = null
  where id in (o.id, i.id);
  perform private.post_lines_for(array[o.id, i.id]);
  delete from public.transfer_matches where status = 'dismissed' and out_transaction_id = o.id and in_transaction_id = i.id;
  insert into public.transfer_matches (business_id, out_transaction_id, in_transaction_id, status, out_prev_category_id, in_prev_category_id)
  values (o.business_id, o.id, i.id, 'confirmed', o.category_account_id, i.category_account_id)
  returning id into v_id;
  perform private.audit(o.business_id, 'update', 'transactions', o.id, to_jsonb(o), (select to_jsonb(t) from public.transactions t where t.id = o.id));
  perform private.audit(i.business_id, 'update', 'transactions', i.id, to_jsonb(i), (select to_jsonb(t) from public.transactions t where t.id = i.id));
  perform set_config('quickacct.transfer_write', 'off', true);
  return v_id;
end $$;

-- 7. Unmatch: each side goes back to what it was filed as (uncategorized if that's no longer usable).
create function public.unmatch_transfer(p_match_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.transfer_matches;
  t public.transactions;
  v_prev uuid;
begin
  select * into m from public.transfer_matches where id = p_match_id and status = 'confirmed' for update;
  if m.id is null then
    raise exception 'Match not found' using errcode = '42501';
  end if;
  perform private.require_role(m.business_id, '{owner,editor}');
  perform set_config('quickacct.transfer_write', 'on', true);
  for t in select * from public.transactions where id in (m.out_transaction_id, m.in_transaction_id) order by id for update loop
    perform private.require_unlocked(t.business_id, t.date);
    v_prev := case when t.id = m.out_transaction_id then m.out_prev_category_id else m.in_prev_category_id end;
    -- The old category may be archived or gone by now; uncategorized is always safe.
    if v_prev is not null and not exists (select 1 from public.accounts a where a.id = v_prev and a.business_id = t.business_id
        and a.archived_at is null and not a.is_system and a.id <> t.money_account_id) then
      v_prev := null;
    end if;
    update public.transactions set category_account_id = v_prev,
      kind = private.resolve_kind(t.business_id, t.money_account_id, v_prev, array[t.money_account_id])
    where id = t.id;
    perform private.post_lines_for(array[t.id]);
    perform private.audit(t.business_id, 'update', 'transactions', t.id, to_jsonb(t), (select to_jsonb(x) from public.transactions x where x.id = t.id));
  end loop;
  delete from public.transfer_matches where id = m.id;
  perform set_config('quickacct.transfer_write', 'off', true);
end $$;

-- 8. "Not a match" (a pair) or "not a transfer" (one side): stop suggesting it.
create function public.dismiss_transfer_candidate(p_out_transaction_id uuid, p_in_transaction_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare o public.transactions;
begin
  select * into o from public.transactions where id = p_out_transaction_id;
  if o.id is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(o.business_id, '{owner,editor}');
  if p_in_transaction_id is not null and not exists (
    select 1 from public.transactions where id = p_in_transaction_id and business_id = o.business_id) then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  insert into public.transfer_matches (business_id, out_transaction_id, in_transaction_id, status)
  values (o.business_id, o.id, p_in_transaction_id, 'dismissed')
  on conflict do nothing;
end $$;

revoke all on function private.guard_matched_transfer() from public;
revoke all on function
  public.transfer_match_candidates(uuid, int), public.confirm_transfer_match(uuid, uuid),
  public.unmatch_transfer(uuid), public.dismiss_transfer_candidate(uuid, uuid)
from public, anon;
grant execute on function
  public.transfer_match_candidates(uuid, int), public.confirm_transfer_match(uuid, uuid),
  public.unmatch_transfer(uuid), public.dismiss_transfer_candidate(uuid, uuid)
to authenticated;

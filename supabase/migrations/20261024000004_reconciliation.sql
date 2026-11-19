-- Hardening: reconcile a money account to a bank or card statement. Enter the statement's
-- ending date and balance, tick the transactions that cleared, and the difference must
-- reach zero to finish. Amounts are signed the way the statement shows them: an asset
-- account's balance, or what's owed on a card or loan.

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  money_account_id uuid not null,
  statement_date date not null,
  statement_balance_cents bigint not null,
  -- The previous finished statement's balance (0 for the first).
  beginning_balance_cents bigint not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, money_account_id) references public.accounts (business_id, id) on delete cascade,
  check ((status = 'completed') = (completed_at is not null))
);
create unique index reconciliations_one_open on public.reconciliations (money_account_id) where status = 'in_progress';
create index reconciliations_account_idx on public.reconciliations (business_id, money_account_id, statement_date);
create trigger touch_updated_at before update on public.reconciliations
  for each row execute function private.touch_updated_at();
alter table public.reconciliations enable row level security;
create policy "members read" on public.reconciliations for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.reconciliations from authenticated;
revoke all on public.reconciliations from anon;

-- Which reconciliation cleared each transaction, per money account it touches (a
-- transfer clears separately on each side).
create table public.reconciliation_items (
  business_id uuid not null references public.businesses (id) on delete cascade,
  reconciliation_id uuid not null,
  money_account_id uuid not null,
  transaction_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (money_account_id, transaction_id),
  foreign key (business_id, reconciliation_id) references public.reconciliations (business_id, id) on delete cascade,
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade
);
create index reconciliation_items_reconciliation_idx on public.reconciliation_items (reconciliation_id);
create index reconciliation_items_transaction_idx on public.reconciliation_items (business_id, transaction_id);
alter table public.reconciliation_items enable row level security;
create policy "members read" on public.reconciliation_items for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.reconciliation_items from authenticated;
revoke all on public.reconciliation_items from anon;

-- Asset accounts read debit-positive; cards and loans read as amount owed.
create function private.statement_sign(p_account_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select case when type = 'asset' then 1 else -1 end from public.accounts where id = p_account_id
$$;
revoke all on function private.statement_sign(uuid) from public, anon;

-- Transactions that can appear on this statement: live, on this account (either side),
-- dated on or before the statement date, not cleared by an earlier finished statement.
create function public.reconciliation_lines(p_reconciliation_id uuid)
returns table (transaction_id uuid, date date, description text, amount_cents bigint, cleared boolean)
language sql stable security invoker set search_path = '' as $$
  select t.id, t.date, coalesce(t.description_clean, t.description_raw),
    (jl.amount_cents * private.statement_sign(r.money_account_id))::bigint,
    exists (select 1 from public.reconciliation_items i where i.reconciliation_id = r.id and i.transaction_id = t.id)
  from public.reconciliations r
  join public.journal_lines jl on jl.business_id = r.business_id and jl.account_id = r.money_account_id
  join public.transactions t on t.business_id = jl.business_id and t.id = jl.transaction_id
  where r.id = p_reconciliation_id and t.deleted_at is null and t.date <= r.statement_date
    and not exists (select 1 from public.reconciliation_items i join public.reconciliations d on d.id = i.reconciliation_id
                    where i.money_account_id = r.money_account_id and i.transaction_id = t.id and d.status = 'completed'
                      and d.id <> r.id)
  order by t.date, t.created_at, t.id
$$;

create function public.reconciliation_summary(p_reconciliation_id uuid)
returns table (beginning_cents bigint, cleared_cents bigint, cleared_count integer, cleared_balance_cents bigint,
               statement_balance_cents bigint, difference_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select r.beginning_balance_cents, coalesce(c.total, 0)::bigint, coalesce(c.n, 0)::int,
    (r.beginning_balance_cents + coalesce(c.total, 0))::bigint, r.statement_balance_cents,
    (r.statement_balance_cents - r.beginning_balance_cents - coalesce(c.total, 0))::bigint
  from public.reconciliations r
  left join lateral (
    select sum(jl.amount_cents * private.statement_sign(r.money_account_id)) as total, count(*) as n
    from public.reconciliation_items i
    join public.transactions t on t.id = i.transaction_id and t.deleted_at is null
    join public.journal_lines jl on jl.transaction_id = i.transaction_id and jl.account_id = r.money_account_id
    where i.reconciliation_id = r.id
  ) c on true
  where r.id = p_reconciliation_id
$$;

-- Start (or update the open) reconciliation for an account.
create function public.start_reconciliation(p_money_account_id uuid, p_statement_date date, p_statement_balance_cents bigint)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.accounts;
  v_id uuid;
  v_begin bigint;
  v_last date;
begin
  select * into a from public.accounts where id = p_money_account_id;
  if a.id is null or not a.is_money_account then
    raise exception 'Money account not found' using errcode = '42501';
  end if;
  perform private.require_role(a.business_id, '{owner,editor}');
  if p_statement_date is null or p_statement_balance_cents is null then
    raise exception 'Enter the statement date and ending balance' using errcode = '22004';
  end if;
  select statement_balance_cents, statement_date into v_begin, v_last from public.reconciliations
  where money_account_id = a.id and status = 'completed' order by statement_date desc, completed_at desc limit 1;
  if v_last is not null and p_statement_date <= v_last then
    raise exception 'This account is reconciled through %; pick a later statement date', v_last using errcode = '22023';
  end if;
  select id into v_id from public.reconciliations where money_account_id = a.id and status = 'in_progress';
  if v_id is null then
    insert into public.reconciliations (business_id, money_account_id, statement_date, statement_balance_cents, beginning_balance_cents)
    values (a.business_id, a.id, p_statement_date, p_statement_balance_cents, coalesce(v_begin, 0))
    returning id into v_id;
  else
    update public.reconciliations set statement_date = p_statement_date, statement_balance_cents = p_statement_balance_cents
    where id = v_id;
    -- Ticks dated after a moved-up statement date no longer belong.
    delete from public.reconciliation_items i using public.transactions t
    where i.reconciliation_id = v_id and t.id = i.transaction_id and t.date > p_statement_date;
  end if;
  return v_id;
end $$;

create function public.set_reconciliation_cleared(p_reconciliation_id uuid, p_transaction_ids uuid[], p_cleared boolean)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.reconciliations;
  v_n int;
begin
  select * into r from public.reconciliations where id = p_reconciliation_id;
  if r.id is null then
    raise exception 'Reconciliation not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, '{owner,editor}');
  if r.status <> 'in_progress' then
    raise exception 'This statement is already reconciled' using errcode = '22023';
  end if;
  if p_cleared then
    insert into public.reconciliation_items (business_id, reconciliation_id, money_account_id, transaction_id)
    select r.business_id, r.id, r.money_account_id, l.transaction_id
    from public.reconciliation_lines(r.id) l
    where l.transaction_id = any (p_transaction_ids)
    on conflict (money_account_id, transaction_id) do nothing;
  else
    delete from public.reconciliation_items where reconciliation_id = r.id and transaction_id = any (p_transaction_ids);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function public.finish_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.reconciliations;
  v_diff bigint;
begin
  select * into r from public.reconciliations where id = p_reconciliation_id for update;
  if r.id is null then
    raise exception 'Reconciliation not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, '{owner,editor}');
  if r.status <> 'in_progress' then
    raise exception 'This statement is already reconciled' using errcode = '22023';
  end if;
  select difference_cents into v_diff from public.reconciliation_summary(r.id);
  if v_diff <> 0 then
    raise exception 'The difference is % cents; it must be 0 to finish', v_diff using errcode = '22023';
  end if;
  update public.reconciliations set status = 'completed', completed_at = now(), completed_by = (select auth.uid()) where id = r.id;
  perform private.audit(r.business_id, 'reconcile', 'reconciliations', r.id, null,
    jsonb_build_object('money_account_id', r.money_account_id, 'statement_date', r.statement_date,
                       'statement_balance_cents', r.statement_balance_cents));
end $$;

-- Throw away an unfinished reconciliation (its ticks go with it).
create function public.discard_reconciliation(p_reconciliation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reconciliations;
begin
  select * into r from public.reconciliations where id = p_reconciliation_id;
  if r.id is null then
    raise exception 'Reconciliation not found' using errcode = '42501';
  end if;
  perform private.require_role(r.business_id, '{owner,editor}');
  if r.status <> 'in_progress' then
    raise exception 'A finished reconciliation cannot be discarded' using errcode = '22023';
  end if;
  delete from public.reconciliations where id = r.id;
end $$;

grant execute on function private.statement_sign(uuid) to authenticated;
revoke all on function public.reconciliation_lines(uuid), public.reconciliation_summary(uuid),
  public.start_reconciliation(uuid, date, bigint), public.set_reconciliation_cleared(uuid, uuid[], boolean),
  public.finish_reconciliation(uuid), public.discard_reconciliation(uuid) from public, anon;
grant execute on function public.reconciliation_lines(uuid), public.reconciliation_summary(uuid),
  public.start_reconciliation(uuid, date, bigint), public.set_reconciliation_cleared(uuid, uuid[], boolean),
  public.finish_reconciliation(uuid), public.discard_reconciliation(uuid) to authenticated;

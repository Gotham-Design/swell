-- Hardening: a nightly ledger integrity check. Triggers already refuse unbalanced
-- postings; this catches anything that slipped past them (manual SQL, a bad migration,
-- restored backups): every transaction's lines sum to 0 with exactly two lines, and each
-- business's trial balance (all lines) sums to 0. Problems become alerts that members
-- see as a banner; fixed problems close their alert on the next run.

create table public.ledger_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('unbalanced_transaction', 'line_count', 'trial_balance')),
  -- The transaction, for per-transaction problems.
  transaction_id uuid,
  detail jsonb not null default '{}',
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ledger_alerts_open_key on public.ledger_alerts
  (business_id, kind, coalesce(transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null;
create trigger touch_updated_at before update on public.ledger_alerts
  for each row execute function private.touch_updated_at();
alter table public.ledger_alerts enable row level security;
create policy "members read" on public.ledger_alerts for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke insert, update, delete, truncate, references, trigger on public.ledger_alerts from authenticated;
revoke all on public.ledger_alerts from anon;

-- One row per run, for monitoring.
create table private.ledger_check_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  businesses integer not null,
  problems integer not null,
  duration_ms integer not null
);

create function private.check_ledger(p_business_id uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz := clock_timestamp();
  v_problems int;
  v_businesses int;
begin
  -- One statement: find the problems, open or refresh their alerts, resolve the rest.
  with problems as (
    select t.business_id, 'unbalanced_transaction' as kind, t.id as transaction_id,
           jsonb_build_object('sum_cents', s.total, 'lines', s.n) as detail
    from public.transactions t
    join lateral (select coalesce(sum(jl.amount_cents), 0) as total, count(*) as n
                  from public.journal_lines jl where jl.transaction_id = t.id) s on true
    where (p_business_id is null or t.business_id = p_business_id) and s.total <> 0
    union all
    select t.business_id, 'line_count', t.id, jsonb_build_object('lines', s.n)
    from public.transactions t
    join lateral (select count(*) as n from public.journal_lines jl where jl.transaction_id = t.id) s on true
    where (p_business_id is null or t.business_id = p_business_id) and s.n <> 2
    union all
    select jl.business_id, 'trial_balance', null, jsonb_build_object('sum_cents', sum(jl.amount_cents))
    from public.journal_lines jl
    where p_business_id is null or jl.business_id = p_business_id
    group by jl.business_id having sum(jl.amount_cents) <> 0
  ),
  opened as (
    insert into public.ledger_alerts (business_id, kind, transaction_id, detail)
    select business_id, kind, transaction_id, detail from problems
    on conflict (business_id, kind, coalesce(transaction_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null
    do update set last_seen_at = now(), detail = excluded.detail
    returning 1
  ),
  resolved as (
    update public.ledger_alerts a set resolved_at = now()
    where a.resolved_at is null and (p_business_id is null or a.business_id = p_business_id)
      and not exists (select 1 from problems p where p.business_id = a.business_id and p.kind = a.kind
                      and p.transaction_id is not distinct from a.transaction_id)
    returning 1
  )
  select (select count(*) from problems) into v_problems
  from (select count(*) from opened) o, (select count(*) from resolved) r;

  select count(*) into v_businesses from public.businesses where p_business_id is null or id = p_business_id;
  insert into private.ledger_check_runs (businesses, problems, duration_ms)
  values (v_businesses, v_problems, (extract(epoch from clock_timestamp() - v_started) * 1000)::int);
  if v_problems > 0 then
    -- Shows up in the database logs (and pg_cron's job_run_details) for whoever watches them.
    raise warning 'ledger check: % problem(s) found; see public.ledger_alerts', v_problems;
  end if;
  return v_problems;
end $$;
revoke all on function private.check_ledger(uuid) from public, anon;

select cron.schedule('ledger-check-nightly', '0 7 * * *', 'select private.check_ledger()');

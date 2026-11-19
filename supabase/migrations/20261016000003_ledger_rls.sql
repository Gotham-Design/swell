-- Row-level security and grants (SPEC Prompt 1).
--   members read; owners and editors write; viewers read only.
--   A user in business A never sees or changes business B.
-- Transactions, journal lines and the audit log have no write grants at all: they
-- change only through the security-definer functions in the previous migration.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Nothing here is public: the anon role gets nothing.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from public, anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke insert, update, delete on public.transactions, public.journal_lines, public.audit_log from authenticated;
revoke insert on public.businesses from authenticated; -- use create_business()

grant execute on function
  public.create_business(text, text, text, smallint, date),
  public.post_transaction(uuid, date, uuid, bigint, text, uuid, text, text, text, text, public.transaction_source, uuid, text),
  public.update_transaction(uuid, date, uuid, bigint, text, uuid, text, text, text, text, text),
  public.soft_delete_transaction(uuid),
  public.restore_transaction(uuid)
to authenticated;

-- Private helpers: only has_role is called from RLS policies as the querying user.
revoke all on all functions in schema private from public;
grant execute on function private.has_role(uuid, public.member_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.accounts enable row level security;
alter table public.import_batches enable row level security;
alter table public.transactions enable row level security;
alter table public.journal_lines enable row level security;
alter table public.audit_log enable row level security;
alter table public.category_rules enable row level security;
alter table public.ai_suggestions enable row level security;

-- businesses: members read. Settings and the lock date are owner-only, so an editor
-- can't reopen a closed period.
create policy "members read" on public.businesses for select to authenticated
  using (private.has_role(id));
create policy "owners update" on public.businesses for update to authenticated
  using (private.has_role(id, '{owner}')) with check (private.has_role(id, '{owner}'));
create policy "owners delete" on public.businesses for delete to authenticated
  using (private.has_role(id, '{owner}'));

-- business_members: members see who else is in the business; owners manage roles.
create policy "members read" on public.business_members for select to authenticated
  using (private.has_role(business_id));
create policy "owners insert" on public.business_members for insert to authenticated
  with check (private.has_role(business_id, '{owner}'));
create policy "owners update" on public.business_members for update to authenticated
  using (private.has_role(business_id, '{owner}')) with check (private.has_role(business_id, '{owner}'));
create policy "owners delete" on public.business_members for delete to authenticated
  using (private.has_role(business_id, '{owner}'));

-- accounts: owners and editors manage the chart, except system accounts.
create policy "members read" on public.accounts for select to authenticated
  using (private.has_role(business_id));
create policy "writers insert" on public.accounts for insert to authenticated
  with check (private.has_role(business_id, '{owner,editor}') and not is_system);
create policy "writers update" on public.accounts for update to authenticated
  using (private.has_role(business_id, '{owner,editor}') and not is_system)
  with check (private.has_role(business_id, '{owner,editor}') and not is_system);
create policy "writers delete" on public.accounts for delete to authenticated
  using (private.has_role(business_id, '{owner,editor}') and not is_system);

-- Read-only to members; written by functions.
create policy "members read" on public.transactions for select to authenticated
  using (private.has_role(business_id));
create policy "members read" on public.journal_lines for select to authenticated
  using (private.has_role(business_id));
create policy "members read" on public.audit_log for select to authenticated
  using (private.has_role(business_id));

-- import_batches, category_rules, ai_suggestions: members read, owners and editors write.
do $$
declare t text;
begin
  foreach t in array array['import_batches', 'category_rules', 'ai_suggestions'] loop
    execute format('create policy "members read" on public.%I for select to authenticated
                    using (private.has_role(business_id))', t);
    execute format('create policy "writers insert" on public.%I for insert to authenticated
                    with check (private.has_role(business_id, ''{owner,editor}''))', t);
    execute format('create policy "writers update" on public.%I for update to authenticated
                    using (private.has_role(business_id, ''{owner,editor}''))
                    with check (private.has_role(business_id, ''{owner,editor}''))', t);
    execute format('create policy "writers delete" on public.%I for delete to authenticated
                    using (private.has_role(business_id, ''{owner,editor}''))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Integrity guards on directly-writable tables
-- ---------------------------------------------------------------------------

-- A business always keeps at least one owner (unless the business itself is going away).
create function private.keep_an_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.business_id <> old.business_id)
     and exists (select 1 from public.businesses where id = old.business_id)
     and not exists (select 1 from public.business_members
                     where business_id = old.business_id and role = 'owner' and id <> old.id) then
    raise exception 'A business needs at least one owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
create trigger keep_an_owner before update or delete on public.business_members
  for each row execute function private.keep_an_owner();

-- Accounts: a parent has the same type and no cycles; type and money-account status
-- are fixed once the account has postings (they decide each transaction's kind).
create function private.guard_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.accounts;
  v_cursor uuid;
  v_depth int := 0;
begin
  if new.parent_id is not null then
    select * into v_parent from public.accounts where id = new.parent_id;
    if v_parent.type <> new.type then
      raise exception 'A % category cannot sit under a % category', new.type, v_parent.type using errcode = '23514';
    end if;
    if v_parent.is_money_account or new.is_money_account then
      raise exception 'Money accounts cannot be nested' using errcode = '23514';
    end if;
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      if v_cursor = new.id or v_depth > 20 then
        raise exception 'Category parents cannot form a loop' using errcode = '23514';
      end if;
      select parent_id into v_cursor from public.accounts where id = v_cursor;
      v_depth := v_depth + 1;
    end loop;
  end if;

  if tg_op = 'UPDATE'
     and (new.type, new.is_money_account) is distinct from (old.type, old.is_money_account)
     and exists (select 1 from public.journal_lines where account_id = old.id) then
    raise exception 'Cannot change the type of % after transactions have posted to it', old.name
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_account before insert or update on public.accounts
  for each row execute function private.guard_account();

-- ---------------------------------------------------------------------------
-- Balances view: soft-deleted transactions excluded. Runs with the caller's RLS.
-- ---------------------------------------------------------------------------
create view public.account_balances with (security_invoker = true) as
select
  a.business_id,
  a.id as account_id,
  a.name,
  a.type,
  a.is_money_account,
  -- Debit-positive sum of live journal lines.
  coalesce(sum(jl.amount_cents) filter (where t.deleted_at is null), 0)::bigint as balance_cents,
  -- Same, signed the way people read it: positive for a normal balance of that type
  -- (assets and expenses debit; liabilities, equity and income credit).
  (case when a.type in ('asset', 'expense') then 1 else -1 end
    * coalesce(sum(jl.amount_cents) filter (where t.deleted_at is null), 0))::bigint as natural_balance_cents
from public.accounts a
left join public.journal_lines jl on jl.account_id = a.id
left join public.transactions t on t.id = jl.transaction_id
group by a.id;

revoke all on public.account_balances from anon;
grant select on public.account_balances to authenticated;

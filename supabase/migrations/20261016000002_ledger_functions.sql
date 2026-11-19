-- Posting functions (SPEC Prompt 1). Every write to transactions and journal_lines goes
-- through here. Each function is SECURITY DEFINER, checks the caller's role and the
-- business's lock date itself, and leaves exactly two journal lines that sum to zero.

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Is the current user a member of the business with one of these roles? Used by RLS.
create function private.has_role(
  p_business_id uuid,
  p_roles public.member_role[] default '{owner,editor,viewer}'
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.require_role(p_business_id uuid, p_roles public.member_role[])
returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_business_id, p_roles) then
    raise exception 'Not allowed: requires % access to this business', array_to_string(p_roles, ' or ')
      using errcode = '42501';
  end if;
end $$;

-- Transactions dated on or before the lock date are closed.
create function private.require_unlocked(p_business_id uuid, p_date date)
returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_lock date;
begin
  select lock_date into v_lock from public.businesses where id = p_business_id;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'Books are locked through %; % is in a closed period', v_lock, p_date
      using errcode = 'P0001', hint = 'locked_period';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Account helpers
-- ---------------------------------------------------------------------------

-- The system account uncategorized transactions post their other side to.
create function private.uncategorized_account(p_business_id uuid)
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts
  where business_id = p_business_id and is_system and subtype = 'uncategorized';
  if v_id is null then
    raise exception 'Business % has no Uncategorized account', p_business_id;
  end if;
  return v_id;
end $$;

-- System accounts every business needs before it can post anything. Prompt 3 adds the
-- standard chart on top.
create function private.seed_system_accounts(p_business_id uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into public.accounts (business_id, name, type, subtype, is_system, description)
  values (p_business_id, 'Uncategorized', 'expense', 'uncategorized', true,
          'Holding account for transactions that have not been categorized yet.')
  on conflict do nothing;
$$;

-- Checks the money account and category belong to the business and can take postings.
-- Returns the transaction kind the category implies.
create function private.resolve_kind(
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
    return 'other'::public.transaction_kind;
  end if;

  select * into c from public.accounts where id = p_category_account_id and business_id = p_business_id;
  if c.id is null then
    raise exception 'Category not found in this business' using errcode = '23503';
  end if;
  if c.id = m.id then
    raise exception 'A transaction cannot be categorized to its own money account' using errcode = '22023';
  end if;
  if c.is_system then
    raise exception '% is a system account and cannot be picked as a category', c.name using errcode = '22023';
  end if;
  if c.archived_at is not null and not (c.id = any (p_allow_archived)) then
    raise exception 'Category % is archived', c.name using errcode = '22023';
  end if;

  return case
    when c.type = 'income' then 'income'
    when c.type = 'expense' then 'expense'
    when c.type = 'equity' then 'equity'
    when c.is_money_account then 'transfer'
    else 'other'  -- non-money asset or liability, e.g. Equipment, Loans Payable
  end::public.transaction_kind;
end $$;

-- ---------------------------------------------------------------------------
-- Journal lines: the only code that writes them
-- ---------------------------------------------------------------------------
create function private.post_lines(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id;
  delete from public.journal_lines where transaction_id = t.id;
  -- Money account side: an inflow debits it (+), an outflow credits it (−). This is
  -- right for liability money accounts too: paying the card is a debit.
  insert into public.journal_lines (business_id, transaction_id, account_id, amount_cents) values
    (t.business_id, t.id, t.money_account_id, t.amount_cents),
    (t.business_id, t.id,
     coalesce(t.category_account_id, private.uncategorized_account(t.business_id)),
     -t.amount_cents);
end $$;

-- Backstop: whatever wrote them, a transaction's lines must balance by commit time.
create function private.check_transaction_balanced()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_sum numeric;
  v_count int;
begin
  if tg_table_name = 'transactions' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.transaction_id;
  else
    v_id := new.transaction_id;
  end if;
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_count
  from public.journal_lines where transaction_id = v_id;
  if v_sum <> 0 then
    raise exception 'Journal lines for transaction % sum to %, not 0', v_id, v_sum using errcode = '23514';
  end if;
  if v_count <> 2 and exists (select 1 from public.transactions where id = v_id) then
    raise exception 'Transaction % has % journal lines, expected 2', v_id, v_count using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function private.check_transaction_balanced();

create constraint trigger transactions_have_lines
  after insert or update on public.transactions
  deferrable initially deferred
  for each row execute function private.check_transaction_balanced();

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create function private.audit(
  p_business_id uuid, p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (business_id, actor, action, entity, entity_id, before, after)
  values (p_business_id, (select auth.uid()), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------------

-- Create a business with the caller as owner. The only way to insert a business.
create function public.create_business(
  p_name text,
  p_legal_name text default null,
  p_currency text default 'USD',
  p_fiscal_year_start_month smallint default 1,
  p_books_start_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sign in to create a business' using errcode = '42501';
  end if;
  insert into public.businesses (name, legal_name, currency, fiscal_year_start_month, books_start_date, created_by)
  values (btrim(p_name), nullif(btrim(p_legal_name), ''), p_currency, p_fiscal_year_start_month, p_books_start_date, v_user)
  returning id into v_id;
  insert into public.business_members (business_id, user_id, role) values (v_id, v_user, 'owner');
  perform private.seed_system_accounts(v_id);
  perform private.audit(v_id, 'create', 'businesses', v_id, null,
    (select to_jsonb(b) from public.businesses b where b.id = v_id));
  return v_id;
end $$;

create function public.post_transaction(
  p_business_id uuid,
  p_date date,
  p_money_account_id uuid,
  p_amount_cents bigint,
  p_description_raw text,
  p_category_account_id uuid default null,
  p_description_clean text default null,
  p_vendor_normalized text default null,
  p_memo text default null,
  p_reference text default null,
  p_source public.transaction_source default 'manual',
  p_import_batch_id uuid default null,
  p_dedupe_hash text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.transaction_kind;
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if p_date is null then
    raise exception 'Date is required' using errcode = '22004';
  end if;
  perform private.require_unlocked(p_business_id, p_date);
  v_kind := private.resolve_kind(p_business_id, p_money_account_id, p_category_account_id);

  insert into public.transactions (
    business_id, date, description_raw, description_clean, vendor_normalized, amount_cents,
    money_account_id, category_account_id, kind, memo, reference, source, import_batch_id,
    dedupe_hash, created_by
  ) values (
    p_business_id, p_date, p_description_raw, p_description_clean, p_vendor_normalized, p_amount_cents,
    p_money_account_id, p_category_account_id, v_kind, p_memo, p_reference, p_source, p_import_batch_id,
    p_dedupe_hash, (select auth.uid())
  ) returning id into v_id;

  perform private.post_lines(v_id);
  perform private.audit(p_business_id, 'create', 'transactions', v_id, null,
    (select to_jsonb(t) from public.transactions t where t.id = v_id));
  return v_id;
end $$;

-- Replace every editable field of a transaction (pass the current value for anything
-- unchanged) and repost its lines. source, import batch and created_by never change.
create function public.update_transaction(
  p_transaction_id uuid,
  p_date date,
  p_money_account_id uuid,
  p_amount_cents bigint,
  p_description_raw text,
  p_category_account_id uuid,
  p_description_clean text,
  p_vendor_normalized text,
  p_memo text,
  p_reference text,
  p_dedupe_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  old_t public.transactions;
  v_kind public.transaction_kind;
begin
  select * into old_t from public.transactions where id = p_transaction_id for update;
  if old_t.id is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(old_t.business_id, '{owner,editor}');
  if old_t.deleted_at is not null then
    raise exception 'Restore this transaction before editing it' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Date is required' using errcode = '22004';
  end if;
  perform private.require_unlocked(old_t.business_id, old_t.date);
  perform private.require_unlocked(old_t.business_id, p_date);
  -- Accounts archived after this was posted may stay on it.
  v_kind := private.resolve_kind(old_t.business_id, p_money_account_id, p_category_account_id,
    array_remove(array[old_t.money_account_id, old_t.category_account_id], null));

  update public.transactions set
    date = p_date,
    money_account_id = p_money_account_id,
    amount_cents = p_amount_cents,
    description_raw = p_description_raw,
    category_account_id = p_category_account_id,
    kind = v_kind,
    description_clean = p_description_clean,
    vendor_normalized = p_vendor_normalized,
    memo = p_memo,
    reference = p_reference,
    dedupe_hash = p_dedupe_hash
  where id = p_transaction_id;

  perform private.post_lines(p_transaction_id);
  perform private.audit(old_t.business_id, 'update', 'transactions', p_transaction_id, to_jsonb(old_t),
    (select to_jsonb(t) from public.transactions t where t.id = p_transaction_id));
  return p_transaction_id;
end $$;

-- Soft delete: the row and its lines stay; reports skip deleted_at rows.
create function public.soft_delete_transaction(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare old_t public.transactions;
begin
  select * into old_t from public.transactions where id = p_transaction_id for update;
  if old_t.id is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(old_t.business_id, '{owner,editor}');
  perform private.require_unlocked(old_t.business_id, old_t.date);
  if old_t.deleted_at is not null then
    return;
  end if;
  update public.transactions set deleted_at = now(), deleted_by = (select auth.uid())
  where id = p_transaction_id;
  perform private.audit(old_t.business_id, 'delete', 'transactions', p_transaction_id, to_jsonb(old_t),
    (select to_jsonb(t) from public.transactions t where t.id = p_transaction_id));
end $$;

create function public.restore_transaction(p_transaction_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare old_t public.transactions;
begin
  select * into old_t from public.transactions where id = p_transaction_id for update;
  if old_t.id is null then
    raise exception 'Transaction not found' using errcode = '42501';
  end if;
  perform private.require_role(old_t.business_id, '{owner,editor}');
  perform private.require_unlocked(old_t.business_id, old_t.date);
  if old_t.deleted_at is null then
    return;
  end if;
  update public.transactions set deleted_at = null, deleted_by = null
  where id = p_transaction_id;
  perform private.audit(old_t.business_id, 'restore', 'transactions', p_transaction_id, to_jsonb(old_t),
    (select to_jsonb(t) from public.transactions t where t.id = p_transaction_id));
end $$;

-- Categories and money accounts (SPEC Prompt 3): the standard chart, money accounts with
-- opening balances, archive/delete rules, and merging one category into another.
--
-- The seeded Checking, Savings, Cash, Credit Card and Loans Payable accounts are group
-- headers: money accounts the user adds nest under the matching one, and they can also be
-- picked as categories for accounts the user doesn't track separately. Categorizing to
-- one of those cash or card headers is a transfer, not income or expense.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.accounts
  -- Hidden accounts (Accounts Receivable in v1) stay off pickers and the categories page.
  add column is_hidden boolean not null default false,
  add column last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  add column opening_transaction_id uuid,
  add foreign key (business_id, opening_transaction_id) references public.transactions (business_id, id),
  add check (last4 is null or is_money_account),
  add check (opening_transaction_id is null or is_money_account);

-- Money-account kinds, and which subtypes make a category a transfer.
create function private.money_kind_type(p_kind text) returns public.account_type
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'checking' then 'asset' when 'savings' then 'asset' when 'cash' then 'asset'
    when 'credit_card' then 'liability' when 'loan' then 'liability'
  end::public.account_type
$$;

-- ---------------------------------------------------------------------------
-- Kind: categorizing to a cash/card header is a transfer too
-- ---------------------------------------------------------------------------
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
    when c.is_money_account or c.subtype in ('checking', 'savings', 'cash', 'credit_card') then 'transfer'
    else 'other'  -- Equipment, Loans Payable, Sales Tax Payable, ...
  end::public.transaction_kind;
end $$;

-- ---------------------------------------------------------------------------
-- The standard chart
-- ---------------------------------------------------------------------------
create or replace function private.seed_system_accounts(p_business_id uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into public.accounts (business_id, name, type, subtype, is_system, is_standard, description)
  values
    (p_business_id, 'Uncategorized', 'expense', 'uncategorized', true, true,
     'Holding account for transactions that have not been categorized yet.'),
    (p_business_id, 'Transfer Clearing', 'asset', 'transfer_clearing', true, true,
     'Holds a transfer between two accounts until both sides are recorded.'),
    (p_business_id, 'Retained Earnings', 'equity', 'retained_earnings', true, true,
     'Profit kept in the business from prior years. Calculated by reports, never picked as a category.')
  on conflict do nothing;
$$;

create or replace function private.seed_standard_chart(p_business_id uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into public.accounts (business_id, name, type, subtype, is_standard, is_hidden, description)
  select p_business_id, v.name, v.type::public.account_type, v.subtype, true, v.hidden, v.description
  from (values
    -- Income
    ('Sales', 'income', null, false, 'Revenue from selling products or goods.'),
    ('Service Revenue', 'income', null, false, 'Revenue from services, consulting or labor you provide.'),
    ('Interest Income', 'income', null, false, 'Interest earned on bank balances or on loans you have made.'),
    ('Other Income', 'income', null, false, 'Income that fits no other income category, such as rebates or one-off gains.'),
    ('Refunds & Returns', 'income', 'contra', false, 'Money refunded to customers for returns or cancellations; reduces income.'),
    -- Expense
    ('Advertising & Marketing', 'expense', null, false, 'Ads, promotions, sponsorships and marketing services.'),
    ('Bank Fees', 'expense', null, false, 'Account fees, wire fees, overdraft charges and card processing fees.'),
    ('Contractors', 'expense', null, false, 'Payments to independent contractors and freelancers (1099 workers).'),
    ('Insurance', 'expense', null, false, 'Business insurance premiums: liability, property, professional and similar.'),
    ('Meals', 'expense', null, false, 'Business meals with clients or staff, or while traveling for work.'),
    ('Office Supplies', 'expense', null, false, 'Paper, ink, small tools and other consumable office items.'),
    ('Professional Fees', 'expense', null, false, 'Accountants, lawyers, consultants and other professional services.'),
    ('Rent', 'expense', null, false, 'Rent or lease payments for office, retail, workshop or storage space.'),
    ('Repairs & Maintenance', 'expense', null, false, 'Repairs and upkeep of equipment, vehicles or premises.'),
    ('Software & Subscriptions', 'expense', null, false, 'SaaS tools, software licenses and online subscriptions.'),
    ('Travel', 'expense', null, false, 'Airfare, lodging, rideshare and other business travel costs, excluding meals.'),
    ('Utilities', 'expense', null, false, 'Electricity, water, gas, internet and phone service.'),
    ('Payroll', 'expense', null, false, 'Employee wages and salaries.'),
    ('Payroll Taxes', 'expense', null, false, 'Employer payroll taxes such as Social Security, Medicare and unemployment.'),
    ('Taxes & Licenses', 'expense', null, false, 'Business licenses, permits and business taxes other than payroll and income tax.'),
    ('Vehicle', 'expense', null, false, 'Fuel, parking, tolls, registration and other business vehicle costs.'),
    ('Shipping & Postage', 'expense', null, false, 'Shipping carriers, postage and delivery fees.'),
    ('Education', 'expense', null, false, 'Courses, training, books and conferences that build business skills.'),
    ('Other Expense', 'expense', null, false, 'Business expenses that fit no other expense category.'),
    -- Asset
    ('Checking', 'asset', 'checking', false, 'Business checking accounts; money moved here from another account is a transfer.'),
    ('Savings', 'asset', 'savings', false, 'Business savings accounts; money moved here is a transfer, not an expense.'),
    ('Cash', 'asset', 'cash', false, 'Cash on hand and petty cash.'),
    ('Equipment', 'asset', 'fixed_asset', false, 'Computers, machinery, furniture and other equipment kept for more than a year.'),
    ('Accounts Receivable', 'asset', 'receivable', true, 'Money customers owe you. Not used with cash-basis books.'),
    -- Liability
    ('Credit Card', 'liability', 'credit_card', false, 'Business credit cards; paying off the card is a transfer, not an expense.'),
    ('Loans Payable', 'liability', 'loan', false, 'Loans and lines of credit; principal payments reduce what you owe.'),
    ('Sales Tax Payable', 'liability', 'sales_tax', false, 'Sales tax collected from customers that you owe to the tax authority.'),
    -- Equity
    ('Owner Contributions', 'equity', 'contribution', false, 'Money the owner puts into the business.'),
    ('Owner Draws', 'equity', 'draw', false, 'Money the owner takes out of the business for personal use.'),
    ('Opening Balance Equity', 'equity', 'opening_balance', false, 'Offsets the opening balance of each money account when you start your books.')
  ) as v(name, type, subtype, hidden, description)
  on conflict do nothing;
$$;

-- Existing businesses get the chart too.
do $$
declare b uuid;
begin
  for b in select id from public.businesses loop
    perform private.seed_system_accounts(b);
    perform private.seed_standard_chart(b);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Account guards (replaces the Prompt 1 version)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user must be the caller's role, so writes through
-- the API (`authenticated`) can be told apart from the posting functions (table owner).
create or replace function private.guard_account() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  v_parent public.accounts;
  v_cursor uuid;
  v_depth int := 0;
  v_via_api boolean := current_user = 'authenticated';
begin
  if new.parent_id is not null then
    select * into v_parent from public.accounts where id = new.parent_id;
    if v_parent.type <> new.type then
      raise exception 'A % category cannot sit under a % category', new.type, v_parent.type using errcode = '23514';
    end if;
    if v_parent.is_money_account then
      raise exception 'Nothing can sit under a money account' using errcode = '23514';
    end if;
    if v_parent.is_system then
      raise exception 'Nothing can sit under a system account' using errcode = '23514';
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

  if tg_op = 'INSERT' then
    if v_via_api and (new.is_standard or new.is_hidden or new.is_money_account or new.opening_transaction_id is not null) then
      raise exception 'Add money accounts with create_money_account(); standard accounts come from the seed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if v_via_api and (new.is_standard, new.is_hidden, new.is_money_account, new.subtype, new.opening_transaction_id, new.business_id)
       is distinct from (old.is_standard, old.is_hidden, old.is_money_account, old.subtype, old.opening_transaction_id, old.business_id) then
    raise exception 'Those account fields cannot be changed directly' using errcode = '42501';
  end if;
  if (new.type, new.is_money_account) is distinct from (old.type, old.is_money_account)
     and exists (select 1 from public.journal_lines where account_id = old.id) then
    raise exception 'Cannot change the type of % after transactions have posted to it', old.name
      using errcode = '23514';
  end if;
  if old.subtype = 'opening_balance' and new.archived_at is not null then
    raise exception 'Opening Balance Equity is needed for opening balances and cannot be archived' using errcode = '23514';
  end if;
  return new;
end $$;

create function private.guard_account_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.subtype = 'opening_balance' and exists (select 1 from public.businesses where id = old.business_id) then
    raise exception 'Opening Balance Equity cannot be deleted' using errcode = '23514';
  end if;
  return old;
end $$;
create trigger guard_account_delete before delete on public.accounts
  for each row execute function private.guard_account_delete();

-- ---------------------------------------------------------------------------
-- Money accounts and opening balances
-- ---------------------------------------------------------------------------

-- Set, change or clear a money account's opening balance. The balance is entered the way
-- people read it: money in the account for checking/savings/cash, amount owed for cards
-- and loans. It posts as one transaction against Opening Balance Equity.
create function public.set_opening_balance(p_account_id uuid, p_balance_cents bigint, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.accounts;
  t public.transactions;
  v_obe uuid;
  v_amount bigint;
  v_date date;
begin
  select * into a from public.accounts where id = p_account_id;
  if a.id is null then
    raise exception 'Account not found' using errcode = '42501';
  end if;
  perform private.require_role(a.business_id, '{owner,editor}');
  if not a.is_money_account then
    raise exception '% is not a money account', a.name using errcode = '22023';
  end if;
  if p_balance_cents is null then
    raise exception 'Enter an opening balance (0 for none)' using errcode = '22004';
  end if;

  select id into v_obe from public.accounts
  where business_id = a.business_id and subtype = 'opening_balance' and archived_at is null;
  if v_obe is null then
    raise exception 'This business has no Opening Balance Equity account' using errcode = '23503';
  end if;

  v_amount := case when a.type = 'liability' then -p_balance_cents else p_balance_cents end;
  v_date := coalesce(p_date, (select books_start_date from public.businesses where id = a.business_id), current_date);
  select * into t from public.transactions where id = a.opening_transaction_id;

  if t.id is null then
    if v_amount = 0 then
      return null;
    end if;
    t.id := public.post_transaction(a.business_id, v_date, a.id, v_amount, 'Opening balance', v_obe);
    update public.accounts set opening_transaction_id = t.id where id = a.id;
    return t.id;
  end if;

  if v_amount = 0 then
    perform public.soft_delete_transaction(t.id);
    return t.id;
  end if;
  if t.deleted_at is not null then
    perform public.restore_transaction(t.id);
  end if;
  return public.update_transaction(t.id, v_date, a.id, v_amount, t.description_raw, v_obe,
    t.description_clean, t.vendor_normalized, t.memo, t.reference, t.dedupe_hash);
end $$;

-- Add a checking, savings, credit card, cash or loan account, with an optional opening
-- balance. It nests under the matching standard account (Checking, Credit Card, ...).
create function public.create_money_account(
  p_business_id uuid,
  p_name text,
  p_kind text,
  p_last4 text default null,
  p_opening_balance_cents bigint default 0,
  p_opening_date date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.account_type := private.money_kind_type(p_kind);
  v_parent uuid;
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner,editor}');
  if v_type is null then
    raise exception '"%" is not a money account type', p_kind using errcode = '22023';
  end if;
  select id into v_parent from public.accounts
  where business_id = p_business_id and is_standard and not is_money_account and subtype = p_kind;

  insert into public.accounts (business_id, name, type, subtype, parent_id, is_money_account, last4)
  values (p_business_id, btrim(p_name), v_type, p_kind, v_parent, true, nullif(btrim(p_last4), ''))
  returning id into v_id;
  perform private.audit(p_business_id, 'create', 'accounts', v_id, null,
    (select to_jsonb(a) from public.accounts a where a.id = v_id));

  if coalesce(p_opening_balance_cents, 0) <> 0 then
    perform public.set_opening_balance(v_id, p_opening_balance_cents, p_opening_date);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Merge one category into another
-- ---------------------------------------------------------------------------

-- Every transaction on p_from moves to p_into (deleted ones too, so a restore lands in
-- the right place), its journal lines repoint, rules and pending AI suggestions follow,
-- children are reparented, and p_from is archived. Returns how many transactions moved.
create function public.merge_category(p_from uuid, p_into uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  a public.accounts;
  b public.accounts;
  v_lock date;
  v_ids uuid[];
  v_kind public.transaction_kind;
begin
  select * into a from public.accounts where id = p_from;
  select * into b from public.accounts where id = p_into;
  if a.id is null or b.id is null or a.business_id <> b.business_id then
    raise exception 'Both categories must exist in the same business' using errcode = '42501';
  end if;
  perform private.require_role(a.business_id, '{owner,editor}');
  if a.id = b.id then
    raise exception 'Pick a different category to merge into' using errcode = '22023';
  end if;
  if a.is_system or b.is_system or a.is_money_account or b.is_money_account then
    raise exception 'System accounts and money accounts cannot be merged' using errcode = '22023';
  end if;
  if a.subtype = 'opening_balance' then
    raise exception 'Opening Balance Equity cannot be merged away' using errcode = '22023';
  end if;
  if a.type <> b.type then
    raise exception 'Merge into a category of the same type (% into %)', a.type, b.type using errcode = '22023';
  end if;
  if b.archived_at is not null then
    raise exception '% is archived; unarchive it first', b.name using errcode = '22023';
  end if;

  select lock_date into v_lock from public.businesses where id = a.business_id;
  if v_lock is not null and exists (
    select 1 from public.transactions where category_account_id = a.id and date <= v_lock) then
    raise exception '% has transactions on or before the lock date (%); they cannot move', a.name, v_lock
      using errcode = 'P0001', hint = 'locked_period';
  end if;

  perform 1 from public.transactions where category_account_id = a.id for update;
  select coalesce(array_agg(id), '{}') into v_ids
  from public.transactions where category_account_id = a.id;

  if cardinality(v_ids) > 0 then
    -- Same type, so every moved row gets the same kind; resolve it once.
    select private.resolve_kind(a.business_id, money_account_id, b.id, array[b.id]) into v_kind
    from public.transactions where id = v_ids[1];
    update public.transactions set category_account_id = b.id, kind = v_kind where id = any (v_ids);
    -- Repointing keeps every transaction's two lines and their amounts, so each still sums to 0.
    update public.journal_lines set account_id = b.id where transaction_id = any (v_ids) and account_id = a.id;
  end if;

  update public.category_rules set category_account_id = b.id where category_account_id = a.id;
  update public.ai_suggestions set category_account_id = b.id where category_account_id = a.id and status = 'pending';
  update public.accounts set parent_id = b.id where parent_id = a.id and id <> b.id;
  update public.accounts set archived_at = now() where id = a.id and archived_at is null;

  perform private.audit(a.business_id, 'merge', 'accounts', a.id,
    jsonb_build_object('from', a.id, 'from_name', a.name),
    jsonb_build_object('into', b.id, 'into_name', b.name, 'transaction_count', cardinality(v_ids),
                       'transaction_ids', to_jsonb(v_ids)));
  return cardinality(v_ids);
end $$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- What a category picker offers: active, visible, non-system accounts. Money accounts
-- are included (picking one makes a transfer); callers group by type.
create view public.category_picker with (security_invoker = true) as
select id, business_id, name, type, subtype, parent_id, description, is_money_account, is_standard
from public.accounts
where archived_at is null and not is_hidden and not is_system;

-- How much each account is used: decides whether it can be hard-deleted.
create view public.account_usage with (security_invoker = true) as
select
  a.id as account_id,
  a.business_id,
  (select count(*) from public.journal_lines jl where jl.account_id = a.id)::int as line_count,
  (select count(*) from public.accounts c where c.parent_id = a.id)::int as child_count,
  (select count(*) from public.category_rules r where r.category_account_id = a.id)::int as rule_count
from public.accounts a;

revoke all on public.category_picker, public.account_usage from anon;
grant select on public.category_picker, public.account_usage to authenticated;

revoke all on function public.set_opening_balance(uuid, bigint, date) from public, anon;
revoke all on function public.create_money_account(uuid, text, text, text, bigint, date) from public, anon;
revoke all on function public.merge_category(uuid, uuid) from public, anon;
revoke all on function private.money_kind_type(text) from public;
grant execute on function
  public.set_opening_balance(uuid, bigint, date),
  public.create_money_account(uuid, text, text, text, bigint, date),
  public.merge_category(uuid, uuid)
to authenticated;

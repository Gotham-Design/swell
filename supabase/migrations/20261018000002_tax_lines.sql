-- Tax-line mapping (SPEC open question 3). A tax accountant pulls numbers from Quick
-- Acct and files elsewhere, so each category can point at the line of the business's
-- return it belongs on. Defaults cover the P&L lines of the 2025 Schedule C and
-- Form 1120-S (verified against the IRS PDFs); the accountant adjusts the rest.

-- ---------------------------------------------------------------------------
-- Reference data: the lines themselves (not business data, same for everyone)
-- ---------------------------------------------------------------------------
create table public.tax_lines (
  id text primary key,
  form text not null check (form in ('schedule_c', 'form_1120s')),
  tax_year smallint not null,
  line text not null,
  label text not null,
  sort smallint not null,
  unique (id, form)
);
alter table public.tax_lines enable row level security;
create policy "anyone signed in reads" on public.tax_lines for select to authenticated using (true);
revoke all on public.tax_lines from anon;
revoke insert, update, delete, truncate, references, trigger on public.tax_lines from authenticated;

insert into public.tax_lines (id, form, tax_year, line, label, sort) values
  -- Schedule C (Form 1040), 2025
  ('sch_c:1',   'schedule_c', 2025, '1',   'Gross receipts or sales', 10),
  ('sch_c:2',   'schedule_c', 2025, '2',   'Returns and allowances', 20),
  ('sch_c:4',   'schedule_c', 2025, '4',   'Cost of goods sold (Part III)', 40),
  ('sch_c:6',   'schedule_c', 2025, '6',   'Other income', 60),
  ('sch_c:8',   'schedule_c', 2025, '8',   'Advertising', 80),
  ('sch_c:9',   'schedule_c', 2025, '9',   'Car and truck expenses', 90),
  ('sch_c:10',  'schedule_c', 2025, '10',  'Commissions and fees', 100),
  ('sch_c:11',  'schedule_c', 2025, '11',  'Contract labor', 110),
  ('sch_c:12',  'schedule_c', 2025, '12',  'Depletion', 120),
  ('sch_c:13',  'schedule_c', 2025, '13',  'Depreciation and section 179 expense', 130),
  ('sch_c:14',  'schedule_c', 2025, '14',  'Employee benefit programs', 140),
  ('sch_c:15',  'schedule_c', 2025, '15',  'Insurance (other than health)', 150),
  ('sch_c:16a', 'schedule_c', 2025, '16a', 'Interest: mortgage (paid to banks, etc.)', 160),
  ('sch_c:16b', 'schedule_c', 2025, '16b', 'Interest: other', 161),
  ('sch_c:17',  'schedule_c', 2025, '17',  'Legal and professional services', 170),
  ('sch_c:18',  'schedule_c', 2025, '18',  'Office expense', 180),
  ('sch_c:19',  'schedule_c', 2025, '19',  'Pension and profit-sharing plans', 190),
  ('sch_c:20a', 'schedule_c', 2025, '20a', 'Rent or lease: vehicles, machinery, and equipment', 200),
  ('sch_c:20b', 'schedule_c', 2025, '20b', 'Rent or lease: other business property', 201),
  ('sch_c:21',  'schedule_c', 2025, '21',  'Repairs and maintenance', 210),
  ('sch_c:22',  'schedule_c', 2025, '22',  'Supplies (not included in Part III)', 220),
  ('sch_c:23',  'schedule_c', 2025, '23',  'Taxes and licenses', 230),
  ('sch_c:24a', 'schedule_c', 2025, '24a', 'Travel', 240),
  ('sch_c:24b', 'schedule_c', 2025, '24b', 'Deductible meals', 241),
  ('sch_c:25',  'schedule_c', 2025, '25',  'Utilities', 250),
  ('sch_c:26',  'schedule_c', 2025, '26',  'Wages (less employment credits)', 260),
  ('sch_c:27a', 'schedule_c', 2025, '27a', 'Energy efficient commercial buildings deduction', 270),
  ('sch_c:27b', 'schedule_c', 2025, '27b', 'Other expenses (Part V)', 271),
  ('sch_c:30',  'schedule_c', 2025, '30',  'Business use of home', 300),
  -- Form 1120-S, 2025: page 1, plus the Schedule K lines bookkeeping commonly feeds
  ('f1120s:1a',  'form_1120s', 2025, '1a',  'Gross receipts or sales', 10),
  ('f1120s:1b',  'form_1120s', 2025, '1b',  'Returns and allowances', 11),
  ('f1120s:2',   'form_1120s', 2025, '2',   'Cost of goods sold (Form 1125-A)', 20),
  ('f1120s:4',   'form_1120s', 2025, '4',   'Net gain (loss) from Form 4797', 40),
  ('f1120s:5',   'form_1120s', 2025, '5',   'Other income (loss)', 50),
  ('f1120s:7',   'form_1120s', 2025, '7',   'Compensation of officers', 70),
  ('f1120s:8',   'form_1120s', 2025, '8',   'Salaries and wages (less employment credits)', 80),
  ('f1120s:9',   'form_1120s', 2025, '9',   'Repairs and maintenance', 90),
  ('f1120s:10',  'form_1120s', 2025, '10',  'Bad debts', 100),
  ('f1120s:11',  'form_1120s', 2025, '11',  'Rents', 110),
  ('f1120s:12',  'form_1120s', 2025, '12',  'Taxes and licenses', 120),
  ('f1120s:13',  'form_1120s', 2025, '13',  'Interest', 130),
  ('f1120s:14',  'form_1120s', 2025, '14',  'Depreciation', 140),
  ('f1120s:15',  'form_1120s', 2025, '15',  'Depletion', 150),
  ('f1120s:16',  'form_1120s', 2025, '16',  'Advertising', 160),
  ('f1120s:17',  'form_1120s', 2025, '17',  'Pension, profit-sharing, etc., plans', 170),
  ('f1120s:18',  'form_1120s', 2025, '18',  'Employee benefit programs', 180),
  ('f1120s:19',  'form_1120s', 2025, '19',  'Energy efficient commercial buildings deduction', 190),
  ('f1120s:20',  'form_1120s', 2025, '20',  'Other deductions (attach statement)', 200),
  ('f1120s:k4',  'form_1120s', 2025, 'Sch K 4',   'Interest income', 400),
  ('f1120s:k5a', 'form_1120s', 2025, 'Sch K 5a',  'Ordinary dividends', 410),
  ('f1120s:k12a','form_1120s', 2025, 'Sch K 12a', 'Charitable contributions', 420),
  ('f1120s:k16c','form_1120s', 2025, 'Sch K 16c', 'Nondeductible expenses', 430),
  ('f1120s:k16d','form_1120s', 2025, 'Sch K 16d', 'Distributions', 440);

-- ---------------------------------------------------------------------------
-- Which return a business files, and each category's line on it
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column tax_form text check (tax_form in ('schedule_c', 'form_1120s'));

-- One row per category per form, so switching the business's form keeps both mappings.
create table public.account_tax_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  account_id uuid not null,
  form text not null,
  tax_line_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, form),
  foreign key (business_id, account_id) references public.accounts (business_id, id) on delete cascade,
  -- The line must belong to the same form.
  foreign key (tax_line_id, form) references public.tax_lines (id, form)
);
create index account_tax_lines_business_idx on public.account_tax_lines (business_id, form);
create trigger touch_updated_at before update on public.account_tax_lines
  for each row execute function private.touch_updated_at();

alter table public.account_tax_lines enable row level security;
revoke all on public.account_tax_lines from anon;
revoke truncate, references, trigger on public.account_tax_lines from authenticated;
create policy "members read" on public.account_tax_lines for select to authenticated
  using (private.has_role(business_id));
create policy "writers insert" on public.account_tax_lines for insert to authenticated
  with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers update" on public.account_tax_lines for update to authenticated
  using (private.has_role(business_id, '{owner,editor}')) with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers delete" on public.account_tax_lines for delete to authenticated
  using (private.has_role(business_id, '{owner,editor}'));

-- ---------------------------------------------------------------------------
-- Defaults for the standard chart (by the seeded name; mappings survive renames)
-- ---------------------------------------------------------------------------
create function private.seed_tax_lines(p_business_id uuid)
returns void
language sql security definer set search_path = '' as $$
  insert into public.account_tax_lines (business_id, account_id, form, tax_line_id)
  select a.business_id, a.id, m.form, m.line
  from (values
    ('Sales', 'schedule_c', 'sch_c:1'),                  ('Sales', 'form_1120s', 'f1120s:1a'),
    ('Service Revenue', 'schedule_c', 'sch_c:1'),        ('Service Revenue', 'form_1120s', 'f1120s:1a'),
    ('Refunds & Returns', 'schedule_c', 'sch_c:2'),      ('Refunds & Returns', 'form_1120s', 'f1120s:1b'),
    ('Other Income', 'schedule_c', 'sch_c:6'),           ('Other Income', 'form_1120s', 'f1120s:5'),
    ('Interest Income', 'form_1120s', 'f1120s:k4'),
    ('Advertising & Marketing', 'schedule_c', 'sch_c:8'),('Advertising & Marketing', 'form_1120s', 'f1120s:16'),
    ('Bank Fees', 'schedule_c', 'sch_c:27b'),            ('Bank Fees', 'form_1120s', 'f1120s:20'),
    ('Contractors', 'schedule_c', 'sch_c:11'),           ('Contractors', 'form_1120s', 'f1120s:20'),
    ('Insurance', 'schedule_c', 'sch_c:15'),             ('Insurance', 'form_1120s', 'f1120s:20'),
    ('Meals', 'schedule_c', 'sch_c:24b'),                ('Meals', 'form_1120s', 'f1120s:20'),
    ('Office Supplies', 'schedule_c', 'sch_c:18'),       ('Office Supplies', 'form_1120s', 'f1120s:20'),
    ('Professional Fees', 'schedule_c', 'sch_c:17'),     ('Professional Fees', 'form_1120s', 'f1120s:20'),
    ('Rent', 'schedule_c', 'sch_c:20b'),                 ('Rent', 'form_1120s', 'f1120s:11'),
    ('Repairs & Maintenance', 'schedule_c', 'sch_c:21'), ('Repairs & Maintenance', 'form_1120s', 'f1120s:9'),
    ('Software & Subscriptions', 'schedule_c', 'sch_c:27b'), ('Software & Subscriptions', 'form_1120s', 'f1120s:20'),
    ('Travel', 'schedule_c', 'sch_c:24a'),               ('Travel', 'form_1120s', 'f1120s:20'),
    ('Utilities', 'schedule_c', 'sch_c:25'),             ('Utilities', 'form_1120s', 'f1120s:20'),
    ('Payroll', 'schedule_c', 'sch_c:26'),               ('Payroll', 'form_1120s', 'f1120s:8'),
    ('Payroll Taxes', 'schedule_c', 'sch_c:23'),         ('Payroll Taxes', 'form_1120s', 'f1120s:12'),
    ('Taxes & Licenses', 'schedule_c', 'sch_c:23'),      ('Taxes & Licenses', 'form_1120s', 'f1120s:12'),
    ('Vehicle', 'schedule_c', 'sch_c:9'),                ('Vehicle', 'form_1120s', 'f1120s:20'),
    ('Shipping & Postage', 'schedule_c', 'sch_c:27b'),   ('Shipping & Postage', 'form_1120s', 'f1120s:20'),
    ('Education', 'schedule_c', 'sch_c:27b'),            ('Education', 'form_1120s', 'f1120s:20'),
    ('Other Expense', 'schedule_c', 'sch_c:27b'),        ('Other Expense', 'form_1120s', 'f1120s:20'),
    ('Owner Draws', 'form_1120s', 'f1120s:k16d')
  ) as m(name, form, line)
  join public.accounts a on a.business_id = p_business_id and a.is_standard and a.name = m.name
  on conflict (account_id, form) do nothing;
$$;
revoke all on function private.seed_tax_lines(uuid) from public;

create or replace function public.create_business(
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
  values (btrim(p_name), nullif(btrim(p_legal_name), ''), upper(btrim(p_currency)), p_fiscal_year_start_month,
          p_books_start_date, v_user)
  returning id into v_id;
  insert into public.business_members (business_id, user_id, role) values (v_id, v_user, 'owner');
  perform private.seed_system_accounts(v_id);
  perform private.seed_standard_chart(v_id);
  perform private.seed_tax_lines(v_id);
  perform private.audit(v_id, 'create', 'businesses', v_id, null,
    (select to_jsonb(b) from public.businesses b where b.id = v_id));
  return v_id;
end $$;

do $$
declare b uuid;
begin
  for b in select id from public.businesses loop
    perform private.seed_tax_lines(b);
  end loop;
end $$;

-- Recurring statement requests: every month, on the day the accountant picks, the client is
-- emailed a fresh private upload link (a statement_requests row) for last month's statements.
-- Nothing is sent once those statements are in the books (every requested account's imports
-- reach the month's last day) or the client has sent files for it. If they haven't, a
-- reminder goes a week later, at most twice. Sent by the `statement-schedule` server job.

create table public.statement_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_email text not null check (client_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(client_email) <= 254),
  from_name text not null check (length(btrim(from_name)) between 1 and 120),
  note text check (note is null or length(note) <= 1000),
  -- Money accounts asked for; empty = every active money account.
  account_ids uuid[] not null default '{}',
  day_of_month smallint not null default 5 check (day_of_month between 1 and 28),
  active boolean not null default true,
  next_send_on date not null,
  -- The statement month being asked for (first day), and emails sent for it so far.
  period_month date,
  sends_in_period smallint not null default 0,
  last_sent_at timestamptz,
  last_request_id uuid,
  last_error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, last_request_id) references public.statement_requests (business_id, id) on delete set null (last_request_id)
);
create index statement_schedules_business_idx on public.statement_schedules (business_id);
create index statement_schedules_due_idx on public.statement_schedules (next_send_on) where active;
create index statement_schedules_request_idx on public.statement_schedules (business_id, last_request_id);
create trigger touch_updated_at before update on public.statement_schedules
  for each row execute function private.touch_updated_at();

alter table public.statement_schedules enable row level security;
revoke all on public.statement_schedules from anon;
revoke truncate, references, trigger on public.statement_schedules from authenticated;
create policy "writers read" on public.statement_schedules for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers insert" on public.statement_schedules for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers update" on public.statement_schedules for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')))
  with check (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers delete" on public.statement_schedules for delete to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')));
-- People change what is asked and when; the send bookkeeping belongs to the server job.
revoke insert, update on public.statement_schedules from authenticated;
grant insert (business_id, client_email, from_name, note, account_ids, day_of_month, active, next_send_on)
  on public.statement_schedules to authenticated;
grant update (client_email, from_name, note, account_ids, day_of_month, active, next_send_on)
  on public.statement_schedules to authenticated;

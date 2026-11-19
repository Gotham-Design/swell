-- Import mapping templates (SPEC Prompt 6): a saved column mapping per money account and
-- CSV layout (header signature), applied automatically when the same layout comes back.

create table public.import_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  money_account_id uuid not null,
  -- Normalized header names joined with "|" (see headerSignature in src/lib/import/parse.ts).
  header_signature text not null check (length(header_signature) between 1 and 4000),
  -- Column indexes, date format, amount mode and sign convention (Mapping in src/lib/import/mapping.ts).
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (money_account_id, header_signature),
  foreign key (business_id, money_account_id) references public.accounts (business_id, id) on delete cascade
);
create trigger touch_updated_at before update on public.import_templates
  for each row execute function private.touch_updated_at();

-- Templates belong to money accounts only.
create function private.guard_import_template() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.accounts where id = new.money_account_id and is_money_account) then
    raise exception 'Import templates belong to a money account' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_import_template before insert or update on public.import_templates
  for each row execute function private.guard_import_template();

alter table public.import_templates enable row level security;
revoke all on public.import_templates from anon;
revoke truncate, references, trigger on public.import_templates from authenticated;
create policy "members read" on public.import_templates for select to authenticated
  using (private.has_role(business_id));
create policy "writers insert" on public.import_templates for insert to authenticated
  with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers update" on public.import_templates for update to authenticated
  using (private.has_role(business_id, '{owner,editor}')) with check (private.has_role(business_id, '{owner,editor}'));
create policy "writers delete" on public.import_templates for delete to authenticated
  using (private.has_role(business_id, '{owner,editor}'));

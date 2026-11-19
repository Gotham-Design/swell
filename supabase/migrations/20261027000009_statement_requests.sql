-- Statement requests: an accountant sends a client a private link; the client uploads statement
-- files without an account; the files wait, private, until the accountant imports them.
--
-- statement_requests  one link. Only a SHA-256 hash of its token is stored; the link itself is
--                     shown once. Expires (default 14 days) and can be revoked.
-- statement_uploads   one file a client sent. Rows are written only by the upload server job
--                     (service role, `statement-request`); members read them and mark them
--                     imported or deleted.
-- Storage bucket `client-statements` (private): objects live under <business_id>/<request_id>/.
-- Owners and editors of that business may read and delete them; nobody else can list or read.

create table public.statement_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Shown to the client: who is asking ("Jordan at Mainland Bookkeeping").
  from_name text not null check (length(btrim(from_name)) between 1 and 120),
  note text check (note is null or length(note) <= 1000),
  -- Money accounts the accountant asked for (shown to the client by name and last 4).
  account_ids uuid[] not null default '{}',
  expires_at timestamptz not null default now() + interval '14 days',
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (expires_at <= created_at + interval '60 days')
);
create index statement_requests_business_idx on public.statement_requests (business_id, created_at desc);
create trigger touch_updated_at before update on public.statement_requests
  for each row execute function private.touch_updated_at();

create table public.statement_uploads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  request_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 255),
  file_size_bytes integer not null check (file_size_bytes between 1 and 10485760),
  content_type text not null check (content_type in ('application/pdf', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  storage_path text not null unique,
  uploaded_at timestamptz not null default now(),
  import_batch_id uuid,
  imported_at timestamptz,
  -- Set when the file is removed from storage (after import, or deleted by the accountant).
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, request_id) references public.statement_requests (business_id, id) on delete cascade,
  foreign key (business_id, import_batch_id) references public.import_batches (business_id, id) on delete set null (import_batch_id)
);
create index statement_uploads_business_idx on public.statement_uploads (business_id, uploaded_at desc);
create index statement_uploads_request_idx on public.statement_uploads (business_id, request_id);
create index statement_uploads_batch_idx on public.statement_uploads (business_id, import_batch_id);
create trigger touch_updated_at before update on public.statement_uploads
  for each row execute function private.touch_updated_at();

alter table public.statement_requests enable row level security;
alter table public.statement_uploads enable row level security;
revoke all on public.statement_requests, public.statement_uploads from anon;
revoke truncate, references, trigger on public.statement_requests, public.statement_uploads from authenticated;

create policy "writers read" on public.statement_requests for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers insert" on public.statement_requests for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers update" on public.statement_requests for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')))
  with check (business_id in (select private.my_business_ids('{owner,editor}')));

-- Uploads: read and mark (imported / deleted) by owners and editors; inserted only by the server job.
create policy "writers read" on public.statement_uploads for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')));
create policy "writers update" on public.statement_uploads for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,editor}')))
  with check (business_id in (select private.my_business_ids('{owner,editor}')));
revoke insert, delete on public.statement_uploads from authenticated;
-- Only the bookkeeping columns change after upload.
revoke update on public.statement_uploads from authenticated;
grant update (import_batch_id, imported_at, deleted_at) on public.statement_uploads to authenticated;
-- A request's token, business and creator never change; revoking is the only edit.
revoke update on public.statement_requests from authenticated;
grant update (revoked_at) on public.statement_requests to authenticated;

-- Private bucket and its policies (only where Supabase Storage exists; plain-Postgres test runs skip it).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('client-statements', 'client-statements', false, 10485760,
      array['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do nothing;
    execute $p$
      create policy "client statements: writers read" on storage.objects for select to authenticated
      using (bucket_id = 'client-statements'
             and (storage.foldername(name))[1] in (select b::text from private.my_business_ids('{owner,editor}') b))
    $p$;
    execute $p$
      create policy "client statements: writers delete" on storage.objects for delete to authenticated
      using (bucket_id = 'client-statements'
             and (storage.foldername(name))[1] in (select b::text from private.my_business_ids('{owner,editor}') b))
    $p$;
  end if;
end $$;

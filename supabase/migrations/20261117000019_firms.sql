-- Firms: an accounting practice above its clients. Every business belongs to a firm. The
-- firm's admins manage its people; each person is an admin (owner of every client) or staff
-- (every client, or only the ones picked), who can edit or only view.
--
-- Firm access is written into business_members (business_members.firm_id = the firm that
-- granted it) by private.sync_firm_access, so every policy, has_role and my_business_ids work
-- unchanged. For a firm's own people on the firm's clients, the firm decides: their rows are
-- added, changed and removed by the sync (removing someone from the firm takes away every
-- client). Direct members who aren't in the firm (a client's own owner, invited on the
-- client's Settings page) are left alone.

create type public.firm_role as enum ('admin', 'staff');

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger touch_updated_at before update on public.firms
  for each row execute function private.touch_updated_at();

create table public.firm_members (
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.firm_role not null,
  -- Staff only: every client, or the ones in firm_member_clients.
  all_clients boolean not null default true,
  -- Staff only: what they can do on their clients (admins are owners).
  client_role public.member_role not null default 'editor' check (client_role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);
create index firm_members_user_idx on public.firm_members (user_id);
create trigger touch_updated_at before update on public.firm_members
  for each row execute function private.touch_updated_at();

alter table public.businesses add column firm_id uuid references public.firms (id) on delete restrict;
create index businesses_firm_idx on public.businesses (firm_id);
alter table public.business_members add column firm_id uuid references public.firms (id) on delete cascade;
create index business_members_firm_idx on public.business_members (firm_id) where firm_id is not null;

create table public.firm_member_clients (
  firm_id uuid not null,
  user_id uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  primary key (firm_id, user_id, business_id),
  foreign key (firm_id, user_id) references public.firm_members (firm_id, user_id) on delete cascade
);
create index firm_member_clients_business_idx on public.firm_member_clients (business_id);

create table public.firm_invites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.firm_role not null,
  all_clients boolean not null default true,
  client_role public.member_role not null default 'editor' check (client_role in ('editor', 'viewer')),
  business_ids uuid[] not null default '{}',
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index firm_invites_pending_key on public.firm_invites (firm_id, email) where accepted_at is null;
create index firm_invites_email_idx on public.firm_invites (email) where accepted_at is null;
create trigger touch_updated_at before update on public.firm_invites
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who's in which firm
-- ---------------------------------------------------------------------------
create function private.my_firm_ids(p_roles public.firm_role[] default '{admin,staff}')
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select firm_id from public.firm_members where user_id = (select auth.uid()) and role = any (p_roles)
$$;
revoke all on function private.my_firm_ids(public.firm_role[]) from public;
grant execute on function private.my_firm_ids(public.firm_role[]) to authenticated;

create function private.require_firm_admin(p_firm_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.firm_members where firm_id = p_firm_id and user_id = (select auth.uid()) and role = 'admin') then
    raise exception 'Only firm admins can manage the team' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_firm_admin(uuid) from public;

-- ---------------------------------------------------------------------------
-- The sync: firm membership -> business_members
-- ---------------------------------------------------------------------------
-- Who the firm gives which client, and as what.
create function private.firm_access_wanted(p_firm_id uuid)
returns table (business_id uuid, user_id uuid, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select b.id, m.user_id, case when m.role = 'admin' then 'owner'::public.member_role else m.client_role end
  from public.firm_members m
  join public.businesses b on b.firm_id = m.firm_id
  where m.firm_id = p_firm_id
    and (m.role = 'admin' or m.all_clients
         or exists (select 1 from public.firm_member_clients c
                    where c.firm_id = m.firm_id and c.user_id = m.user_id and c.business_id = b.id))
$$;
revoke all on function private.firm_access_wanted(uuid) from public;

create function private.sync_firm_access(p_firm_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_firm_id is null then return; end if;
  -- Add and change first, so a client never passes through having no owner.
  insert into public.business_members (business_id, user_id, role, firm_id)
  select w.business_id, w.user_id, w.role, p_firm_id from private.firm_access_wanted(p_firm_id) w
  on conflict (business_id, user_id) do update
    set role = excluded.role, firm_id = excluded.firm_id
    where business_members.role is distinct from excluded.role or business_members.firm_id is distinct from excluded.firm_id;
  -- Then take away what the firm no longer grants: rows it granted, and any row a firm
  -- member holds on a firm client.
  delete from public.business_members bm
  where (bm.firm_id = p_firm_id
         or (bm.business_id in (select id from public.businesses where firm_id = p_firm_id)
             and bm.user_id in (select user_id from public.firm_members where firm_id = p_firm_id)))
    and not exists (select 1 from private.firm_access_wanted(p_firm_id) w
                    where w.business_id = bm.business_id and w.user_id = bm.user_id);
end $$;
revoke all on function private.sync_firm_access(uuid) from public;

create function private.firm_access_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.sync_firm_access(old.firm_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.firm_id is distinct from old.firm_id) then
    perform private.sync_firm_access(new.firm_id);
  end if;
  return null;
end $$;
revoke all on function private.firm_access_changed() from public;
create trigger sync_access after insert or update or delete on public.firm_members
  for each row execute function private.firm_access_changed();
create trigger sync_access after insert or update or delete on public.firm_member_clients
  for each row execute function private.firm_access_changed();

-- A firm member leaving takes away every client of that firm, including clients they made.
create function private.firm_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.business_members
  where user_id = old.user_id and business_id in (select id from public.businesses where firm_id = old.firm_id);
  return null;
end $$;
revoke all on function private.firm_member_left() from public;
create trigger member_left after delete on public.firm_members
  for each row execute function private.firm_member_left();

-- A new client joins its creator's firm (a new firm if they have none yet). Access is
-- synced at commit, after create_business has added its creator as owner; staff who see
-- only picked clients get the one they made.
create function private.business_firm_default() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coalesce(new.created_by, (select auth.uid()));
begin
  if new.firm_id is null and v_user is not null then
    select firm_id into new.firm_id from public.firm_members where user_id = v_user
    order by (role = 'admin') desc, created_at limit 1;
    if new.firm_id is null then
      insert into public.firms (name, created_by) values ('My firm', v_user) returning id into new.firm_id;
      insert into public.firm_members (firm_id, user_id, role) values (new.firm_id, v_user, 'admin');
    end if;
  end if;
  return new;
end $$;
revoke all on function private.business_firm_default() from public;
create trigger firm_default before insert on public.businesses
  for each row execute function private.business_firm_default();

create function private.business_firm_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := coalesce(new.created_by, (select auth.uid()));
begin
  if not exists (select 1 from public.businesses where id = new.id) then return null; end if;
  insert into public.firm_member_clients (firm_id, user_id, business_id)
  select m.firm_id, m.user_id, new.id from public.firm_members m
  where m.firm_id = new.firm_id and m.user_id = v_user and m.role = 'staff' and not m.all_clients
  on conflict do nothing;
  perform private.sync_firm_access(new.firm_id);
  return null;
end $$;
revoke all on function private.business_firm_sync() from public;
create constraint trigger firm_sync after insert on public.businesses
  deferrable initially deferred for each row execute function private.business_firm_sync();

-- A client stays in its firm unless a firm function moves it.
create function private.guard_business_firm() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.firm_id is distinct from old.firm_id and coalesce(current_setting('quickacct.firm_write', true), '') <> 'on' then
    raise exception 'A client''s firm can''t be changed here' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_business_firm() from public;
create trigger guard_firm before update on public.businesses
  for each row execute function private.guard_business_firm();
create trigger sync_access after update of firm_id on public.businesses
  for each row execute function private.firm_access_changed();

-- ---------------------------------------------------------------------------
-- Backfill: each existing creator gets a firm with the clients they made.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_firm uuid;
begin
  perform set_config('quickacct.firm_write', 'on', true);
  for r in select distinct created_by from public.businesses where firm_id is null and created_by is not null loop
    insert into public.firms (name, created_by) values ('My firm', r.created_by) returning id into v_firm;
    insert into public.firm_members (firm_id, user_id, role) values (v_firm, r.created_by, 'admin');
    update public.businesses set firm_id = v_firm where created_by = r.created_by and firm_id is null;
  end loop;
  perform set_config('quickacct.firm_write', 'off', true);
end $$;

-- ---------------------------------------------------------------------------
-- RLS: firm people see their firm and each other; admins see invites. Writes go through
-- the functions below.
-- ---------------------------------------------------------------------------
alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.firm_member_clients enable row level security;
alter table public.firm_invites enable row level security;
revoke all on public.firms, public.firm_members, public.firm_member_clients, public.firm_invites from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.firms, public.firm_members, public.firm_member_clients, public.firm_invites from authenticated;
create policy "members read" on public.firms for select to authenticated using (id in (select private.my_firm_ids()));
create policy "members read" on public.firm_members for select to authenticated using (firm_id in (select private.my_firm_ids()));
create policy "members read" on public.firm_member_clients for select to authenticated using (firm_id in (select private.my_firm_ids()));
create policy "admins read" on public.firm_invites for select to authenticated using (firm_id in (select private.my_firm_ids('{admin}')));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
create function private.check_staff_clients(p_firm_id uuid, p_business_ids uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(coalesce(p_business_ids, '{}')) b(id)
             where not exists (select 1 from public.businesses x where x.id = b.id and x.firm_id = p_firm_id)) then
    raise exception 'Pick clients from this firm' using errcode = '22023';
  end if;
end $$;
revoke all on function private.check_staff_clients(uuid, uuid[]) from public;

-- My firms, with my role in each.
create function public.my_firms()
returns table (firm_id uuid, name text, role public.firm_role)
language sql stable security invoker set search_path = '' as $$
  select f.id, f.name, m.role from public.firms f join public.firm_members m on m.firm_id = f.id and m.user_id = (select auth.uid())
  order by (m.role = 'admin') desc, f.created_at
$$;

create function public.rename_firm(p_firm_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_firm_admin(p_firm_id);
  if nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 120 then
    raise exception 'Give the firm a name' using errcode = '22023';
  end if;
  update public.firms set name = btrim(p_name) where id = p_firm_id;
end $$;

-- People in a firm, with their emails and the clients staff can see.
create function public.firm_member_list(p_firm_id uuid)
returns table (user_id uuid, email text, role public.firm_role, all_clients boolean, client_role public.member_role,
  business_ids uuid[], joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_firm_id not in (select private.my_firm_ids()) then
    raise exception 'Not a member of this firm' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.all_clients, m.client_role,
      coalesce((select array_agg(c.business_id) from public.firm_member_clients c where c.firm_id = m.firm_id and c.user_id = m.user_id), '{}'),
      m.created_at
    from public.firm_members m join auth.users u on u.id = m.user_id
    where m.firm_id = p_firm_id
    order by m.role, u.email;
end $$;

-- Invite someone to the firm. Re-inviting a pending address updates the invite.
create function public.invite_firm_member(p_firm_id uuid, p_email text, p_role public.firm_role,
  p_all_clients boolean default true, p_client_role public.member_role default 'editor', p_business_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  perform private.require_firm_admin(p_firm_id);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" is not an email address', p_email using errcode = '22023';
  end if;
  if p_client_role not in ('editor', 'viewer') then raise exception 'Pick edit or view only' using errcode = '22023'; end if;
  if exists (select 1 from public.firm_members m join auth.users u on u.id = m.user_id
             where m.firm_id = p_firm_id and lower(u.email) = v_email) then
    raise exception '% is already on the team', v_email using errcode = '23505';
  end if;
  perform private.check_staff_clients(p_firm_id, p_business_ids);
  if p_role = 'staff' and not p_all_clients and cardinality(coalesce(p_business_ids, '{}')) = 0 then
    raise exception 'Pick at least one client' using errcode = '22023';
  end if;
  insert into public.firm_invites (firm_id, email, role, all_clients, client_role, business_ids, invited_by)
  values (p_firm_id, v_email, p_role, p_role = 'admin' or p_all_clients, p_client_role,
    case when p_role = 'admin' or p_all_clients then '{}' else p_business_ids end, (select auth.uid()))
  on conflict (firm_id, email) where accepted_at is null
  do update set role = excluded.role, all_clients = excluded.all_clients, client_role = excluded.client_role,
    business_ids = excluded.business_ids, invited_by = excluded.invited_by, expires_at = now() + interval '14 days'
  returning id into v_id;
  return v_id;
end $$;

create function public.cancel_firm_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_firm uuid;
begin
  select firm_id into v_firm from public.firm_invites where id = p_invite_id and accepted_at is null;
  if v_firm is null then return; end if;
  perform private.require_firm_admin(v_firm);
  delete from public.firm_invites where id = p_invite_id;
end $$;

-- Change someone's role or clients. A firm keeps at least one admin.
create function public.update_firm_member(p_firm_id uuid, p_user_id uuid, p_role public.firm_role,
  p_all_clients boolean, p_client_role public.member_role, p_business_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_firm_admin(p_firm_id);
  if not exists (select 1 from public.firm_members where firm_id = p_firm_id and user_id = p_user_id) then
    raise exception 'They''re not on this team' using errcode = '23503';
  end if;
  if p_client_role not in ('editor', 'viewer') then raise exception 'Pick edit or view only' using errcode = '22023'; end if;
  if p_role <> 'admin' and not exists (select 1 from public.firm_members
      where firm_id = p_firm_id and role = 'admin' and user_id <> p_user_id) then
    raise exception 'The firm needs at least one admin' using errcode = '23514';
  end if;
  perform private.check_staff_clients(p_firm_id, p_business_ids);
  if p_role = 'staff' and not p_all_clients and cardinality(coalesce(p_business_ids, '{}')) = 0 then
    raise exception 'Pick at least one client' using errcode = '22023';
  end if;
  delete from public.firm_member_clients where firm_id = p_firm_id and user_id = p_user_id
    and (p_role = 'admin' or p_all_clients or business_id <> all (p_business_ids));
  if p_role = 'staff' and not p_all_clients then
    insert into public.firm_member_clients (firm_id, user_id, business_id)
    select p_firm_id, p_user_id, b from unnest(p_business_ids) b on conflict do nothing;
  end if;
  update public.firm_members set role = p_role, all_clients = p_role = 'admin' or p_all_clients, client_role = p_client_role
  where firm_id = p_firm_id and user_id = p_user_id;
end $$;

-- Take someone off the team: they lose every client of the firm.
create function public.remove_firm_member(p_firm_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_firm_admin(p_firm_id);
  if not exists (select 1 from public.firm_members where firm_id = p_firm_id and role = 'admin' and user_id <> p_user_id) then
    raise exception 'The firm needs at least one admin' using errcode = '23514';
  end if;
  delete from public.firm_members where firm_id = p_firm_id and user_id = p_user_id;
end $$;

-- Accept firm invites as well as client invites, on sign-in (same signature as before).
create or replace function public.accept_my_invites()
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  inv public.business_invites;
  fi public.firm_invites;
begin
  select lower(email) into v_email from auth.users where id = v_user and email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;
  for fi in
    select * from public.firm_invites where email = v_email and accepted_at is null and expires_at > now() for update
  loop
    insert into public.firm_members (firm_id, user_id, role, all_clients, client_role)
    values (fi.firm_id, v_user, fi.role, fi.all_clients, fi.client_role)
    on conflict (firm_id, user_id) do nothing;
    if fi.role = 'staff' and not fi.all_clients then
      insert into public.firm_member_clients (firm_id, user_id, business_id)
      select fi.firm_id, v_user, b.id from public.businesses b where b.id = any (fi.business_ids) and b.firm_id = fi.firm_id
      on conflict do nothing;
    end if;
    update public.firm_invites set accepted_at = now(), accepted_by = v_user where id = fi.id;
    return query select b.id from public.business_members bm join public.businesses b on b.id = bm.business_id
      where bm.user_id = v_user and b.firm_id = fi.firm_id;
  end loop;
  for inv in
    select * from public.business_invites
    where email = v_email and accepted_at is null and expires_at > now()
    for update
  loop
    insert into public.business_members (business_id, user_id, role)
    values (inv.business_id, v_user, inv.role)
    on conflict (business_id, user_id) do nothing;
    update public.business_invites set accepted_at = now(), accepted_by = v_user where id = inv.id;
    perform private.audit(inv.business_id, 'accept_invite', 'business_invites', inv.id, null,
      jsonb_build_object('user_id', v_user, 'role', inv.role));
    return next inv.business_id;
  end loop;
end $$;

revoke all on function
  public.my_firms(), public.rename_firm(uuid, text), public.firm_member_list(uuid),
  public.invite_firm_member(uuid, text, public.firm_role, boolean, public.member_role, uuid[]),
  public.cancel_firm_invite(uuid),
  public.update_firm_member(uuid, uuid, public.firm_role, boolean, public.member_role, uuid[]),
  public.remove_firm_member(uuid, uuid)
  from public, anon;
grant execute on function
  public.my_firms(), public.rename_firm(uuid, text), public.firm_member_list(uuid),
  public.invite_firm_member(uuid, text, public.firm_role, boolean, public.member_role, uuid[]),
  public.cancel_firm_invite(uuid),
  public.update_firm_member(uuid, uuid, public.firm_role, boolean, public.member_role, uuid[]),
  public.remove_firm_member(uuid, uuid)
  to authenticated;

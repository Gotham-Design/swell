-- Auth and multiple businesses (SPEC Prompt 2): chart-of-accounts seed hook, member
-- invites by email, a member list with emails, and an audit trail for settings.

-- ---------------------------------------------------------------------------
-- Standard chart seed (stub; Prompt 3 fills it in)
-- ---------------------------------------------------------------------------
create function private.seed_standard_chart(p_business_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Prompt 3 inserts the standard chart (is_standard = true) here. The system accounts
  -- posting needs already come from private.seed_system_accounts.
  perform p_business_id;
end $$;
revoke all on function private.seed_standard_chart(uuid) from public;

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
  perform private.audit(v_id, 'create', 'businesses', v_id, null,
    (select to_jsonb(b) from public.businesses b where b.id = v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Settings changes are audited (the lock date especially)
-- ---------------------------------------------------------------------------
create function private.audit_business_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
    perform private.audit(new.id, 'update', 'businesses', new.id, to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end $$;
create trigger audit_business_update after update on public.businesses
  for each row execute function private.audit_business_update();

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create table public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Stored lower-case; matched against the signed-in user's confirmed email.
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_invites_pending_key on public.business_invites (business_id, email) where accepted_at is null;
create index business_invites_email_idx on public.business_invites (email) where accepted_at is null;
create trigger touch_updated_at before update on public.business_invites
  for each row execute function private.touch_updated_at();

alter table public.business_invites enable row level security;
revoke all on public.business_invites from anon;
revoke insert, update, truncate, references, trigger on public.business_invites from authenticated;
-- Owners see and cancel their business's invites; creating one goes through invite_member().
create policy "owners read" on public.business_invites for select to authenticated
  using (private.has_role(business_id, '{owner}'));
create policy "owners delete" on public.business_invites for delete to authenticated
  using (private.has_role(business_id, '{owner}') and accepted_at is null);

-- Invite someone by email. Re-inviting a pending address updates its role and expiry.
create function public.invite_member(p_business_id uuid, p_email text, p_role public.member_role)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  perform private.require_role(p_business_id, '{owner}');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception '"%" is not an email address', p_email using errcode = '22023';
  end if;
  if exists (select 1 from public.business_members m join auth.users u on u.id = m.user_id
             where m.business_id = p_business_id and lower(u.email) = v_email) then
    raise exception '% is already a member of this business', v_email using errcode = '23505';
  end if;

  insert into public.business_invites (business_id, email, role, invited_by)
  values (p_business_id, v_email, p_role, (select auth.uid()))
  on conflict (business_id, email) where accepted_at is null
  do update set role = excluded.role, invited_by = excluded.invited_by,
                expires_at = now() + interval '14 days'
  returning id into v_id;

  perform private.audit(p_business_id, 'invite', 'business_invites', v_id, null,
    jsonb_build_object('email', v_email, 'role', p_role));
  return v_id;
end $$;

-- Join every business that has a pending, unexpired invite for the caller's confirmed
-- email. Called after sign-in. Returns the businesses joined.
create function public.accept_my_invites()
returns setof uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  inv public.business_invites;
begin
  select lower(email) into v_email from auth.users where id = v_user and email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;
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

-- Members of a business with their emails (auth.users isn't readable directly).
create function public.business_member_list(p_business_id uuid)
returns table (user_id uuid, email text, role public.member_role, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner,editor,viewer}');
  return query
    select m.user_id, u.email::text, m.role, m.created_at
    from public.business_members m join auth.users u on u.id = m.user_id
    where m.business_id = p_business_id
    order by m.role, u.email;
end $$;

revoke all on function public.invite_member(uuid, text, public.member_role) from public, anon;
revoke all on function public.accept_my_invites() from public, anon;
revoke all on function public.business_member_list(uuid) from public, anon;
grant execute on function
  public.invite_member(uuid, text, public.member_role),
  public.accept_my_invites(),
  public.business_member_list(uuid)
to authenticated;

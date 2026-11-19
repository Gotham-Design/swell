-- Settings and onboarding (MVP): a business's industry, and archiving a business.
--
-- industry     one of a short list; picks nothing yet beyond labels (category starter sets later).
-- archived_at  hidden from the switcher; books, statements and members are kept; owners restore.

alter table public.businesses
  add column industry text check (industry is null or industry in (
    'food_beverage', 'retail', 'professional_services', 'construction_trades', 'health_wellness',
    'creative_media', 'real_estate', 'transportation', 'nonprofit', 'other')),
  add column archived_at timestamptz;

-- Archive or restore, owners only. A function (not a plain update) so it can be audited and
-- so editors can't flip it through the row policy.
create function public.set_business_archived(p_business_id uuid, p_archived boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(p_business_id, '{owner}');
  update public.businesses set archived_at = case when p_archived then now() else null end
  where id = p_business_id;
  perform private.audit(p_business_id, case when p_archived then 'archive' else 'restore' end, 'businesses', p_business_id, null, null);
end $$;
revoke all on function public.set_business_archived(uuid, boolean) from public, anon;
grant execute on function public.set_business_archived(uuid, boolean) to authenticated;

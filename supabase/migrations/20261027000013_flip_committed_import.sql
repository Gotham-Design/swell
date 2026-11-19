-- Imported a statement with money in and out the wrong way round (a card statement read like
-- a bank statement): flip it after the fact instead of undoing and starting over.
--
-- Every live transaction from the batch gets its amount negated through update_transaction,
-- so journal lines repost, the lock date is enforced and the audit log records it. Categories
-- the AI, a rule or the file chose were picked for the wrong direction, so they're cleared
-- (and pending suggestions set aside) to be suggested again; categories a person chose stay.
-- The batch, its rows and the saved column mapping for this account are flipped too, so the
-- next statement from the same bank imports the right way.
create function public.flip_committed_import(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b public.import_batches;
  t public.transactions;
  v_lock date;
  v_count int := 0;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if b.id is null then
    raise exception 'Import not found' using errcode = '42501';
  end if;
  perform private.require_role(b.business_id, '{owner,editor}');
  if b.status <> 'committed' then
    raise exception 'Only an imported statement can be flipped (this one is %)', b.status using errcode = '22023';
  end if;
  select lock_date into v_lock from public.businesses where id = b.business_id;
  if v_lock is not null and exists (
    select 1 from public.transactions
    where import_batch_id = b.id and deleted_at is null and date <= v_lock
  ) then
    raise exception 'Some of these transactions are in closed books (through %). An owner can reopen them in Settings.', v_lock
      using errcode = '22023', hint = 'locked_period';
  end if;

  update public.ai_suggestions s set status = 'superseded'
  from public.transactions x
  where s.transaction_id = x.id and x.import_batch_id = b.id and s.status = 'pending';

  for t in
    select * from public.transactions where import_batch_id = b.id and deleted_at is null order by id for update
  loop
    perform public.update_transaction(t.id, t.date, t.money_account_id, -t.amount_cents, t.description_raw,
      case when t.category_source in ('ai', 'rule', 'import') then null else t.category_account_id end,
      t.description_clean, t.vendor_normalized, t.memo, t.reference, t.dedupe_hash);
    v_count := v_count + 1;
  end loop;

  update public.import_rows set amount_cents = -amount_cents
  where import_batch_id = b.id and amount_cents is not null;
  update public.import_batches set
    total_in_cents = -coalesce(total_out_cents, 0),
    total_out_cents = -coalesce(total_in_cents, 0),
    mapping = case when mapping ->> 'amountMode' = 'signed'
      then jsonb_set(mapping, '{signConvention}',
        to_jsonb(case when mapping ->> 'signConvention' = 'positive_in' then 'positive_out' else 'positive_in' end))
      else mapping end
  where id = b.id;
  if b.header_signature is not null and b.mapping ->> 'amountMode' = 'signed' then
    update public.import_templates set mapping = jsonb_set(mapping, '{signConvention}',
      to_jsonb(case when mapping ->> 'signConvention' = 'positive_in' then 'positive_out' else 'positive_in' end))
    where money_account_id = b.money_account_id and header_signature = b.header_signature
      and mapping ->> 'signConvention' = b.mapping ->> 'signConvention';
  end if;
  return v_count;
end $$;

revoke all on function public.flip_committed_import(uuid) from public, anon;
grant execute on function public.flip_committed_import(uuid) to authenticated;

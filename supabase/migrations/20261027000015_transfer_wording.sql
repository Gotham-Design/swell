-- One-sided transfers were flagged on any "payment" wording, which catches ordinary bills
-- ("ATT Bill Payment", card purchases "RECURRING PAYMENT AUTHORIZED ON"). Only strong transfer
-- wording flags a transfer with no other side now; pairs still match on amount and dates.
create or replace function public.transfer_match_candidates(p_business_id uuid, p_limit int default 100)
returns table (
  kind text, out_transaction_id uuid, in_transaction_id uuid,
  out_account_id uuid, in_account_id uuid, out_date date, in_date date, amount_cents bigint,
  out_description text, in_description text, days int, worded boolean
)
language sql stable security invoker set search_path = '' as $$
  with live as (
    select t.id, t.money_account_id, t.date, t.amount_cents, coalesce(t.description_clean, t.description_raw) as description,
      coalesce(t.description_raw, '') || ' ' || coalesce(t.description_clean, '') ~* '(transfer|xfer|payment|pymt|pmt|thank you|autopay|epay|card ?payment|to (checking|savings|card)|from (checking|savings|card)|zelle|venmo)' as worded,
      -- Strong wording only, for transfers with no other side: ordinary bills say "payment" too.
      coalesce(t.description_raw, '') || ' ' || coalesce(t.description_clean, '') ~* '(\m(online |money |internet |mobile )?transfer\M|\mxfer\M|\mto (chk|checking|savings|sav)\M|\mfrom (chk|checking|savings|sav)\M|\mzelle\M|payment,? thank you|automatic payment|\mautopay\M|payment to .{0,20}card)' as transfer_words
    from public.transactions t
    where t.business_id = p_business_id and t.deleted_at is null
      -- The last two years: keeps the pairing join small on big ledgers.
      and t.date >= current_date - 730
      -- Not yet filed, filed automatically, or filed as a transfer (which is where the double count hides).
      and (t.category_account_id is null or t.kind = 'transfer' or t.category_source in ('ai', 'rule'))
      and not exists (select 1 from public.transfer_matches m where m.status = 'confirmed'
                      and (m.out_transaction_id = t.id or m.in_transaction_id = t.id))
  ),
  pairs as (
    select o.id as out_id, i.id as in_id, o.money_account_id as out_acct, i.money_account_id as in_acct,
      o.date as out_date, i.date as in_date, i.amount_cents as amount, o.description as out_desc, i.description as in_desc,
      abs(i.date - o.date) as days, (o.worded or i.worded) as worded,
      row_number() over (partition by o.id order by abs(i.date - o.date), (o.worded or i.worded) desc, i.id) as ro,
      row_number() over (partition by i.id order by abs(i.date - o.date), (o.worded or i.worded) desc, o.id) as ri
    from live o
    join live i on i.money_account_id <> o.money_account_id and i.amount_cents = -o.amount_cents
      and i.date between o.date - 5 and o.date + 5
    where o.amount_cents < 0
      and not exists (select 1 from public.transfer_matches d where d.status = 'dismissed'
                      and d.out_transaction_id = o.id and d.in_transaction_id = i.id)
  ),
  best as (select * from pairs where ro = 1 and ri = 1),
  lonely as (
    select l.* from live l
    where l.transfer_words
      and not exists (select 1 from best b where b.out_id = l.id or b.in_id = l.id)
      and not exists (select 1 from public.transfer_matches d where d.status = 'dismissed'
                      and d.out_transaction_id = l.id and d.in_transaction_id is null)
  )
  select * from (
    select 'pair', b.out_id, b.in_id, b.out_acct, b.in_acct, b.out_date, b.in_date, b.amount, b.out_desc, b.in_desc, b.days, b.worded
    from best b
    union all
    -- Signed, so the screen knows money in from money out.
    select 'unpaired', l.id, null, l.money_account_id, null, l.date, null, l.amount_cents, l.description, null, null,
      true
    from lonely l
  ) x
  order by 1, 6 desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;


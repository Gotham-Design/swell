-- Transfer matching: a card payment seen from both accounts counts once.
begin;
\ir _setup.psql
select no_plan();

create function tests.bal(acct text) returns bigint language sql stable as $$
  select natural_balance_cents from public.account_balances where account_id = tests.id(acct)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('ed');
-- Checking pays the card $300 (out of checking on the 10th, onto the card on the 12th);
-- the checking side was filed as a transfer to the card: the double count waiting to happen.
select tests.put('out', public.post_transaction(tests.id('A'), '2026-05-10', tests.id('a_chk'), -30000, 'ONLINE PAYMENT TO VISA', tests.id('a_card'))::text);
select tests.put('in',  public.post_transaction(tests.id('A'), '2026-05-12', tests.id('a_card'), 30000, 'PAYMENT THANK YOU')::text);
-- Noise: same amount but too far apart, and a deposit from an account not in the books.
select tests.put('far', public.post_transaction(tests.id('A'), '2026-06-30', tests.id('a_card'), 30000, 'PAYMENT THANK YOU')::text);
select tests.put('lone', public.post_transaction(tests.id('A'), '2026-05-15', tests.id('a_chk'), 50000, 'TRANSFER FROM SAVINGS 4455')::text);

select results_eq(
  $$ select kind, out_transaction_id, in_transaction_id, days, worded from public.transfer_match_candidates(tests.id('A')) where kind = 'pair' $$,
  $$ values ('pair', tests.id('out'), tests.id('in'), 2, true) $$, 'suggests the pair, nearest date first');
select ok(exists (select 1 from public.transfer_match_candidates(tests.id('A')) where kind = 'unpaired' and out_transaction_id = tests.id('lone')),
  'a transfer with no other side is listed for the accountant');

select is(tests.bal('a_chk'), 20000::bigint, 'checking before: -300 payment, +500 deposit');
select tests.put('m', public.confirm_transfer_match(tests.id('out'), tests.id('in'))::text);
select results_eq(
  $$ select t.kind::text, a.subtype from public.transactions t join public.accounts a on a.id = t.category_account_id
     where t.id in (tests.id('out'), tests.id('in')) $$,
  $$ values ('transfer', 'transfer_clearing'), ('transfer', 'transfer_clearing') $$, 'both sides go through Transfer Clearing');
-- Before: checking -300 (to card) and the card's $300 payment uncategorized. After: the
-- payment counts once: checking -300, card -300 owed, clearing 0.
select is(tests.bal('a_chk'), 20000::bigint, 'checking moves once');
select is((select natural_balance_cents from public.account_balances a join public.accounts x on x.id = a.account_id
           where x.business_id = tests.id('A') and x.subtype = 'transfer_clearing'), 0::bigint, 'clearing nets to zero');
select is((select count(*)::int from public.transfer_match_candidates(tests.id('A')) where kind = 'pair'), 0, 'a matched pair is no longer suggested');

select throws_ok($$ select public.categorize_transactions(array[tests.id('in')], tests.std('A', 'Meals')) $$,
  '22023', 'This is a matched transfer. Unmatch it first.', 're-filing a matched side is refused');
select throws_ok($$ select public.soft_delete_transaction(tests.id('out')) $$, '22023', null, 'so is deleting one');
select lives_ok($$ select public.update_transaction(t.id, t.date, t.money_account_id, t.amount_cents, t.description_raw,
    t.category_account_id, t.description_clean, t.vendor_normalized, 'paid early', t.reference, t.dedupe_hash)
  from public.transactions t where t.id = tests.id('in') $$, 'editing a memo keeps the match');

select tests.login('vic');
select throws_ok($$ select public.unmatch_transfer(tests.id('m')) $$, '42501', null, 'viewers cannot unmatch');
select tests.login('ed');
select lives_ok($$ select public.unmatch_transfer(tests.id('m')) $$, 'unmatch');
select is((select category_account_id from public.transactions where id = tests.id('out')), tests.id('a_card'), 'each side goes back to how it was filed');
select is((select category_account_id from public.transactions where id = tests.id('in')), null, '...');

select lives_ok($$ select public.dismiss_transfer_candidate(tests.id('out'), tests.id('in')) $$, 'not a match');
select is((select count(*)::int from public.transfer_match_candidates(tests.id('A')) where kind = 'pair'), 0, 'a dismissed pair stays dismissed');
select lives_ok($$ select public.dismiss_transfer_candidate(tests.id('lone')) $$, 'not a transfer');
select is((select count(*)::int from public.transfer_match_candidates(tests.id('A')) where out_transaction_id = tests.id('lone')), 0, '...and that one too');

select throws_ok($$ select public.confirm_transfer_match(tests.id('lone'), tests.id('in')) $$, '22023', null, 'only opposite equal amounts match');
select throws_ok($$ select public.categorize_transactions(array[tests.id('lone')], (select id from public.accounts where business_id = tests.id('A') and subtype = 'transfer_clearing')) $$,
  '22023', null, 'Transfer Clearing still cannot be picked by hand');

select tests.login('bob');
select is((select count(*)::int from public.transfer_match_candidates(tests.id('A'))), 0, 'RLS: nothing for another business');
select throws_ok($$ select public.confirm_transfer_match(tests.id('out'), tests.id('in')) $$, '42501', null, 'nor can it match');

select * from finish();
rollback;

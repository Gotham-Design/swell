-- Staged import rows: verify statuses, commit exactly the included rows, re-import adds
-- nothing, undo removes the batch, and the books stay balanced throughout.
begin;
\ir _setup.psql
select no_plan();

create function tests.batch(biz text, money text) returns uuid language sql as $$
  insert into public.import_batches (business_id, money_account_id, status, file_name)
  values (tests.id(biz), tests.id(money), 'staged', 'test.csv') returning id
$$;
create function tests.stage(batch text, idx int, d date, amt bigint, clean text, vendor text default null,
  cat text default null, issues jsonb default '[]') returns void language sql as $$
  insert into public.import_rows (business_id, import_batch_id, row_index, raw, date, amount_cents, description_raw,
    description_clean, vendor_normalized, category_name, parse_issues)
  select b.business_id, b.id, idx, array[d::text, amt::text, clean], d, amt, upper(clean), clean, vendor, cat, issues
  from public.import_batches b where b.id = tests.id(batch)
$$;
create function tests.status(batch text, idx int) returns text language sql stable as $$
  select status::text from public.import_rows where import_batch_id = tests.id(batch) and row_index = idx
$$;
create function tests.stage_bal(batch text, idx int, d date, amt bigint, bal bigint) returns void language sql as $$
  insert into public.import_rows (business_id, import_batch_id, row_index, raw, date, amount_cents, description_raw, description_clean, balance_cents)
  select b.business_id, b.id, idx, array['x'], d, amt, 'ROW ' || idx, 'Row ' || idx, bal from public.import_batches b where b.id = tests.id(batch)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('alice');
update public.businesses set books_start_date = '2026-01-01', lock_date = '2026-03-31' where id = tests.id('A');

select tests.login('ed');
select tests.put('meals', tests.std('A', 'Meals')::text);
-- Already in the books: an exact match for row 6 and a near match for row 7.
select tests.put('lunch', public.post_transaction(tests.id('A'), '2026-05-03', tests.id('a_chk'), -2000, 'LUNCH', null, 'Lunch', 'lunch')::text);
select tests.put('uber', public.post_transaction(tests.id('A'), '2026-05-04', tests.id('a_chk'), -3000, 'UBER', null, 'Uber', 'uber')::text);

select tests.put('b1', tests.batch('A', 'a_chk')::text);
select tests.stage('b1', 0, '2026-05-01', -1000, 'Coffee', 'coffee');
select tests.stage('b1', 1, '2026-05-02', 50000, 'Sale');
select tests.stage('b1', 2, null, -500, 'Bad date', null, null, '[{"field":"date","message":"Can''t read the date"}]');
select tests.stage('b1', 3, '2026-03-10', -700, 'Locked');
select tests.stage('b1', 4, '2025-12-31', -800, 'Before books');
select tests.stage('b1', 5, '2026-05-01', -1000, 'Coffee', 'coffee');                -- in-file duplicate of row 0
select tests.stage('b1', 6, '2026-05-03', -2000, 'Lunch', 'lunch');                  -- duplicate of an existing transaction
select tests.stage('b1', 7, '2026-05-05', -3000, 'Uber Trip', 'uber');               -- near duplicate (date +1, same vendor)
select tests.stage('b1', 8, '2026-05-06', -1500, 'Diner', 'diner', 'meals');         -- category matched by name, any case
select tests.stage('b1', 9, '2026-05-07', -900, 'Snack Shop', 'snack shop', 'Snackz'); -- unmatched category

select lives_ok($$ select public.verify_import(tests.id('b1')) $$, 'verify runs');
select results_eq(
  $$ select row_index, status::text from public.import_rows where import_batch_id = tests.id('b1') order by row_index $$,
  $$ values (0, 'ok'), (1, 'ok'), (2, 'error'), (3, 'error'), (4, 'error'), (5, 'duplicate'), (6, 'duplicate'),
            (7, 'near_duplicate'), (8, 'ok'), (9, 'ok') $$,
  'every row gets the right status');
select ok((select check_issues -> 0 ->> 'message' like 'On or before the lock date%' from public.import_rows where import_batch_id = tests.id('b1') and row_index = 3),
  'a locked date is explained');
select ok((select check_issues -> 0 ->> 'message' like 'Before the books start%' from public.import_rows where import_batch_id = tests.id('b1') and row_index = 4),
  'a date before the books start is explained');
select results_eq($$ select duplicate_of_row, duplicate_of_transaction from public.import_rows where import_batch_id = tests.id('b1') and row_index in (5, 6) order by row_index $$,
  $$ values (0, null::uuid), (null::int, tests.id('lunch')) $$, 'duplicates point at what they duplicate');
select is((select near_duplicate_of from public.import_rows where import_batch_id = tests.id('b1') and row_index = 7), tests.id('uber'),
  'a near duplicate points at the similar transaction');
select is((select category_account_id from public.import_rows where import_batch_id = tests.id('b1') and row_index = 8), tests.id('meals'),
  'category names match existing categories');
select is((select category_account_id from public.import_rows where import_batch_id = tests.id('b1') and row_index = 9), null,
  'unmatched names stay unmatched');
select results_eq($$ select row_index from public.import_rows where import_batch_id = tests.id('b1') and included order by row_index $$,
  $$ values (0), (1), (8), (9) $$, 'by default: ok rows are included; errors, exact and near duplicates are not');
select results_eq($$ select row_count, skipped_count, total_in_cents, total_out_cents, date_from, date_to from public.import_batches where id = tests.id('b1') $$,
  $$ values (10, 6, 50000::bigint, -3400::bigint, '2026-05-01'::date, '2026-05-07'::date) $$, 'totals cover the included rows');

-- The user's choices
update public.import_batches set category_map = jsonb_build_object('snackz', tests.id('meals')) where id = tests.id('b1');
update public.import_rows set decision = 'include' where import_batch_id = tests.id('b1') and row_index = 5;
update public.import_rows set decision = 'exclude' where import_batch_id = tests.id('b1') and row_index = 1;
update public.import_rows set decision = 'include' where import_batch_id = tests.id('b1') and row_index = 2;
update public.import_rows set decision = 'include' where import_batch_id = tests.id('b1') and row_index = 7;
select public.verify_import(tests.id('b1'));
select is((select category_account_id from public.import_rows where import_batch_id = tests.id('b1') and row_index = 9), tests.id('meals'),
  '"map to existing" resolves the unmatched name');
select results_eq($$ select row_index from public.import_rows where import_batch_id = tests.id('b1') and included order by row_index $$,
  $$ values (0), (5), (7), (8), (9) $$, 'include a duplicate and a near duplicate, exclude a good row; an error row stays out whatever the decision');

-- Commit
select throws_ok($$ select public.commit_import(tests.id('b1'), 99) $$, '40001', null, 'a stale confirmation posts nothing');
select is((select count(*)::int from public.transactions where import_batch_id = tests.id('b1')), 0, '...nothing at all');
select is(public.commit_import(tests.id('b1'), 5), 5, 'commit posts exactly the included rows');
select results_eq(
  $$ select r.row_index, t.source::text, t.amount_cents, t.category_account_id, t.dedupe_hash = r.dedupe_hash
     from public.import_rows r join public.transactions t on t.id = r.transaction_id
     where r.import_batch_id = tests.id('b1') order by r.row_index $$,
  $$ values (0, 'import', -1000::bigint, null::uuid, true), (5, 'import', -1000::bigint, null::uuid, true),
            (7, 'import', -3000::bigint, null::uuid, true), (8, 'import', -1500::bigint, tests.id('meals'), true),
            (9, 'import', -900::bigint, tests.id('meals'), true) $$,
  'each posted transaction matches its row, under the batch, with its dedupe hash');
select is((select status::text from public.import_batches where id = tests.id('b1')), 'committed', 'the batch is committed');
select is((select sum(balance_cents)::bigint from public.account_balances where business_id = tests.id('A')), 0::bigint, 'the books balance');
select throws_ok($$ select public.commit_import(tests.id('b1'), 5) $$, '22023', null, 'a batch commits once');

-- Flipping the sign convention negates every staged amount and re-verifies.
select tests.put('bf', tests.batch('A', 'a_chk')::text);
update public.import_batches set mapping = '{"amountMode":"signed","signConvention":"positive_in"}' where id = tests.id('bf');
select tests.stage('bf', 0, '2026-06-01', -1234, 'Flip me');
select public.flip_import_sign(tests.id('bf'));
select results_eq($$ select r.amount_cents, b.mapping ->> 'signConvention', b.status::text from public.import_rows r
                     join public.import_batches b on b.id = r.import_batch_id where b.id = tests.id('bf') $$,
  $$ values (1234::bigint, 'positive_out', 'verified') $$, 'flip negates amounts, records the convention, re-verifies');
select public.flip_import_sign(tests.id('bf'));
select is((select amount_cents from public.import_rows where import_batch_id = tests.id('bf')), -1234::bigint, 'flipping twice restores it');

-- Running balance: checked oldest first, first break reported, refreshed by flipping.
select tests.put('bb', tests.batch('A', 'a_chk')::text);
update public.import_batches set mapping = '{"amountMode":"signed","signConvention":"positive_out"}' where id = tests.id('bb');
select tests.stage_bal('bb', 0, '2026-07-01', null, 100000);   -- beginning balance line
select tests.stage_bal('bb', 1, '2026-07-02', -450, 99550);
select tests.stage_bal('bb', 2, '2026-07-03', 450, 99100);     -- wrong sign: breaks here
select public.verify_import(tests.id('bb'));
select is((select balance_check from public.import_batches where id = tests.id('bb')),
  '{"checked": true, "ok": false, "breakRow": 2, "expected": 100000, "actual": 99100}'::jsonb, 'the first break is reported');
update public.import_rows set amount_cents = -450 where import_batch_id = tests.id('bb') and row_index = 2;
select public.verify_import(tests.id('bb'));
select is((select balance_check from public.import_batches where id = tests.id('bb')), '{"checked": true, "ok": true}'::jsonb, 're-verifying refreshes it');

select tests.put('bn', tests.batch('A', 'a_chk')::text);
select tests.stage_bal('bn', 0, '2026-07-03', -300, 500);   -- newest first
select tests.stage_bal('bn', 1, '2026-07-02', -200, 800);
select tests.stage_bal('bn', 2, '2026-07-01', 1000, 1000);
select public.verify_import(tests.id('bn'));
select is((select balance_check ->> 'ok' from public.import_batches where id = tests.id('bn')), 'true', 'newest-first files are walked from the bottom');
select is((select balance_check from public.import_batches where id = tests.id('b1')), '{"checked": false, "ok": true}'::jsonb,
  'no balance column, no check');

-- Re-importing the same rows adds nothing.
select tests.put('b2', tests.batch('A', 'a_chk')::text);
select tests.stage('b2', 0, '2026-05-01', -1000, 'Coffee', 'coffee');
select tests.stage('b2', 1, '2026-05-06', -1500, 'Diner', 'diner', 'meals');
select public.verify_import(tests.id('b2'));
select is((select count(*)::int from public.import_rows where import_batch_id = tests.id('b2') and included), 0, 're-importing adds 0 rows');
select throws_ok($$ select public.commit_import(tests.id('b2'), 0) $$, '22023', null, 'and there is nothing to commit');

-- Undo
select is(public.undo_import(tests.id('b1')), 5, 'undo soft-deletes every transaction in the batch');
select is((select count(*)::int from public.transactions where import_batch_id = tests.id('b1') and deleted_at is null), 0, 'none left live');
select is((select status::text from public.import_batches where id = tests.id('b1')), 'undone', 'the batch is marked undone');
select is((select sum(balance_cents)::bigint from public.account_balances where business_id = tests.id('A')), 0::bigint, 'the books still balance');
select is(tests.balance('a_chk'), -5000::bigint, 'only the pre-existing transactions remain');
select throws_ok($$ select public.undo_import(tests.id('b1')) $$, '22023', null, 'undo happens once');
select public.verify_import(tests.id('b2'));
select is((select count(*)::int from public.import_rows where import_batch_id = tests.id('b2') and included), 2, 'after undo, the same rows import again');

-- Access
select tests.login('vic');
select ok((select count(*) from public.import_rows where import_batch_id = tests.id('b1')) = 10, 'viewers can read staged rows');
select throws_ok($$ select public.verify_import(tests.id('b2')) $$, '42501', null, 'viewers cannot verify');
select throws_ok($$ select public.commit_import(tests.id('b2'), 2) $$, '42501', null, 'viewers cannot commit');
select throws_ok($$ select public.undo_import(tests.id('b1')) $$, '42501', null, 'viewers cannot undo');
select tests.login('bob');
select is((select count(*)::int from public.import_rows where business_id = tests.id('A')), 0, 'outsiders see no staged rows');
select throws_ok($$ select public.verify_import(tests.id('b2')) $$, '42501', null, 'outsiders cannot verify');

select * from finish();
rollback;

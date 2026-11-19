-- Tax section: assets and depreciation through the ledger, documents, the health and
-- retirement log, mileage and recurring statement requests.
begin;
\ir _setup.psql
select no_plan();

create function tests.bal(acct uuid) returns bigint language sql stable as $$
  select natural_balance_cents from public.account_balances where account_id = acct
$$;
create function tests.acct(p_sub text) returns uuid language sql stable as $$
  select id from public.accounts where business_id = tests.id('A') and subtype = p_sub limit 1
$$;
grant execute on all functions in schema tests to authenticated;

-- The schedule itself (pure).
select is(public.depreciation_through('straight_line', 1200000, 0, 60, '2026-03-15', null, '2026-02-28'), 0::bigint, 'nothing before it goes into service');
select is(public.depreciation_through('straight_line', 1200000, 0, 60, '2026-03-15', null, '2026-03-31'), 20000::bigint, 'the month placed in service counts');
select is(public.depreciation_through('straight_line', 1200000, 0, 60, '2026-03-15', null, '2026-12-31'), 200000::bigint, '10 months by December');
select is(public.depreciation_through('straight_line', 1200000, 200000, 60, '2026-03-15', null, '2035-01-31'), 1000000::bigint, 'never past cost less salvage');
select is(public.depreciation_through('straight_line', 1000, 0, 3, '2026-01-01', null, '2026-02-28'), 666::bigint, 'whole cents, the remainder lands in the last month');
select is(public.depreciation_through('straight_line', 1200000, 0, 60, '2026-03-15', '2026-05-10', '2026-12-31'), 60000::bigint, 'stops when sold');
select is(public.depreciation_through('expense_now', 500000, 0, null, '2026-06-01', null, '2026-06-30'), 500000::bigint, 'Section 179: all in the month placed in service');

select tests.login('ed');
-- A $12,000 truck bought from checking, filed as Vehicle expense by mistake.
select tests.put('truck_tx', public.post_transaction(tests.id('A'), '2026-03-15', tests.id('a_chk'), -1200000, 'FORD MOTOR CREDIT', tests.std('A', 'Vehicle'))::text);
select tests.put('lunch', public.post_transaction(tests.id('A'), '2026-03-16', tests.id('a_chk'), -4500, 'CAFE')::text);

select results_eq($$ select transaction_id from public.large_purchase_candidates(tests.id('A'), 250000, '2026-01-01') $$,
  $$ values (tests.id('truck_tx')) $$, 'the truck is flagged as a large purchase, the lunch is not');

select tests.put('truck', public.create_fixed_asset(tests.id('A'), 'Ford F-150', 'vehicle', '2026-03-15', '2026-03-15', 1200000,
  0, 'straight_line', 60, tests.id('truck_tx'))::text);
select is((select subtype from public.accounts a join public.transactions t on t.category_account_id = a.id where t.id = tests.id('truck_tx')),
  'fixed_asset_vehicle', 'its purchase is filed to Vehicles, on the balance sheet');
select is((select count(*)::int from public.large_purchase_candidates(tests.id('A'), 250000, '2026-01-01')), 0, 'and is no longer flagged');
select throws_ok($$ select public.create_fixed_asset(tests.id('A'), 'Again', 'vehicle', '2026-03-15', '2026-03-15', 1200000, 0, 'straight_line', 60, tests.id('truck_tx')) $$,
  '23505', null, 'a purchase becomes one asset');

-- Post through June: one entry, 4 months.
select is(public.post_depreciation(tests.id('A'), '2026-06-15'), 1, 'posts one entry');
select is(tests.bal(tests.acct('depreciation')), 80000::bigint, 'Depreciation expense: 4 months of $200');
select is(tests.bal(tests.acct('accumulated_depreciation')), -80000::bigint, 'Accumulated Depreciation credited (a contra asset)');
select is((select date from public.transactions where source::text = 'journal' and deleted_at is null), '2026-06-30'::date, 'dated the month end');
select is(public.post_depreciation(tests.id('A'), '2026-06-30'), 0, 'running it again posts nothing');
select is((select count(*)::int from public.search_transactions(tests.id('A'))), 2, 'journal entries stay out of the transaction list');
select is((select count(*)::int from public.search_transactions(tests.id('A'), p_category_ids => array[tests.acct('depreciation')])), 1,
  'but show when drilling into Depreciation');
select ok(not exists (select 1 from public.money_movement(tests.id('A'), '2026-06-01', '2026-06-30')), 'no money moved in June');
select throws_like($$ select public.soft_delete_transactions(array(select id from public.transactions where source::text = 'journal')) $$,
  '%depreciation entry%', 'a depreciation entry can''t be deleted like a bank line');

-- An edit trues up on the next run: life 60 -> 40 months is $300/month, 6 months by August.
select lives_ok($$ select public.update_fixed_asset(tests.id('truck'), 'Ford F-150', 'vehicle', '2026-03-15', '2026-03-15', 1200000,
  0, 'straight_line', 40, null, null) $$, 'change the useful life');
select is(public.post_depreciation(tests.id('A'), '2026-08-31'), 1, 'one true-up entry');
select is(tests.bal(tests.acct('depreciation')), 180000::bigint, 'six months at $300');
select is((select count(*)::int from public.fixed_asset_summary(tests.id('A'), '2026-08-31') where posted_cents = 180000 and book_value_cents = 1020000), 1,
  'summary: posted and book value');

-- Undo takes back the latest posting; locked months can't be posted.
select is(public.undo_depreciation(tests.id('A')), 1, 'undo the August posting');
select is(tests.bal(tests.acct('depreciation')), 80000::bigint, 'back to June');
select throws_ok($$ select public.delete_fixed_asset(tests.id('truck')) $$, 'P0001', null, 'an asset with depreciation posted stays');

reset role;
update public.businesses set lock_date = '2026-07-31' where id = tests.id('A');
select tests.login('ed');
select throws_ok($$ select public.post_depreciation(tests.id('A'), '2026-07-31') $$, 'P0001', null, 'closed months can''t be posted');
select is(public.post_depreciation(tests.id('A'), '2026-09-30'), 1, 'an open month catches up');
select is(tests.bal(tests.acct('depreciation')), 210000::bigint, '7 months at $300');

-- Land isn't depreciated; Section 179 expenses at once.
select throws_ok($$ select public.create_fixed_asset(tests.id('A'), 'Lot', 'land', '2026-01-01', '2026-01-01', 100000, 0, 'straight_line', 60) $$,
  '22023', null, 'land can''t be depreciated');
select tests.put('laptop', public.create_fixed_asset(tests.id('A'), 'Laptop', 'computer', '2026-09-01', '2026-09-01', 300000, 0, 'expense_now')::text);
select is(public.post_depreciation(tests.id('A'), '2026-10-31'), 2, 'truck month + laptop expensed');
select is(tests.bal(tests.acct('depreciation')), 540000::bigint, '$2,400 truck + $3,000 laptop');

reset role;
update public.businesses set lock_date = null where id = tests.id('A');

-- A viewer reads, can't post; another business can't see any of it.
select tests.login('vic');
select is((select count(*)::int from public.fixed_assets), 2, 'a viewer sees the assets');
select throws_ok($$ select public.post_depreciation(tests.id('A'), '2026-11-30') $$, '42501', null, 'a viewer can''t post depreciation');
select tests.login('bob');
select is((select count(*)::int from public.fixed_assets), 0, 'another business sees no assets');
select throws_ok($$ select public.create_fixed_asset(tests.id('A'), 'X', 'equipment', '2026-01-01', '2026-01-01', 100, 0, 'expense_now') $$,
  '42501', null, 'and can''t add one');

-- Health and retirement log.
select tests.login('ed');
select tests.put('bcbs', public.post_transaction(tests.id('A'), '2026-04-01', tests.id('a_chk'), -65000, 'BLUE CROSS NC PREMIUM')::text);
select tests.put('sep', public.post_transaction(tests.id('A'), '2026-04-15', tests.id('a_chk'), -500000, 'VANGUARD SEP IRA CONTRIB')::text);
select results_eq($$ select kind, transaction_id from public.tax_item_candidates(tests.id('A'), '2026-01-01', '2026-12-31') order by kind $$,
  $$ values ('health', tests.id('bcbs')), ('retirement', tests.id('sep')) $$, 'premium and SEP contribution are suggested');
select lives_ok($$ insert into public.tax_items (business_id, kind, item_type, person, date, amount_cents, description, transaction_id)
  values (tests.id('A'), 'health', 'Health insurance premium', 'Owner', '2026-04-01', 65000, 'Blue Cross NC', tests.id('bcbs')) $$, 'an editor logs it');
insert into public.tax_skips (business_id, transaction_id, what) values (tests.id('A'), tests.id('sep'), 'retirement');
select is((select count(*)::int from public.tax_item_candidates(tests.id('A'), '2026-01-01', '2026-12-31')), 0, 'logged and waved-off ones drop out');
select tests.login('vic');
select throws_ok($$ insert into public.tax_items (business_id, kind, item_type, date, amount_cents, description)
  values (tests.id('A'), 'retirement', '401(k)', '2026-05-01', 100, 'x') $$, '42501', null, 'a viewer can''t log');

-- Mileage: the rate in force on each trip's date.
select tests.login('ed');
insert into public.mileage_trips (business_id, date, miles_tenths, purpose) values
  (tests.id('A'), '2026-06-30', 1000, 'Client site'), (tests.id('A'), '2026-07-01', 1000, 'Client site'), (tests.id('A'), '2025-03-01', 125, 'Bank');
select results_eq($$ select date, deduction_cents from public.mileage_trips_rated order by date $$,
  $$ values ('2025-03-01'::date, 875::bigint), ('2026-06-30'::date, 7250::bigint), ('2026-07-01'::date, 7600::bigint) $$,
  '12.5 mi at 70¢; 100 mi at 72.5¢ in June, 76¢ from July');
select tests.login('bob');
select is((select count(*)::int from public.mileage_trips_rated), 0, 'trips stay with their business');

-- Documents: tied to the business folder.
select tests.login('ed');
select lives_ok($$ insert into public.documents (business_id, file_name, content_type, size_bytes, storage_path, kind, asset_id)
  values (tests.id('A'), 'bill.pdf', 'application/pdf', 1000, tests.id('A') || '/x/bill.pdf', 'bill_of_sale', tests.id('truck')) $$,
  'a bill of sale on the truck');
select throws_ok($$ insert into public.documents (business_id, file_name, content_type, size_bytes, storage_path)
  values (tests.id('A'), 'x.pdf', 'application/pdf', 1000, tests.id('B') || '/x/x.pdf') $$, '23514', null, 'the file must sit in this business''s folder');

-- Recurring statement requests: writers only, and the send bookkeeping is the server job's.
select lives_ok($$ insert into public.statement_schedules (business_id, client_email, from_name, day_of_month, next_send_on)
  values (tests.id('A'), 'owner@acme.test', 'Jordan', 5, '2026-12-05') $$, 'an editor schedules monthly requests');
select throws_ok($$ update public.statement_schedules set sends_in_period = 0 $$, '42501', null, 'but can''t touch what was sent');
select throws_ok($$ insert into public.statement_schedules (business_id, client_email, from_name, next_send_on)
  values (tests.id('A'), 'not an email', 'Jordan', '2026-12-05') $$, '23514', null, 'needs a real email');
select tests.login('vic');
select is((select count(*)::int from public.statement_schedules), 0, 'viewers don''t see them');

reset role;
select is((select sum(amount_cents) from public.journal_lines where business_id = tests.id('A'))::bigint, 0::bigint, 'the books still balance');

select * from finish();
rollback;

-- Pattern engine: a monthly SaaS charge, a weekly payroll, a one-off $12k equipment buy and
-- a vendor with conflicting categories produce exactly the expected patterns, and no rule
-- for the conflicting vendor. Then: missed and changed-amount flags, the three large rules,
-- rules applied at import commit, rule editing, and who can do what.
begin;
\ir _setup.psql
select no_plan();

create function tests.pv(p_date date, p_amount bigint, p_vendor text, cat text default null)
returns uuid language sql as $$
  select public.post_transaction(tests.id('P'), p_date, tests.id('p_chk'), p_amount, upper(p_vendor) || ' CHARGE',
    tests.id(cat), initcap(p_vendor), p_vendor)
$$;
create function tests.refresh(p_as_of date) returns jsonb language sql as $$
  select private.refresh_patterns(tests.id('P'), p_as_of)
$$;
create function tests.pat(p_kind text, p_vendor text, p_col text) returns text language sql stable as $$
  select (to_jsonb(p) ->> p_col) from public.transaction_patterns p
  where p.business_id = tests.id('P') and p.kind::text = p_kind and p.vendor_normalized = p_vendor
$$;
create function tests.batch(money text) returns uuid language sql as $$
  insert into public.import_batches (business_id, money_account_id, status, file_name)
  values (tests.id('P'), tests.id(money), 'staged', 'bank.csv') returning id
$$;
create function tests.stage(batch text, idx int, d date, amt bigint, vendor text, cat text default null) returns void language sql as $$
  insert into public.import_rows (business_id, import_batch_id, row_index, raw, date, amount_cents, description_raw,
    description_clean, vendor_normalized, category_name)
  -- verify_import matches the file's category name to an account.
  select b.business_id, b.id, idx, array[d::text, amt::text, vendor], d, amt, upper(vendor), initcap(vendor), vendor,
    (select name from public.accounts where id = tests.id(cat))
  from public.import_batches b where b.id = tests.id(batch)
$$;
grant execute on all functions in schema tests to authenticated;
-- The engine and the nightly job run as postgres; tests call them through these wrappers.
grant usage on schema private to authenticated;
grant execute on function private.refresh_patterns(uuid, date) to authenticated;

select tests.login('alice');
select tests.put('P', public.create_business('Pattern Co')::text);
select tests.put('p_chk', tests.add_money('P', 'Ops Checking', 'checking')::text);
select tests.put('soft',   (select id from public.accounts where business_id = tests.id('P') and name = 'Software & Subscriptions')::text);
select tests.put('pay',    (select id from public.accounts where business_id = tests.id('P') and name = 'Payroll')::text);
select tests.put('equip',  (select id from public.accounts where business_id = tests.id('P') and name = 'Equipment')::text);
select tests.put('office', (select id from public.accounts where business_id = tests.id('P') and name = 'Office Supplies')::text);
insert into public.business_members (business_id, user_id, role) values
  (tests.id('P'), tests.id('ed'), 'editor'), (tests.id('P'), tests.id('vic'), 'viewer');

-- Monthly SaaS: $45.00 on the 15th, Jan–Jun 2026.
select tests.pv(make_date(2026, m, 15), -4500, 'figma', 'soft') from generate_series(1, 6) m;
-- Weekly payroll: $2,000.00 every Friday, Apr 3 – Jun 26 (13 runs).
select tests.pv(('2026-04-03'::date + 7 * w), -200000, 'gusto', 'pay') from generate_series(0, 12) w;
-- One-off equipment buy.
select tests.put('dell', tests.pv('2026-05-20', -1200000, 'dell', 'equip')::text);
-- A vendor people categorize two ways, at irregular intervals.
select tests.pv('2026-01-09', -3200, 'amazon', 'office');
select tests.pv('2026-02-21', -5400, 'amazon', 'soft');
select tests.pv('2026-04-02', -2700, 'amazon', 'office');
select tests.pv('2026-05-27', -6100, 'amazon', 'soft');

select is(tests.refresh('2026-06-30'), '{"vendors": 4, "recurring": 2, "large": 1, "rules_created": 2}'::jsonb,
  'engine: 4 vendors, 2 recurring, 1 large, 2 rules');

-- 1. Same vendor
select is(tests.pat('vendor', 'figma', 'txn_count'), '6', 'figma: count');
select is(tests.pat('vendor', 'figma', 'first_seen'), '2026-01-15', 'figma: first seen');
select is(tests.pat('vendor', 'figma', 'last_seen'), '2026-06-15', 'figma: last seen');
select is(tests.pat('vendor', 'figma', 'typical_category_id'), tests.id('soft')::text, 'figma: typical category');
select is(tests.pat('vendor', 'figma', 'typical_amount_cents'), '-4500', 'figma: median amount');
select is(tests.pat('vendor', 'gusto', 'txn_count'), '13', 'gusto: count');
select is(tests.pat('vendor', 'dell', 'typical_amount_cents'), '-1200000', 'dell: one purchase');
select ok(tests.pat('vendor', 'amazon', 'typical_category_id') in (tests.id('office')::text, tests.id('soft')::text),
  'amazon: typical category is one of the two used');
select is(tests.pat('vendor', 'amazon', 'typical_amount_cents'), '-5400', 'amazon: median amount');

-- 2. Recurring
select results_eq(
  $$ select vendor_normalized, direction, cadence, amount_match, expected_next_date, expected_amount_cents, status
     from public.transaction_patterns where business_id = tests.id('P') and kind = 'recurring' order by vendor_normalized $$,
  $$ values ('figma', 'out', 'monthly', 'exact', '2026-07-15'::date, -4500::bigint, 'ok'),
            ('gusto', 'out', 'weekly',  'exact', '2026-07-03'::date, -200000::bigint, 'ok') $$,
  'recurring: figma monthly, gusto weekly; nothing for dell or amazon');

-- 3. Large
select results_eq(
  $$ select transaction_id, amount_cents, large_rules from public.transaction_patterns
     where business_id = tests.id('P') and kind = 'large' $$,
  $$ values (tests.id('dell'), -1200000::bigint, array['p95']) $$,
  'large: only the equipment buy, above the 95th percentile');

-- 4. Rules
select results_eq(
  $$ select vendor_normalized, category_account_id, source::text, confirmations, enabled
     from public.category_rules where business_id = tests.id('P') order by vendor_normalized $$,
  $$ values ('figma', tests.id('soft'), 'auto', 6, true), ('gusto', tests.id('pay'), 'auto', 13, true) $$,
  'rules: figma and gusto; none for amazon (conflicting) or dell (one confirmation)');
select is((select count(*)::int from public.audit_log where business_id = tests.id('P') and action = 'auto_rule'), 2,
  'each auto rule is audited');
select is(tests.refresh('2026-06-30') ->> 'rules_created', '0', 'running again creates nothing new (idempotent)');
select is((select count(*)::int from public.transaction_patterns where business_id = tests.id('P')), 7,
  '...and leaves exactly the same patterns');

-- ---------------------------------------------------------------------------
-- Missed and changed amounts
-- ---------------------------------------------------------------------------
select tests.refresh('2026-08-31');
select is(tests.pat('recurring', 'figma', 'status'), 'missed', 'figma: missed (due Jul 15, nothing by Aug 31)');
select is(tests.pat('recurring', 'gusto', 'status'), 'missed', 'gusto: missed');
select tests.refresh('2026-07-20');
select is(tests.pat('recurring', 'figma', 'status'), 'ok', 'figma: within the grace period on Jul 20');

select tests.put('f7', tests.pv('2026-07-15', -4700, 'figma', 'soft')::text);
select tests.refresh('2026-07-20');
select is(tests.pat('recurring', 'figma', 'status'), 'amount_changed', 'figma: a fixed subscription charged $47 instead of $45');
select is(tests.pat('recurring', 'figma', 'last_amount_cents'), '-4700', '...with the new amount');
select is(tests.pat('recurring', 'figma', 'expected_next_date'), '2026-08-15', '...and the next date moves on');
select public.soft_delete_transaction(tests.id('f7'));
select tests.put('f7b', tests.pv('2026-07-15', -5900, 'figma', 'soft')::text);
select tests.refresh('2026-07-20');
select is(tests.pat('recurring', 'figma', 'status'), 'amount_changed', 'figma: $59 is outside ±10%');
select is(tests.pat('recurring', 'figma', 'txn_count'), '6', '...and is not counted as a regular charge');
select public.soft_delete_transaction(tests.id('f7b'));

-- ---------------------------------------------------------------------------
-- Large: vendor median and the user's threshold
-- ---------------------------------------------------------------------------
select tests.put('bonus', tests.pv('2026-06-29', -700000, 'gusto', 'pay')::text);
select tests.refresh('2026-06-30');
select ok((select large_rules @> array['vendor_median'] from public.transaction_patterns where transaction_id = tests.id('bonus')),
  'large: 3x that vendor''s median of earlier charges');
select public.soft_delete_transaction(tests.id('bonus'));
update public.businesses set large_threshold_cents = 150000 where id = tests.id('P');
select tests.refresh('2026-06-30');
select is((select large_rules from public.transaction_patterns where transaction_id = tests.id('dell')), array['p95', 'threshold'],
  'large: the equipment buy fires both rules');
select is((select count(*)::int from public.transaction_patterns where business_id = tests.id('P') and kind = 'large'
           and large_rules = array['threshold']), 13, 'large: every payroll run is over a $1,500 threshold');
update public.businesses set large_threshold_cents = null where id = tests.id('P');

-- ---------------------------------------------------------------------------
-- Category source and rules at import
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.transactions where business_id = tests.id('P') and category_source <> 'user'), 0,
  'everything posted by hand is user-chosen');

select tests.login('ed');
-- Pattern-engine rules are suggestions (drafts) until someone approves them.
select is((select array_agg(status order by vendor_normalized) from public.category_rules where business_id = tests.id('P')),
  array['draft', 'draft'], 'auto rules start as drafts');
select public.approve_rule(id) from public.category_rules where business_id = tests.id('P') and status = 'draft';
select tests.put('bt', tests.batch('p_chk')::text);
select tests.stage('bt', 0, '2026-09-15', -4500, 'figma');            -- uncategorized, has a rule
select tests.stage('bt', 1, '2026-09-18', -200000, 'gusto', 'office'); -- the file's category wins
select tests.stage('bt', 2, '2026-09-20', -1500, 'zoom');              -- no rule
select public.commit_import(tests.id('bt'), 3);
select results_eq(
  $$ select vendor_normalized, category_account_id, category_source::text, category_rule_id is not null
     from public.transactions where import_batch_id = tests.id('bt') order by vendor_normalized $$,
  $$ values ('figma', tests.id('soft'), 'rule', true), ('gusto', tests.id('office'), 'import', false),
            ('zoom', null::uuid, null, false) $$,
  'import: rules fill uncategorized rows only; file categories are marked import');
select ok((select last_applied_at is not null from public.category_rules where vendor_normalized = 'figma' and business_id = tests.id('P')),
  'the rule records when it was last applied');
select tests.put('ruled', (select id from public.transactions where import_batch_id = tests.id('bt') and vendor_normalized = 'figma')::text);
select is((select sum(amount_cents)::int from public.journal_lines where transaction_id = tests.id('ruled')), 0, 'rule-categorized rows post balanced lines');
select is((select account_id from public.journal_lines where transaction_id = tests.id('ruled') and amount_cents > 0), tests.id('soft'),
  '...to the rule''s category');

-- Changing a rule-applied category makes it the user's choice.
select tests.put('ruled', tests.id('ruled')::text);
select public.categorize_transactions(array[tests.id('ruled')], tests.id('office'));
select is((select category_source::text from public.transactions where id = tests.id('ruled')), 'user', 'recategorized: user');
select is((select category_rule_id from public.transactions where id = tests.id('ruled')), null, '...and no longer tied to the rule');

-- Disabled and deleted rules don't apply; the engine doesn't recreate a deleted rule.
select tests.put('r_figma', (select id from public.category_rules where business_id = tests.id('P') and vendor_normalized = 'figma')::text);
select tests.put('r_gusto', (select id from public.category_rules where business_id = tests.id('P') and vendor_normalized = 'gusto')::text);
select public.update_category_rule(tests.id('r_figma'), tests.id('soft'), false);
select public.delete_category_rule(tests.id('r_gusto'));
select tests.put('bt2', tests.batch('p_chk')::text);
select tests.stage('bt2', 0, '2026-10-15', -4500, 'figma');
select tests.stage('bt2', 1, '2026-10-16', -200000, 'gusto');
select public.commit_import(tests.id('bt2'), 2);
select is((select count(*)::int from public.transactions where import_batch_id = tests.id('bt2') and category_account_id is null), 2,
  'disabled and deleted rules are not applied');
reset role;
select tests.refresh('2026-10-31');
select results_eq(
  $$ select vendor_normalized, enabled, deleted_at is not null from public.category_rules where business_id = tests.id('P') order by 1 $$,
  $$ values ('figma', false, false), ('gusto', false, true) $$,
  'the engine leaves a disabled rule off and a deleted one deleted');
select tests.login('ed');
select public.save_category_rule(tests.id('P'), 'gusto', tests.id('pay'));
select is((select deleted_at from public.category_rules where id = tests.id('r_gusto')), null, '"apply to similar" revives a deleted rule');
select throws_ok($$ select public.update_category_rule(tests.id('r_figma'), (select id from public.accounts where business_id = tests.id('P') and subtype = 'uncategorized'), true) $$,
  '22023', null, 'a rule cannot point at a system account');
select is((select count(*)::int from public.audit_log where business_id = tests.id('P') and action in ('update_rule', 'delete_rule')), 2,
  'rule edits and deletes are audited');

-- Direct writes can't forge engine fields.
insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, confirmations)
values (tests.id('P'), 'notion', tests.id('soft'), 'auto', 99);
select is((select (source::text, confirmations)::text from public.category_rules where business_id = tests.id('P') and vendor_normalized = 'notion'),
  '(manual,0)', 'a rule written through the API is manual with no confirmations');

-- ---------------------------------------------------------------------------
-- Access and the nightly job
-- ---------------------------------------------------------------------------
select ok((public.refresh_patterns(tests.id('P')) ->> 'vendors')::int > 0, 'editors can refresh after an import');
select tests.login('vic');
select ok((select count(*) from public.transaction_patterns where business_id = tests.id('P')) > 0, 'viewers can read patterns');
select throws_ok($$ select public.refresh_patterns(tests.id('P')) $$, '42501', null, 'viewers cannot run the engine');
select throws_ok($$ select public.delete_category_rule(tests.id('r_figma')) $$, '42501', null, 'viewers cannot delete rules');
select tests.login('bob');
select is((select count(*)::int from public.transaction_patterns where business_id = tests.id('P')), 0, 'outsiders see no patterns');
select throws_ok($$ delete from public.transaction_patterns $$, '42501', null, 'nobody writes patterns directly');
reset role;
select ok(private.refresh_all_patterns() >= 3, 'the nightly job refreshes every business');
select is((select schedule from cron.job where jobname = 'refresh-patterns-nightly'), '30 7 * * *', 'scheduled nightly with pg_cron');

select * from finish();
rollback;

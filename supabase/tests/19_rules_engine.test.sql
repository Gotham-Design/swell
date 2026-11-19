-- Rules engine: legacy vendor rules keep working, every operator, all/any, priority and
-- stop_processing, hand-set categories and locked rows are never touched, regex validation,
-- apply-to-existing preview = changes, undo restores exactly (P&L included), rules before AI.
begin;
\ir _setup.psql
select no_plan();

-- One condition against one described row, through the real matcher.
create function tests.cond(p_field text, p_op text, p_value jsonb, p_row jsonb, p_cs boolean default false)
returns boolean language sql as $$
  select exists (select 1 from private.match_rules(tests.id('A'), 'json',
    jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-000000000000',
      'sql', private.rule_condition_sql(p_field, p_op, p_value, p_cs), 'stop', true)),
    null, null, jsonb_build_array(p_row || '{"k":"x"}')))
$$;
create function tests.rule(p_name text, p_conds jsonb, p_actions jsonb, p_priority int default null,
  p_mode text default 'all', p_stop boolean default true) returns uuid language sql as $$
  select public.save_rule(tests.id('A'), jsonb_build_object('name', p_name, 'conditions', p_conds, 'actions', p_actions,
    'priority', p_priority, 'match_mode', p_mode, 'stop_processing', p_stop))
$$;
create function tests.cat(p_txn text) returns uuid language sql stable as $$
  select category_account_id from public.transactions where id = tests.id(p_txn)
$$;
create function tests.net(p_from date, p_to date) returns bigint language sql stable as $$
  select total_cents from public.report_pnl(tests.id('A'), p_from, p_to) where key = 'net_income'
$$;
create function tests.batch_with(p_vendor text, p_amount bigint) returns uuid language plpgsql as $$
declare b uuid;
begin
  insert into public.import_batches (business_id, money_account_id, status, file_name)
  values (tests.id('A'), tests.id('a_chk'), 'staged', 'bank.csv') returning id into b;
  insert into public.import_rows (business_id, import_batch_id, row_index, raw, date, amount_cents, description_raw,
    description_clean, vendor_normalized)
  values (tests.id('A'), b, 0, array['x'], '2026-06-01', p_amount, upper(p_vendor) || ' CHARGE', initcap(p_vendor), p_vendor);
  return b;
end $$;
grant execute on all functions in schema tests to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.match_rules(uuid, text, jsonb, uuid, uuid[], jsonb), private.rule_condition_sql(text, text, jsonb, boolean)
  to authenticated;

select tests.login('ed');
select tests.put('meals', tests.std('A', 'Meals')::text);
select tests.put('office', tests.std('A', 'Office Supplies')::text);
reset role;

-- ---------------------------------------------------------------------------
-- Operators (on one row: "AMZN Mktp US", -$45.00 out of checking on 2026-05-10, imported)
-- ---------------------------------------------------------------------------
create function tests.r() returns jsonb language sql stable as $$
  select jsonb_build_object('description_clean', 'AMZN Mktp US', 'description_raw', 'AMZN MKTP US*2K4 SEATTLE',
    'vendor_normalized', 'amazon', 'amount_cents', -4500, 'money_account_id', tests.id('a_chk'), 'date', '2026-05-10', 'source', 'import')
$$;
select ok(tests.cond('description_clean', 'contains', '"amzn"', tests.r()), 'contains (case-insensitive by default)');
select ok(not tests.cond('description_clean', 'contains', '"amzn"', tests.r(), true), 'contains, case-sensitive');
select ok(tests.cond('description_clean', 'not_contains', '"walmart"', tests.r()), 'not_contains');
select ok(tests.cond('vendor_normalized', 'equals', '"AMAZON"', tests.r()), 'equals');
select ok(tests.cond('description_raw', 'starts_with', '"amzn mktp"', tests.r()), 'starts_with');
select ok(tests.cond('description_raw', 'ends_with', '"seattle"', tests.r()), 'ends_with');
select ok(tests.cond('description_raw', 'regex', '"^amzn mktp us\\*[0-9a-z]+"', tests.r()), 'regex');
select ok(tests.cond('vendor_normalized', 'in', '["costco", "amazon"]', tests.r()), 'in (text)');
select ok(tests.cond('amount', 'equals', '4500', tests.r()), 'amount equals compares the absolute value');
select ok(tests.cond('amount', 'lt', '5000', tests.r()) and not tests.cond('amount', 'lt', '4500', tests.r()), 'lt');
select ok(tests.cond('amount', 'lte', '4500', tests.r()), 'lte');
select ok(tests.cond('amount', 'gt', '4499', tests.r()) and not tests.cond('amount', 'gt', '4500', tests.r()), 'gt');
select ok(tests.cond('amount', 'gte', '4500', tests.r()), 'gte');
select ok(tests.cond('amount', 'between', '[4000, 5000]', tests.r()), 'between');
select ok(tests.cond('amount', 'in', '[100, 4500]', tests.r()), 'in (amounts)');
select ok(tests.cond('direction', 'equals', '"out"', tests.r()) and not tests.cond('direction', 'equals', '"in"', tests.r()), 'direction');
select ok(tests.cond('money_account_id', 'equals', to_jsonb(tests.id('a_chk')), tests.r()), 'money account equals');
select ok(tests.cond('money_account_id', 'in', jsonb_build_array(tests.id('a_card'), tests.id('a_chk')), tests.r()), 'money account in');
select ok(tests.cond('date', 'between', '["2026-05-01", "2026-05-31"]', tests.r()) and tests.cond('date', 'gte', '"2026-05-10"', tests.r())
  and not tests.cond('date', 'lt', '"2026-05-10"', tests.r()), 'date ranges');
select ok(tests.cond('source', 'equals', '"import"', tests.r()) and tests.cond('source', 'in', '["manual","import"]', tests.r()), 'source');

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------
select tests.login('ed');
select throws_ok($$ select tests.rule('Bad regex', '[{"field":"description_raw","operator":"regex","value":"amzn("}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('meals')))) $$,
  '22023', null, 'an invalid regex is rejected on save');
select throws_ok($$ select tests.rule('Slow regex', '[{"field":"description_raw","operator":"regex","value":"(a+)+$"}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('meals')))) $$,
  '22023', null, 'a catastrophic-backtracking regex is rejected');
select throws_ok($$ select tests.rule('Wrong op', '[{"field":"amount","operator":"contains","value":"45"}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('meals')))) $$,
  '22023', null, 'an operator that does not fit the field is rejected');
select throws_ok($$ select tests.rule('No actions', '[{"field":"vendor_normalized","operator":"equals","value":"x"}]', '[]') $$,
  '22023', null, 'a rule needs an action');
select throws_ok($$ select tests.rule('To system', '[{"field":"vendor_normalized","operator":"equals","value":"x"}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('a_uncat')))) $$,
  '22023', null, 'a rule cannot set a system account');

-- ---------------------------------------------------------------------------
-- Legacy vendor rules: same ids, same results
-- ---------------------------------------------------------------------------
select tests.put('legacy', public.save_category_rule(tests.id('A'), 'figma', tests.id('a_soft'))::text);
select results_eq($$ select field, operator, value from public.rule_conditions where rule_id = tests.id('legacy') $$,
  $$ values ('vendor_normalized', 'equals', '"figma"'::jsonb) $$, 'a vendor rule becomes "vendor equals figma"');
select results_eq($$ select action, account_id from public.rule_actions where rule_id = tests.id('legacy') $$,
  $$ values ('set_category', tests.id('a_soft')) $$, '...that sets its category');
select is((select (origin, status, name)::text from public.category_rules where id = tests.id('legacy')),
  '(apply_similar,active,"Vendor is figma")', 'origin, status and name');
select public.save_category_rule(tests.id('A'), 'figma', tests.id('office'));
select is((select account_id from public.rule_actions where rule_id = tests.id('legacy')), tests.id('office'),
  're-saving the old way keeps the action in step');
select public.save_category_rule(tests.id('A'), 'figma', tests.id('a_soft'));

-- Import commit: the vendor rule categorizes exactly as before.
select tests.put('b1', tests.batch_with('figma', -4500)::text);
select public.commit_import(tests.id('b1'), 1);
select results_eq($$ select category_account_id, category_source::text, category_rule_id from public.transactions where import_batch_id = tests.id('b1') $$,
  $$ values (tests.id('a_soft'), 'rule', tests.id('legacy')) $$, 'import: the legacy rule still categorizes figma');
select is((select times_applied from public.category_rules where id = tests.id('legacy')), 1, 'and counts it');
select is((select mode from public.rule_applications where rule_id = tests.id('legacy')), 'auto', 'logged as an automatic application');

-- ---------------------------------------------------------------------------
-- Priority, all/any, stop_processing
-- ---------------------------------------------------------------------------
select tests.put('memo_rule', tests.rule('Tag Amazon', '[{"field":"description_raw","operator":"contains","value":"amzn"}]',
  '[{"action":"append_memo","value":{"text":"#amazon"}}]', 5, 'all', false)::text);
select tests.put('small', tests.rule('Small Amazon is office',
  '[{"field":"description_raw","operator":"contains","value":"amzn"},{"field":"amount","operator":"lt","value":5000}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('office'))), 20)::text);
select tests.put('any_amzn', tests.rule('Amazon is meals',
  '[{"field":"description_raw","operator":"contains","value":"amzn"},{"field":"vendor_normalized","operator":"equals","value":"nope"}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('meals'))), 30, 'any')::text);
select is(public.test_rules(tests.id('A'), tests.r() || '{"amount_cents": -4500}') -> 'winner' ->> 'id', tests.id('small')::text,
  'priority: the higher rule (lower number) wins');
select is(public.test_rules(tests.id('A'), tests.r()) ->> 'memo_append', '#amazon', 'a non-stopping rule above still adds its memo');
select is(jsonb_array_length(public.test_rules(tests.id('A'), tests.r()) -> 'matched'), 2, 'matching stops at the first stop_processing rule');
select is(public.test_rules(tests.id('A'), tests.r() || '{"amount_cents": -9900}') -> 'winner' ->> 'id', tests.id('any_amzn')::text,
  'all: the small-amount rule fails on $99; any: the next rule matches on one condition');
select is((select string_agg((c ->> 'matched'), ',') from jsonb_array_elements(
  public.test_rules(tests.id('A'), tests.r() || '{"amount_cents": -9900}') -> 'winner' -> 'conditions') c), 'true,false',
  'the test box says which conditions matched');

-- ---------------------------------------------------------------------------
-- Apply to existing: hand-set and locked rows untouched; preview = changes; undo exact
-- ---------------------------------------------------------------------------
select tests.put('u1', tests.post('A', '2026-07-01', 'a_chk', -2000, 'AMZN MKTP US A')::text);
select tests.put('u2', tests.post('A', '2026-07-02', 'a_chk', -3000, 'AMZN MKTP US B')::text);
select tests.put('hand', tests.post('A', '2026-07-03', 'a_chk', -2500, 'AMZN MKTP US C', 'meals')::text);
select tests.put('old', tests.post('A', '2026-01-05', 'a_chk', -1000, 'AMZN MKTP US OLD')::text);
select tests.put('big', tests.post('A', '2026-07-04', 'a_chk', -7000, 'AMZN MKTP US BIG')::text);
select tests.login('alice');
update public.businesses set lock_date = '2026-01-31' where id = tests.id('A');
select tests.login('ed');

select tests.put('net_before', tests.net('2026-01-01', '2026-12-31')::text);
select results_eq(
  $$ select transaction_id, new_category_id, rule_name from public.preview_rule_run(tests.id('A')) order by date $$,
  $$ values (tests.id('u1'), tests.id('office'), 'Small Amazon is office'), (tests.id('u2'), tests.id('office'), 'Small Amazon is office'),
            (tests.id('big'), tests.id('meals'), 'Amazon is meals') $$,
  'preview: uncategorized rows only; not the hand-set one; not the locked one');
select is((select new_memo from public.preview_rule_run(tests.id('A')) where transaction_id = tests.id('u1')), '#amazon', 'with the memo rule');
select throws_ok($$ select public.apply_rule_run(tests.id('A'), null, null, null, array[tests.id('u1'), tests.id('u2'), tests.id('big')], 2) $$,
  '40001', null, 'a stale preview count is refused');
select tests.put('run', (public.apply_rule_run(tests.id('A'), null, null, null,
  array[tests.id('u1'), tests.id('u2'), tests.id('big')], 3) ->> 'run_id'));
select results_eq($$ select category_account_id, category_source::text, category_rule_id, memo from public.transactions
                     where id in (tests.id('u1'), tests.id('u2'), tests.id('big'), tests.id('hand'), tests.id('old')) order by date $$,
  $$ values (null::uuid, null::text, null::uuid, null::text),
            (tests.id('office'), 'rule', tests.id('small'), '#amazon'), (tests.id('office'), 'rule', tests.id('small'), '#amazon'),
            (tests.id('meals'), 'user', null::uuid, null::text), (tests.id('meals'), 'rule', tests.id('any_amzn'), '#amazon') $$,
  'applied: rule categories and memos; hand-set and locked rows untouched');
select is((select count(*)::int from public.rule_applications where run_id = tests.id('run')), 3, 'every change logged in the run');
select is((select sum(amount_cents)::int from public.journal_lines where transaction_id = tests.id('u1')), 0, 'lines reposted, balanced');
select is((select count(*)::int from public.preview_rule_run(tests.id('A'))), 0, 'running again changes nothing');

-- A rule-set row can be re-categorized by a better rule; a hand edit takes it out of rules' reach.
select public.categorize_transactions(array[tests.id('u2')], tests.id('a_soft'));
select is((select category_source::text from public.transactions where id = tests.id('u2')), 'user', 'a hand edit makes it the person''s');
select is((select count(*)::int from public.preview_rule_run(tests.id('A')) where transaction_id = tests.id('u2')), 0,
  '...and rules leave it alone');

select is(public.undo_rule_run(tests.id('run')), '{"skipped": 1, "restored": 2}'::jsonb, 'undo: restores rows still as the run left them');
select results_eq($$ select category_account_id, category_source::text, category_rule_id, memo from public.transactions
                     where id in (tests.id('u1'), tests.id('big')) order by date $$,
  $$ values (null::uuid, null::text, null::uuid, null::text), (null::uuid, null::text, null::uuid, null::text) $$,
  'undo restores the previous category, source and memo exactly');
select is(tests.cat('u2'), tests.id('a_soft'), 'a row edited since the run is skipped by undo');
select public.categorize_transactions(array[tests.id('u2')], null);
select is(tests.net('2026-01-01', '2026-12-31')::text, current_setting('tests.net_before'), 'P&L totals are the same after the undo');

-- ---------------------------------------------------------------------------
-- Rules run before AI; skip_ai keeps rows away from Anthropic
-- ---------------------------------------------------------------------------
select tests.login('alice');
update public.businesses set ai_enabled = true where id = tests.id('A');
select tests.login('ed');
select tests.put('secret', tests.post('A', '2026-08-01', 'a_chk', -1000, 'PRIVATE CLINIC VISIT')::text);
select tests.put('plain', tests.post('A', '2026-08-02', 'a_chk', -1000, 'SOMETHING NEW')::text);
select tests.rule('Keep clinic visits private', '[{"field":"description_raw","operator":"contains","value":"clinic"}]',
  '[{"action":"skip_ai"}]', 1);
select ok(not exists (select 1 from public.ai_candidates(tests.id('A')) where id = tests.id('secret')), 'skip_ai rows are never sent to AI');
select ok(not exists (select 1 from public.ai_candidates(tests.id('A')) where id in (tests.id('u1'), tests.id('big'))),
  'rows a rule would categorize are not sent to AI');
select ok(exists (select 1 from public.ai_candidates(tests.id('A')) where id = tests.id('plain')), 'other rows still are');

-- ---------------------------------------------------------------------------
-- Conflicts, drawer, reorder, duplicate, drafts, delete with revert
-- ---------------------------------------------------------------------------
select results_eq($$ select rule_id, overlap from public.rule_conflicts(tests.id('A'), jsonb_build_object('name', 'Amazon is software',
    'conditions', '[{"field":"description_raw","operator":"contains","value":"amzn mktp"}]'::jsonb,
    'actions', jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('a_soft'))))) order by priority $$,
  $$ values (tests.id('small'), 4), (tests.id('any_amzn'), 5) $$,
  'conflicts: higher-priority rules with a different category on the same rows');
select ok((public.rule_draft_matches(tests.id('A'), jsonb_build_object('conditions',
  '[{"field":"description_raw","operator":"contains","value":"amzn"}]'::jsonb)) ->> 'count')::int >= 5, 'live counter');

select tests.put('drawer', tests.post('A', '2026-08-03', 'a_chk', -1500, 'AMZN MKTP US D', 'office')::text);
select is(public.mark_transaction_rule(tests.id('drawer'), tests.id('small')), true, 'drawer: a rule-filled category is recorded as the rule''s');
select is((select (category_source, category_rule_id = tests.id('small'))::text from public.transactions where id = tests.id('drawer')), '(rule,t)', '...source and rule');
select is(public.mark_transaction_rule(tests.id('drawer'), tests.id('any_amzn')), false, '...only when that rule is really the winner');

select public.reorder_rules(tests.id('A'), array[tests.id('any_amzn'), tests.id('small')]);
select is(public.test_rules(tests.id('A'), tests.r()) -> 'winner' ->> 'id', tests.id('any_amzn')::text, 'reorder changes the winner');
select tests.put('dup', public.duplicate_rule(tests.id('small'))::text);
select is((select (name, enabled)::text from public.category_rules where id = tests.id('dup')), '("Copy of Small Amazon is office",f)', 'duplicate starts disabled');
select is((select count(*)::int from public.rule_conditions where rule_id = tests.id('dup')), 2, '...with the same conditions');

reset role;
insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, confirmations)
values (tests.id('A'), 'zoom', tests.id('a_soft'), 'auto', 3);
select is((select status from public.category_rules where vendor_normalized = 'zoom' and business_id = tests.id('A')), 'draft', 'pattern-engine rules are drafts');
select tests.put('zoom_rule', (select id from public.category_rules where vendor_normalized = 'zoom' and business_id = tests.id('A'))::text);
insert into public.category_rules (business_id, vendor_normalized, category_account_id, source, confirmations)
values (tests.id('A'), 'figma', tests.id('a_soft'), 'auto', 3) on conflict do nothing;
select is((select count(*)::int from public.category_rules where business_id = tests.id('A') and vendor_normalized = 'figma'), 1,
  'no suggestion for a vendor an active rule already covers');
select tests.login('ed');
select public.approve_rule(tests.id('zoom_rule'));
select is((select status from public.category_rules where id = tests.id('zoom_rule')), 'active', 'approve');

select public.reorder_rules(tests.id('A'), array[tests.id('small'), tests.id('any_amzn')]);
select tests.put('run2', (public.apply_rule_run(tests.id('A'), array[tests.id('small')], null, null,
  array(select transaction_id from public.preview_rule_run(tests.id('A'), array[tests.id('small')])),
  (select count(*)::int from public.preview_rule_run(tests.id('A'), array[tests.id('small')]))) ->> 'run_id'));
select ok((select count(*) from public.transactions where category_rule_id = tests.id('small')) >= 2, 'applied the small-amount rule');
select ok(public.delete_rule(tests.id('small'), true) >= 2, 'delete and revert');
select is((select count(*)::int from public.transactions where category_rule_id = tests.id('small')), 0, 'its categories are reverted');
select is(tests.cat('drawer'), null, '...back to what they were before the rule (empty)');
select is((select deleted_at is not null from public.category_rules where id = tests.id('small')), true, 'the rule is a tombstone');

-- Filter by who categorized.
select ok((select count(*) from public.search_transactions(tests.id('A'), p_categorized_by => '{rule}')) =
          (select count(*) from public.transactions where business_id = tests.id('A') and deleted_at is null and category_source = 'rule'),
  'filter: categorized by rule');
select ok((select count(*) from public.search_transactions(tests.id('A'), p_categorized_by => '{hand}')) > 0, 'filter: by hand');

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
select tests.login('vic');
select ok((select count(*) from public.rule_conditions where business_id = tests.id('A')) > 0, 'viewers read rules');
select ok((select count(*) from public.preview_rule_run(tests.id('A'))) >= 0, 'viewers can preview');
select throws_ok($$ select tests.rule('Viewer rule', '[{"field":"vendor_normalized","operator":"equals","value":"x"}]',
  jsonb_build_array(jsonb_build_object('action','set_category','account_id', tests.id('meals')))) $$, '42501', null, 'viewers cannot save rules');
select throws_ok($$ select public.apply_rule_run(tests.id('A'), null, null, null, '{}', 0) $$, '42501', null, 'viewers cannot apply');
select throws_ok($$ insert into public.rule_conditions (business_id, rule_id, field, operator, value)
  values (tests.id('A'), tests.id('legacy'), 'amount', 'gt', '1') $$, '42501', null, 'conditions are written only through save_rule');
select tests.login('bob');
select is((select count(*)::int from public.rule_actions where business_id = tests.id('A')), 0, 'outsiders see no rules');
select throws_ok($$ select public.test_rules(tests.id('A'), '{}') $$, '42501', null, 'outsiders cannot test rules');

select * from finish();
rollback;

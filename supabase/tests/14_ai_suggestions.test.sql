-- AI category suggestions, database side: what may be sent, recording (validated,
-- idempotent, superseding), nothing categorized without acceptance unless auto-apply is
-- on, accept / reject / correct, "accept all above", budget, and access.
begin;
\ir _setup.psql
select no_plan();

create function tests.pv(p_date date, p_amount bigint, p_vendor text, cat text default null, p_memo text default null)
returns uuid language sql as $$
  select public.post_transaction(tests.id('A'), p_date, tests.id('a_card'), p_amount, upper(p_vendor), tests.id(cat),
    initcap(p_vendor), p_vendor, p_memo)
$$;
create function tests.rec(p_key text, p_suggestions jsonb) returns jsonb language sql as $$
  select public.record_ai_suggestions(tests.id('A'), p_key, 'claude-haiku-5-5', 'test-v1', 1200, 1000, 200, p_suggestions)
$$;
create function tests.sug(txn text, cat text, conf numeric) returns jsonb language sql stable as $$
  select jsonb_build_object('transaction_id', tests.id(txn), 'category_id', tests.id(cat), 'confidence', conf,
    'reason', 'Looks like software', 'flags', jsonb_build_array('personal?'))
$$;
create function tests.status(txn text) returns text language sql stable as $$
  select string_agg(status::text, ',' order by request_key) from public.ai_suggestions where transaction_id = tests.id(txn)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('alice');
update public.businesses set ai_enabled = true where id = tests.id('A');
select tests.put('meals', tests.std('A', 'Meals')::text);
select tests.put('office', tests.std('A', 'Office Supplies')::text);

select tests.login('ed');
select tests.put('t1', tests.pv('2026-09-01', -4500, 'figma', null, 'card ending 4242 for jane@example.com')::text);
select tests.put('t2', tests.pv('2026-09-02', -900, 'github')::text);
select public.save_category_rule(tests.id('A'), 'github', tests.id('a_soft'));
select tests.put('t3', tests.pv('2026-08-01', -1200, 'notion', 'a_soft')::text);

-- ---------------------------------------------------------------------------
-- What may be sent
-- ---------------------------------------------------------------------------
select is((select array_agg(id) from public.ai_candidates(tests.id('A'))), array[tests.id('t1')],
  'candidates: uncategorized, without a matching rule');
select is((select memo from public.ai_candidates(tests.id('A'))), null, 'memos are not sent by default');
select is((select money_account_kind from public.ai_candidates(tests.id('A'))), 'credit_card', 'the money account type is sent');
select tests.login('alice');
update public.businesses set ai_share_memos = true where id = tests.id('A');
select tests.login('ed');
select is((select memo from public.ai_candidates(tests.id('A'))), 'card ending 4242 for jane@example.com', '...unless the owner opts in');
select tests.login('alice');
update public.businesses set ai_share_memos = false where id = tests.id('A');
select tests.login('ed');

select is(
  (select array_agg(distinct k order by k) from jsonb_array_elements(public.ai_context(tests.id('A')) -> 'categories') c, jsonb_object_keys(c) k),
  array['description', 'id', 'name', 'type'], 'categories carry only id, name, type and description');
select ok(not exists (
  select 1 from jsonb_array_elements(public.ai_context(tests.id('A')) -> 'categories') c
  join public.accounts a on a.id = (c ->> 'id')::uuid where a.is_system or a.is_money_account or a.is_hidden),
  'no system, money or hidden accounts in the category list');
select is(public.ai_context(tests.id('A')) -> 'examples', '[{"category": "Software", "description": "Notion"}]'::jsonb,
  'examples: what people chose');
-- Ids are random and can contain 4242 by chance: look past them.
select ok(regexp_replace(public.ai_context(tests.id('A'))::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', 'g') !~ '4242|example\.com',
  'no account numbers or emails in the context');

-- ---------------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------------
select is(tests.rec('key-00000001', jsonb_build_array(tests.sug('t1', 'a_soft', 0.95), tests.sug('t1', 'a_chk', 0.9), tests.sug('t1', 'a_uncat', 0.9))),
  '{"inserted": 1, "skipped": 2, "auto_applied": 0}'::jsonb, 'record: money and system accounts are refused');
select is((select category_account_id from public.transactions where id = tests.id('t1')), null,
  'nothing is categorized without acceptance');
select is((select (model, prompt_version, latency_ms, input_tokens, output_tokens, flags)::text from public.ai_suggestions where transaction_id = tests.id('t1')),
  '(claude-haiku-5-5,test-v1,1200,1000,200,{personal?})', 'model, prompt version, latency, tokens and flags are logged');
select is(tests.rec('key-00000001', jsonb_build_array(tests.sug('t1', 'a_soft', 0.95))) ->> 'inserted', '0',
  're-running the same batch adds nothing');
select is((select count(*)::int from public.ai_suggestions where transaction_id = tests.id('t1')), 1, '...still one suggestion');
select is(public.ai_request_done(tests.id('A'), 'key-00000001'), true, 'the server can see a batch was already done');
select is((select array_agg(id) from public.ai_candidates(tests.id('A'))), null, 'a pending suggestion takes the row out of candidates');

select tests.rec('key-00000002', jsonb_build_array(tests.sug('t1', 'meals', 0.7)));
select is(tests.status('t1'), 'superseded,pending', 'a newer suggestion supersedes the pending one');

select results_eq($$ select used, budget, remaining from public.ai_budget(tests.id('A')) $$,
  $$ values (3600::bigint, 2000000::bigint, 1996400::bigint) $$, 'usage counts every call');

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------
select tests.put('s1', (select id from public.ai_suggestions where transaction_id = tests.id('t1') and status = 'pending')::text);
select public.accept_ai_suggestion(tests.id('s1'));
select results_eq($$ select category_account_id, category_source::text from public.transactions where id = tests.id('t1') $$,
  $$ values (tests.id('meals'), 'user') $$, 'accept: categorized, as the person''s choice (counts toward rules)');
select is(tests.status('t1'), 'superseded,accepted', 'accept: suggestion accepted');
select throws_ok($$ select public.accept_ai_suggestion(tests.id('s1')) $$, '22023', null, 'a decided suggestion cannot be accepted again');

select tests.put('t4', tests.pv('2026-09-04', -2500, 'zoom')::text);
select tests.rec('key-00000003', jsonb_build_array(tests.sug('t4', 'a_soft', 0.8)));
select public.reject_ai_suggestion((select id from public.ai_suggestions where transaction_id = tests.id('t4')));
select is(tests.status('t4'), 'rejected', 'reject');
select is((select category_account_id from public.transactions where id = tests.id('t4')), null, '...leaves the row uncategorized');
select ok(public.ai_context(tests.id('A')) -> 'rejections' @> '[{"description": "Zoom", "not_category": "Software"}]',
  'rejections go back as negative examples');
select is((select count(*)::int from public.ai_candidates(tests.id('A')) where id = tests.id('t4')), 1, 'a rejected row can be suggested again');
select tests.rec('key-00000004', jsonb_build_array(tests.sug('t4', 'office', 0.5)));
select public.reject_ai_suggestion((select id from public.ai_suggestions where transaction_id = tests.id('t4') and status = 'pending'));
select is((select count(*)::int from public.ai_candidates(tests.id('A')) where id = tests.id('t4')), 0, '...but not after two rejections');

-- Picking another category corrects the suggestion.
select tests.put('t5', tests.pv('2026-09-05', -3000, 'uber')::text);
select tests.rec('key-00000005', jsonb_build_array(tests.sug('t5', 'a_soft', 0.6)));
select public.categorize_transactions(array[tests.id('t5')], tests.id('meals'));
select is(tests.status('t5'), 'rejected', 'pick another: the suggestion counts as corrected');

-- Accept all above X%.
select tests.put('t6', tests.pv('2026-09-06', -100, 'adobe')::text);
select tests.put('t7', tests.pv('2026-09-07', -200, 'slack')::text);
select tests.put('t8', tests.pv('2026-09-08', -300, 'chipotle')::text);
select tests.rec('key-00000006', jsonb_build_array(tests.sug('t6', 'a_soft', 0.95), tests.sug('t7', 'a_soft', 0.85), tests.sug('t8', 'meals', 0.7)));
select is(public.count_ai_suggestions_above(tests.id('A'), 0.8), 2, 'preview: 2 above 80%');
select throws_ok($$ select public.accept_ai_suggestions_above(tests.id('A'), 0.8, 3) $$, '40001', null, 'a stale preview is refused');
select is(public.accept_ai_suggestions_above(tests.id('A'), 0.8, 2), 2, 'accept all above 80%');
select results_eq($$ select id, category_account_id is not null from public.transactions where id in (tests.id('t6'), tests.id('t7'), tests.id('t8')) order by date $$,
  $$ values (tests.id('t6'), true), (tests.id('t7'), true), (tests.id('t8'), false) $$, '...only those');

-- Auto-apply, when the owner turns it on, only at 0.9+.
select tests.login('alice');
update public.businesses set ai_auto_apply = true where id = tests.id('A');
select tests.login('ed');
select tests.put('t9', tests.pv('2026-09-09', -400, 'canva')::text);
select tests.put('t10', tests.pv('2026-09-10', -500, 'lyft')::text);
select is(tests.rec('key-00000007', jsonb_build_array(tests.sug('t9', 'a_soft', 0.92), tests.sug('t10', 'meals', 0.6))) ->> 'auto_applied', '1',
  'auto-apply: one at 92%');
select results_eq($$ select category_account_id, category_source::text from public.transactions where id = tests.id('t9') $$,
  $$ values (tests.id('a_soft'), 'ai') $$, 'auto-applied rows are marked ai (not a person''s choice)');
select is((select category_account_id from public.transactions where id = tests.id('t10')), null, '60% waits for a person');
select is(tests.status('t9'), 'accepted', 'the auto-applied suggestion is accepted');

-- Accepted suggestions feed rules; auto-applied ones don't.
select tests.put('z1', tests.pv('2026-07-01', -1500, 'zapier')::text);
select tests.put('z2', tests.pv('2026-08-01', -1500, 'zapier')::text);
select tests.put('z3', tests.pv('2026-09-01', -1500, 'zapier')::text);
select tests.login('alice');
update public.businesses set ai_auto_apply = false where id = tests.id('A');
select tests.login('ed');
select tests.rec('key-00000008', jsonb_build_array(tests.sug('z1', 'a_soft', 0.9), tests.sug('z2', 'a_soft', 0.9), tests.sug('z3', 'a_soft', 0.9)));
select public.accept_ai_suggestions_above(tests.id('A'), 0.9, 3);
select public.refresh_patterns(tests.id('A'));
select is((select (source::text, confirmations) from public.category_rules where business_id = tests.id('A') and vendor_normalized = 'zapier')::text,
  '(auto,3)', 'three accepted suggestions make a rule');

-- Budget.
select tests.login('alice');
update public.businesses set ai_monthly_token_budget = 1000 where id = tests.id('A');
select is((select remaining from public.ai_budget(tests.id('A'))), 0::bigint, 'budget: nothing left once usage passes it');

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
select tests.login('vic');
select ok((select count(*) from public.ai_suggestion_queue where business_id = tests.id('A')) > 0, 'viewers see pending suggestions');
select throws_ok($$ select public.accept_ai_suggestion((select id from public.ai_suggestion_queue limit 1)) $$, '42501', null, 'viewers cannot accept');
select throws_ok($$ select tests.rec('key-00000099', '[]') $$, '42501', null, 'viewers cannot record');
select throws_ok($$ select * from public.ai_candidates(tests.id('A')) $$, '42501', null, 'viewers cannot fetch candidates');
select tests.login('ed');
select throws_ok($$ insert into public.ai_suggestions (business_id, transaction_id, category_account_id, confidence, model, prompt_version, request_key)
  values (tests.id('A'), tests.id('t10'), tests.id('a_soft'), 0.99, 'x', 'x', 'x') $$, '42501', null, 'suggestions cannot be written directly');
select throws_ok($$ update public.ai_suggestions set status = 'accepted' $$, '42501', null, '...or edited directly');
select tests.login('bob');
select is((select count(*)::int from public.ai_suggestions where business_id = tests.id('A')), 0, 'outsiders see no suggestions');
select is((select count(*)::int from public.ai_usage where business_id = tests.id('A')), 0, '...or usage');
select throws_ok($$ select public.ai_context(tests.id('A')) $$, '42501', null, 'outsiders cannot read the context');

select * from finish();
rollback;

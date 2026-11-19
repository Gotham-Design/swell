-- Auto-filing confident suggestions: 0.9+ from the AI, any vendor-history pick, never when
-- flagged, never when the business turned it off; filed rows are marked 'ai'.
begin;
\ir _setup.psql
select no_plan();

create function tests.pv(p_date date, p_amount bigint, p_vendor text)
returns uuid language sql as $$
  select public.post_transaction(tests.id('A'), p_date, tests.id('a_card'), p_amount, upper(p_vendor), null,
    initcap(p_vendor), p_vendor, null)
$$;
create function tests.rec(p_key text, p_model text, p_suggestions jsonb) returns jsonb language sql as $$
  select public.record_ai_suggestions(tests.id('A'), p_key, p_model, 'test-v1', 300, 0, 0, p_suggestions)
$$;
create function tests.sug(t text, c numeric, flags text[] default '{}') returns jsonb language sql as $$
  select jsonb_build_object('transaction_id', tests.id(t), 'category_id', tests.id('a_soft'), 'confidence', c, 'flags', to_jsonb(flags))
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('alice');
update public.businesses set ai_enabled = true where id = tests.id('A');
select is((select ai_auto_file from public.businesses where id = tests.id('A')), true, 'auto-filing is on by default');

select tests.login('ed');
select tests.put('sure', tests.pv('2026-10-01', -4500, 'figma')::text);
select tests.put('unsure', tests.pv('2026-10-02', -900, 'chipotle')::text);
select tests.put('flagged', tests.pv('2026-10-03', -50000, 'chase epay')::text);
select tests.put('hist', tests.pv('2026-10-04', -1200, 'notion')::text);
select tests.rec('key-ai-000001', 'jev-1.14.0', jsonb_build_array(tests.sug('sure', 0.95), tests.sug('unsure', 0.87), tests.sug('flagged', 0.93, '{"personal?"}')));
select tests.rec('key-hist-0001', 'vendor-history', jsonb_build_array(tests.sug('hist', 0.75)));

select is(public.auto_file_suggestions(tests.id('A')), 2, 'files the confident AI pick and the vendor-history pick');
select results_eq(
  $$ select category_source::text from public.transactions where id in (tests.id('sure'), tests.id('hist')) order by date $$,
  $$ values ('ai'::text), ('ai') $$, 'filed rows are marked ai');
select is((select category_account_id from public.transactions where id = tests.id('unsure')), null, 'below 0.9 waits for a person');
select is((select category_account_id from public.transactions where id = tests.id('flagged')), null, 'a flagged pick waits for a person');
select is((select status::text from public.ai_suggestions where transaction_id = tests.id('sure')), 'accepted', 'the suggestion is decided');
select is(public.auto_file_suggestions(tests.id('A')), 0, 'running again files nothing new');

-- A vendor people filed the same way twice is filed even with no suggestion.
select public.post_transaction(tests.id('A'), '2026-09-01', tests.id('a_card'), -1500, 'NOTION LABS', tests.id('a_soft'), 'Notion Labs', 'notion labs', null);
select public.post_transaction(tests.id('A'), '2026-09-15', tests.id('a_card'), -1500, 'NOTION LABS', tests.id('a_soft'), 'Notion Labs', 'notion labs', null);
select tests.put('taught', tests.pv('2026-10-06', -1500, 'notion labs')::text);
select is(public.auto_file_suggestions(tests.id('A')), 1, 'a vendor filed the same way twice is filed automatically');
select is((select category_account_id from public.transactions where id = tests.id('taught')), tests.id('a_soft'), '...to that category');

select tests.login('alice');
update public.businesses set ai_auto_file = false where id = tests.id('A');
select tests.login('ed');
select tests.put('later', tests.pv('2026-10-05', -4500, 'figma')::text);
select tests.rec('key-ai-000002', 'jev-1.14.0', jsonb_build_array(tests.sug('later', 0.99)));
select is(public.auto_file_suggestions(tests.id('A')), 0, 'off means off');

select tests.login('vic');
select throws_ok($$ select public.auto_file_suggestions(tests.id('A')) $$, '42501', null, 'viewers cannot file');

select * from finish();
rollback;

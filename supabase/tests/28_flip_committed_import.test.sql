-- flip_committed_import: an imported statement's money in and out swapped after the fact.
begin;
\ir _setup.psql
select no_plan();

create function tests.batch(biz text, money text) returns uuid language sql as $$
  insert into public.import_batches (business_id, money_account_id, status, file_name, header_signature, mapping)
  values (tests.id(biz), tests.id(money), 'staged', 'card.csv', 'date|amount|description',
    '{"amountMode":"signed","signConvention":"positive_in"}') returning id
$$;
create function tests.stage(batch text, idx int, d date, amt bigint, clean text) returns void language sql as $$
  insert into public.import_rows (business_id, import_batch_id, row_index, raw, date, amount_cents, description_raw,
    description_clean, vendor_normalized)
  select b.business_id, b.id, idx, array[d::text, amt::text, clean], d, amt, upper(clean), clean, lower(clean)
  from public.import_batches b where b.id = tests.id(batch)
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('ed');
insert into public.import_templates (business_id, money_account_id, header_signature, mapping)
values (tests.id('A'), tests.id('a_card'), 'date|amount|description', '{"amountMode":"signed","signConvention":"positive_in"}');
select tests.put('b', tests.batch('A', 'a_card')::text);
-- A card statement read the wrong way: purchases came in positive.
select tests.stage('b', 0, '2026-05-01', 4500, 'Figma');
select tests.stage('b', 1, '2026-05-02', 1200, 'Lunch');
select tests.stage('b', 2, '2026-05-03', -30000, 'Payment Thank You');
select public.verify_import(tests.id('b'));
select is(public.commit_import(tests.id('b'), 3), 3, 'committed the wrong way round');
-- A person filed the payment; an AI filed Figma.
select public.categorize_transactions(array(select id from public.transactions where import_batch_id = tests.id('b') and description_clean = 'Payment Thank You'), tests.id('a_chk'));
select public.categorize_transactions(array(select id from public.transactions where import_batch_id = tests.id('b') and description_clean = 'Figma'), tests.id('a_soft'));
reset role;
update public.transactions set category_source = 'ai' where import_batch_id = tests.id('b') and description_clean = 'Figma';
select tests.login('ed');

select is(public.flip_committed_import(tests.id('b')), 3, 'flips every transaction');
select results_eq(
  $$ select description_clean, amount_cents from public.transactions where import_batch_id = tests.id('b') order by description_clean $$,
  $$ values ('Figma', -4500::bigint), ('Lunch', -1200), ('Payment Thank You', 30000) $$, 'amounts negated');
select is((select category_account_id from public.transactions where import_batch_id = tests.id('b') and description_clean = 'Figma'), null,
  'a category the AI chose for the wrong direction is cleared');
select is((select category_account_id from public.transactions where import_batch_id = tests.id('b') and description_clean = 'Payment Thank You'), tests.id('a_chk'),
  'a category a person chose stays');
select is((select sum(l.amount_cents) from public.journal_lines l join public.transactions t on t.id = l.transaction_id where t.import_batch_id = tests.id('b')),
  0::numeric, 'journal lines still balance');
select results_eq($$ select total_in_cents, total_out_cents from public.import_batches where id = tests.id('b') $$,
  $$ values (30000::bigint, -5700::bigint) $$, 'batch totals swap');
select is((select mapping ->> 'signConvention' from public.import_templates where money_account_id = tests.id('a_card')), 'positive_out',
  'the saved mapping flips, so the next statement imports the right way');

select is(public.flip_committed_import(tests.id('b')), 3, 'flipping again puts it back');
select is((select amount_cents from public.transactions where import_batch_id = tests.id('b') and description_clean = 'Figma'), 4500::bigint, '...amounts restored');

select tests.login('bob');
select throws_ok($$ select public.flip_committed_import(tests.id('b')) $$, '42501', null, 'another business cannot flip it');

select * from finish();
rollback;

-- Hardening (SPEC Prompt 12): cover the business-scoped foreign keys the Supabase
-- advisor flagged, so deletes and merges of accounts, rules and transactions don't scan
-- the child tables. (Foreign keys to auth.users are left: users are rarely deleted.)
create index account_tax_lines_account_idx on public.account_tax_lines (business_id, account_id);
create index accounts_opening_transaction_idx on public.accounts (business_id, opening_transaction_id)
  where opening_transaction_id is not null;
create index ai_suggestions_category_idx on public.ai_suggestions (business_id, category_account_id);
create index category_rules_category_idx on public.category_rules (business_id, category_account_id);
create index import_batches_money_account_idx on public.import_batches (business_id, money_account_id);
create index import_rows_category_idx on public.import_rows (business_id, category_account_id)
  where category_account_id is not null;
create index import_templates_money_account_idx on public.import_templates (business_id, money_account_id);
create index journal_lines_business_transaction_idx on public.journal_lines (business_id, transaction_id);
create index transaction_patterns_category_idx on public.transaction_patterns (business_id, typical_category_id)
  where typical_category_id is not null;
create index transactions_rule_idx on public.transactions (business_id, category_rule_id)
  where category_rule_id is not null;

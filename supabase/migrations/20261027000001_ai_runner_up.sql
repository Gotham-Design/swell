-- Jev returns a probability for every category, so each suggestion can carry the
-- second-best category. The transaction drawer offers it as a second button.
-- Nullable: older suggestions (and any model that returns only one pick) have none.
alter table public.ai_suggestions
  add column runner_up_category_account_id uuid,
  add column runner_up_confidence numeric(4, 3)
    check (runner_up_confidence is null or runner_up_confidence between 0 and 1),
  add constraint ai_suggestions_runner_up_fk
    foreign key (business_id, runner_up_category_account_id)
    references public.accounts (business_id, id) on delete set null (runner_up_category_account_id),
  add constraint ai_suggestions_runner_up_differs
    check (runner_up_category_account_id is null or runner_up_category_account_id <> category_account_id);

comment on column public.ai_suggestions.runner_up_category_account_id is
  'Second most likely category from the model''s distribution, offered as an alternative in the drawer.';

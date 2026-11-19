-- Overlapping statements (a mid-month download, then the full month) bring rows that are
-- already in the books. Exact matches were always skipped; close matches (same account and
-- amount within two days, same vendor) were posted unless someone excluded them. Bank text
-- shifts between a CSV and a PDF of the same account, so a close match is far more often the
-- same transaction than a new one: skip it by default too. The import review still lists it
-- as a possible duplicate next to the transaction it matches, with "Include anyway", and a
-- statement whose balances no longer add up says so before anything is posted.
alter table public.import_rows drop column included;
alter table public.import_rows add column included boolean generated always as (
  case when status = 'error' then false
       when decision is not null then decision = 'include'
       else status = 'ok' end
) stored;

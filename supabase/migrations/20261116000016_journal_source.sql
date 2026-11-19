-- Journal entries: postings with no bank or card side (depreciation first). Added on its own
-- because a new enum value can't be used in the transaction that adds it.
alter type public.transaction_source add value if not exists 'journal';

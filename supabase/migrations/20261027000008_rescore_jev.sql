-- Jev picks are now scored against their closest specific rival once Jev clearly leans one way
-- (src/lib/ai/jev.ts pickConfidence), so an obvious pick isn't held back by probability spread
-- over catch-alls and "none of these". Pending Jev suggestions from before the change can't be
-- re-scored here (only the runner-up was stored), so they're set aside: the transactions show
-- as having no suggestion yet, and the next "Suggest categories" or import asks again (cheap),
-- then files the confident ones.
update public.ai_suggestions
set status = 'superseded'
where status = 'pending' and model like 'jev%';

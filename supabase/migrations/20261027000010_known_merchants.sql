-- Well-known merchants (State Farm, Verizon, Adobe, Shell...) are now answered locally at
-- 0.95 and filed automatically (src/lib/ai/known.ts). Pending model suggestions under the
-- auto-file line are set aside so the next run (it starts on its own when the overview or
-- transactions open) can answer them through the new tier; anything it doesn't know goes
-- back to the model.
update public.ai_suggestions
set status = 'superseded'
where status = 'pending' and model like 'jev%' and confidence < 0.9;

-- Phase 2, Task 2.1 (see employer-monetization-detailed-implementation-plan.md):
-- seed contact-credit and boost-credit packs so the named-balance split has
-- something purchasable for all three benefit types, not just job_post.
--
-- Deliberately NOT touched: the 4 existing job-post packs (Starter/Growth/
-- Pro/Enterprise, seeded by 20260623043258_a6bfa0d3-...sql) — they already
-- work today and are correctly tagged benefit_type='job_post' by the
-- previous migration's DEFAULT. Renaming/repricing them to match the
-- strategy doc's hypothetical "Starter Job Pack ₹1,499 / 3 credits" catalog
-- is a pricing decision for the business, not an engineering one — out of
-- scope here. Prices below are explicitly test hypotheses (strategy doc
-- §4.3), not final pricing.

INSERT INTO public.credit_packs (name, credits, price_inr, badge, sort, benefit_type)
SELECT 'Sourcing 25', 25, 999, NULL, 10, 'contact'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packs WHERE name = 'Sourcing 25');

INSERT INTO public.credit_packs (name, credits, price_inr, badge, sort, benefit_type)
SELECT 'Sourcing 100', 100, 3299, 'Best value', 11, 'contact'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packs WHERE name = 'Sourcing 100');

INSERT INTO public.credit_packs (name, credits, price_inr, badge, sort, benefit_type)
SELECT 'Boost Pack', 10, 799, NULL, 20, 'boost'
WHERE NOT EXISTS (SELECT 1 FROM public.credit_packs WHERE name = 'Boost Pack');

-- apply_boost() records a boost covered by the plan's monthly allowance with credits_spent = 0
-- (source = 'monthly_pool'), but the original CHECK (credits_spent > 0) rejected that row, so every
-- allowance-covered boost failed. Intended rule: wallet boosts cost >= 1 credit, allowance boosts
-- cost 0. The constraint is narrowed to exactly that, not removed.

ALTER TABLE public.job_boosts DROP CONSTRAINT IF EXISTS job_boosts_credits_spent_check;
ALTER TABLE public.job_boosts
  ADD CONSTRAINT job_boosts_credits_spent_check
  CHECK (credits_spent > 0 OR (credits_spent = 0 AND source = 'monthly_pool'));

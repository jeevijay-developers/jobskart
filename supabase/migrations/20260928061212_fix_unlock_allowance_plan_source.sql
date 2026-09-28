-- Fix job_unlock_allowance seeding to read the company's ACTUAL plan
-- (see employer-monetization-detailed-implementation-plan.md Phase 0, Task 0.1).
--
-- Bug: tg_seed_job_unlock_allowance() (20260924103235_db_access_model.sql) read
-- the flat global singleton plan_settings.unlocks_per_job (default 25) instead
-- of the company's resolved plans.limits->>'unlocks_per_job' (Basic: 0,
-- Regular: 50, Unlimited: -1). Every job on every plan — including Basic,
-- which should get 0 — was seeded with 25 free unlocks.
--
-- This migration does NOT call get_company_entitlements(_company_id): that
-- function raises 'Forbidden' when auth.uid() has no company membership
-- (has_company_membership(NULL, ...) is false), which would break this
-- trigger for any future service-role/admin-driven job insert/update that
-- runs without a user JWT in context. Instead it inlines the same
-- active-plan lookup with no auth gate.
--
-- 'unlimited' (-1 in plans.limits) is represented as a large sentinel total
-- (1000000), not a schema change — the existing
-- job_unlock_allowance_bounds CHECK (used >= 0 AND used <= total) and
-- unlock_candidate()'s `WHERE used < total` guard both already work
-- unmodified against a large sentinel.

CREATE OR REPLACE FUNCTION public.tg_seed_job_unlock_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _raw int;
  _total int;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT (p.limits->>'unlocks_per_job')::int INTO _raw
      FROM public.company_plans cp
      JOIN public.plans p ON p.id = cp.plan_id
      WHERE cp.company_id = NEW.company_id
        AND cp.status = 'active'
        AND (cp.ends_at IS NULL OR cp.ends_at > now())
      LIMIT 1;

    IF _raw IS NULL THEN
      SELECT (p.limits->>'unlocks_per_job')::int INTO _raw
        FROM public.plans p
        WHERE p.name = 'Basic' AND p.is_custom = false
        ORDER BY p.created_at
        LIMIT 1;
    END IF;

    _total := CASE
      WHEN _raw IS NULL THEN 25              -- last-resort default (Basic row itself missing)
      WHEN _raw = -1 THEN 1000000             -- unlimited sentinel
      ELSE _raw
    END;

    INSERT INTO public.job_unlock_allowance (job_id, company_id, total)
      VALUES (NEW.id, NEW.company_id, _total)
      ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Backfill every currently-active job's allowance total to the resolved
-- per-plan value, never shrinking below what's already been used (a company
-- that over-consumed relative to their correct plan value keeps what they
-- used — no clawback; only remaining headroom going forward is corrected).
WITH resolved AS (
  SELECT
    j.id AS job_id,
    COALESCE(
      (SELECT (p.limits->>'unlocks_per_job')::int
         FROM public.company_plans cp JOIN public.plans p ON p.id = cp.plan_id
         WHERE cp.company_id = j.company_id AND cp.status = 'active'
           AND (cp.ends_at IS NULL OR cp.ends_at > now())
         LIMIT 1),
      (SELECT (p.limits->>'unlocks_per_job')::int
         FROM public.plans p WHERE p.name = 'Basic' AND p.is_custom = false
         ORDER BY p.created_at LIMIT 1),
      25
    ) AS raw_value
  FROM public.jobs j
  WHERE j.status = 'active'
)
UPDATE public.job_unlock_allowance a
SET total = GREATEST(
  CASE WHEN r.raw_value = -1 THEN 1000000 ELSE r.raw_value END,
  a.used
)
FROM resolved r
WHERE a.job_id = r.job_id
  AND a.total <> CASE WHEN r.raw_value = -1 THEN 1000000 ELSE r.raw_value END;

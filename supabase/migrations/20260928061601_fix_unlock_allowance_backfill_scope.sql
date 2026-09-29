-- Follow-up to 20260928061212_fix_unlock_allowance_plan_source.sql.
--
-- That migration's backfill only corrected job_unlock_allowance.total for
-- jobs with status = 'active' at the moment it ran. A job_unlock_allowance
-- row is seeded once (ON CONFLICT (job_id) DO NOTHING) the first time a job
-- becomes active and is never reseeded on a later pause/reactivate, so any
-- job that was 'paused'/'closed'/'expired' (not 'active') at backfill time
-- kept its stale pre-fix total (verified live: one company's paused job
-- still showed total=25 after the previous migration, on a Basic plan whose
-- correct unlocks_per_job is 0). The allowance total should reflect the
-- company's correct entitlement regardless of the job's current lifecycle
-- state, so this backfill covers every job_unlock_allowance row by company,
-- not just currently-active jobs.

WITH resolved AS (
  SELECT
    a.job_id,
    COALESCE(
      (SELECT (p.limits->>'unlocks_per_job')::int
         FROM public.company_plans cp JOIN public.plans p ON p.id = cp.plan_id
         WHERE cp.company_id = a.company_id AND cp.status = 'active'
           AND (cp.ends_at IS NULL OR cp.ends_at > now())
         LIMIT 1),
      (SELECT (p.limits->>'unlocks_per_job')::int
         FROM public.plans p WHERE p.name = 'Basic' AND p.is_custom = false
         ORDER BY p.created_at LIMIT 1),
      25
    ) AS raw_value
  FROM public.job_unlock_allowance a
)
UPDATE public.job_unlock_allowance a
SET total = GREATEST(
  CASE WHEN r.raw_value = -1 THEN 1000000 ELSE r.raw_value END,
  a.used
)
FROM resolved r
WHERE a.job_id = r.job_id
  AND a.total <> CASE WHEN r.raw_value = -1 THEN 1000000 ELSE r.raw_value END;

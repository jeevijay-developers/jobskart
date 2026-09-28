-- Retire companies.plan_id, repoint company_auto_renew() at company_plans
-- (see employer-monetization-detailed-implementation-plan.md Phase 0, Task 0.2).
--
-- Bug: companies.plan_id (20260924113852_job_expiry_renewal.sql) was added as
-- "foundation for per-plan entitlements" but nothing ever writes it — company
-- plan state lives in company_plans (20260924095332_job_tiers_schema.sql)
-- instead. company_auto_renew()'s LEFT JOIN plans p ON p.id = c.plan_id was
-- always NULL, so a plan's per-plan auto-renew override could never engage
-- for any company, paid or not.

-- Self-verifying guard: refuse to drop the column if it somehow has data,
-- rather than trusting a one-time grep.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE plan_id IS NOT NULL) THEN
    RAISE EXCEPTION 'companies.plan_id has non-null data — do not drop, investigate first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.company_auto_renew(_company_id uuid)
RETURNS TABLE(enabled boolean, max_times int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((p.limits ->> 'auto_renew')::boolean, ps.auto_renew_enabled),
    COALESCE((p.limits ->> 'auto_renew_max')::int, ps.auto_renew_max_times)
  FROM public.plan_settings ps
  LEFT JOIN public.company_plans cp
    ON cp.company_id = _company_id
    AND cp.status = 'active'
    AND (cp.ends_at IS NULL OR cp.ends_at > now())
  LEFT JOIN public.plans p ON p.id = cp.plan_id
  WHERE ps.id = 1;
$$;
REVOKE ALL ON FUNCTION public.company_auto_renew(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_auto_renew(uuid) TO authenticated, service_role;

ALTER TABLE public.companies DROP COLUMN IF EXISTS plan_id;

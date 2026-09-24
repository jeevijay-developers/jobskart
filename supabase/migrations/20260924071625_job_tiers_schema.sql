-- Job Types (Classic / Classic+ / Trending) — Phase 1: schema, subscriptions,
-- entitlements. See job-types-implementation.md.
--
-- Scope of THIS migration (structure + a read-only resolver only):
--   * job_tier enum + jobs tier/lifecycle columns
--   * company_plans (subscription link) + RLS + one-active-per-company index
--   * seed Basic/Regular/Unlimited plans with entitlement keys in limits jsonb
--   * credit_txn_kind gains 'job_post' / 'repost'
--   * plan_settings.tier_prices jsonb (admin-editable credit prices)
--   * get_company_entitlements(_company_id) -> resolved limits + live usage
--   * partial feed indexes
--
-- Deliberately NOT here: the RLS tightening (jobs INSERT WITH CHECK status='draft')
-- and create_job_with_tier. Those ship together in Phase 2 so the current
-- direct-insert publish flow keeps working until the RPC + wizard tier picker
-- are ready (avoids a window where employers can't post at all).
--
-- Conventions matched from the existing schema:
--   * SECURITY DEFINER + SET search_path = public, REVOKE from PUBLIC/anon,
--     GRANT to the right role (mirrors apply_credit_delta / feed_jobs).
--   * has_company_membership() for company scoping, has_platform_role(uid,
--     'super_admin') for platform admin (mirrors plans / plan_settings RLS).
--   * -1 in a limits integer means "unlimited".

-- 1) job_tier enum -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.job_tier AS ENUM ('classic','classic_plus','trending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) jobs tier + lifecycle columns ------------------------------------------
-- NOT NULL DEFAULT 'classic' backfills every existing row implicitly.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tier public.job_tier NOT NULL DEFAULT 'classic';

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tier_source text,
  ADD COLUMN IF NOT EXISTS reposted_from uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repost_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

-- tier_source domain (added separately so re-runs / partial states are safe).
DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_tier_source_check
    CHECK (tier_source IN ('plan','credits','admin_grant'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) indexes -----------------------------------------------------------------
-- Partial feed indexes: liveness is maintained by the expiry sweeper flipping
-- status='expired' (now() cannot appear in a partial-index predicate), with
-- read-time expires_at guards as the backstop.
CREATE INDEX IF NOT EXISTS idx_jobs_active_created
  ON public.jobs (created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_jobs_active_trending_created
  ON public.jobs (created_at DESC) WHERE status = 'active' AND tier = 'trending';
-- Per-company live-job cap + monthly per-tier quota counting.
CREATE INDEX IF NOT EXISTS idx_jobs_company_status
  ON public.jobs (company_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_company_tier_created
  ON public.jobs (company_id, tier, created_at DESC);
-- FK index for repost lineage.
CREATE INDEX IF NOT EXISTS idx_jobs_reposted_from
  ON public.jobs (reposted_from) WHERE reposted_from IS NOT NULL;

-- 4) credit_txn_kind: job_post / repost -------------------------------------
-- ADD VALUE IF NOT EXISTS is transactional on PG12+ (project is PG17). The new
-- labels are not used inside this migration, so the same-txn restriction is moot.
DO $$ BEGIN
  ALTER TYPE public.credit_txn_kind ADD VALUE IF NOT EXISTS 'job_post';
  ALTER TYPE public.credit_txn_kind ADD VALUE IF NOT EXISTS 'repost';
END $$;

-- 5) plan_settings.tier_prices (credits) ------------------------------------
ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS tier_prices jsonb NOT NULL
    DEFAULT '{"classic":0,"classic_plus":0,"trending":50}'::jsonb;

-- 6) company_plans (subscription link) --------------------------------------
CREATE TABLE IF NOT EXISTS public.company_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One active plan per company (partial unique index; storage-enforced, RLS-independent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_plans_active
  ON public.company_plans (company_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_company_plans_company
  ON public.company_plans (company_id);

GRANT SELECT ON public.company_plans TO authenticated;
GRANT ALL ON public.company_plans TO service_role;
ALTER TABLE public.company_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read own company_plans" ON public.company_plans
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "super_admin manages company_plans" ON public.company_plans
  FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

-- 7) Seed plans (idempotent by name for the non-custom catalog rows) ---------
-- -1 == unlimited. trending_posts_per_month is the INCLUDED monthly quota;
-- beyond it Trending is purchased with credits at plan_settings.tier_prices.
INSERT INTO public.plans (name, price_inr, limits, is_custom)
SELECT 'Basic', 0,
  '{"live_jobs_max":5,"classic_posts_per_month":5,"classic_plus_enabled":false,"trending_posts_per_month":0,"repost_allowed":false,"unlocks_per_job":0,"response_retention_days":30}'::jsonb,
  false
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE name = 'Basic' AND is_custom = false);

INSERT INTO public.plans (name, price_inr, limits, is_custom)
SELECT 'Regular', 2999,
  '{"live_jobs_max":50,"classic_posts_per_month":100,"classic_plus_enabled":false,"trending_posts_per_month":5,"repost_allowed":true,"unlocks_per_job":50,"response_retention_days":90}'::jsonb,
  false
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE name = 'Regular' AND is_custom = false);

INSERT INTO public.plans (name, price_inr, limits, is_custom)
SELECT 'Unlimited', 9999,
  '{"live_jobs_max":-1,"classic_posts_per_month":-1,"classic_plus_enabled":true,"trending_posts_per_month":-1,"repost_allowed":true,"unlocks_per_job":-1,"response_retention_days":365}'::jsonb,
  false
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE name = 'Unlimited' AND is_custom = false);

-- 8) get_company_entitlements(_company_id) -> jsonb --------------------------
-- Resolved limits (active subscription, else seeded Basic/free defaults) plus
-- live usage. Quota month boundary is IST (Asia/Kolkata) so business-facing
-- counts match employer expectations. SECURITY DEFINER because it must count a
-- company's jobs regardless of jobs RLS; access is gated by membership/admin.
CREATE OR REPLACE FUNCTION public.get_company_entitlements(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan_id uuid;
  _plan_name text;
  _limits jsonb;
  _subscribed boolean := false;
  _prices jsonb;
  _month_start timestamptz;
  _live_jobs int;
  _classic_m int;
  _classic_plus_m int;
  _trending_m int;
BEGIN
  IF NOT (public.has_company_membership(auth.uid(), _company_id)
          OR public.has_platform_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Active subscription (partial unique index guarantees <= 1 active row).
  SELECT cp.plan_id, p.name, p.limits
    INTO _plan_id, _plan_name, _limits
  FROM public.company_plans cp
  JOIN public.plans p ON p.id = cp.plan_id
  WHERE cp.company_id = _company_id
    AND cp.status = 'active'
    AND (cp.ends_at IS NULL OR cp.ends_at > now())
  LIMIT 1;

  IF _plan_id IS NOT NULL THEN
    _subscribed := true;
  ELSE
    -- No active plan => fall back to the seeded Basic (free) plan limits.
    SELECT p.id, p.name, p.limits
      INTO _plan_id, _plan_name, _limits
    FROM public.plans p
    WHERE p.name = 'Basic' AND p.is_custom = false
    ORDER BY p.created_at
    LIMIT 1;
  END IF;

  -- Final safety net if the Basic catalog row was deleted.
  IF _limits IS NULL THEN
    _plan_id := NULL;
    _plan_name := 'Free';
    _limits := '{"live_jobs_max":5,"classic_posts_per_month":5,"classic_plus_enabled":false,"trending_posts_per_month":0,"repost_allowed":false,"unlocks_per_job":0,"response_retention_days":30}'::jsonb;
  END IF;

  SELECT COALESCE(
           (SELECT tier_prices FROM public.plan_settings WHERE id = 1),
           '{"classic":0,"classic_plus":0,"trending":50}'::jsonb)
    INTO _prices;

  -- Midnight on the 1st of the current IST month, as an absolute timestamptz.
  _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

  SELECT count(*) INTO _live_jobs
  FROM public.jobs
  WHERE company_id = _company_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  SELECT
    count(*) FILTER (WHERE tier = 'classic'      AND created_at >= _month_start),
    count(*) FILTER (WHERE tier = 'classic_plus' AND created_at >= _month_start),
    count(*) FILTER (WHERE tier = 'trending'     AND created_at >= _month_start)
  INTO _classic_m, _classic_plus_m, _trending_m
  FROM public.jobs
  WHERE company_id = _company_id;

  RETURN jsonb_build_object(
    'plan_id', _plan_id,
    'plan_name', _plan_name,
    'subscribed', _subscribed,
    'limits', _limits,
    'tier_prices', _prices,
    'usage', jsonb_build_object(
      'live_jobs', _live_jobs,
      'classic_posts_this_month', _classic_m,
      'classic_plus_posts_this_month', _classic_plus_m,
      'trending_posts_this_month', _trending_m
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.get_company_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_entitlements(uuid) TO authenticated;

-- Operational follow-up to 20260928130006_benefit_grants_and_ledger.sql:
--   1) Schedule expire_benefit_grants() so grants with a validity actually
--      expire on their own instead of only being swept when someone thinks
--      to call it manually.
--   2) Add a recurring reconciliation check (wallet vs. new ledger) that
--      records its result and RAISE WARNINGs on drift, so divergence is
--      caught automatically instead of requiring a manual
--      benefit_reconciliation_report() query.
--   3) Fix the "Unlimited" plan's literal -1 (unlimited) allowances, which
--      contradict this project's own monetization plan guardrails
--      ("Do not offer a plan with unlimited candidate contact access",
--      "Use active slots, not unlimited active jobs" — see
--      employer-monetization-and-credit-strategy-plan.md Sections 3 and
--      4.3). Real caps set 10-20x the Regular plan's own limits: generous
--      enough that no realistic customer notices a ceiling, but a ceiling
--      exists. classic_plus_enabled/repost_allowed/response_retention_days
--      were already fine and are left as-is.

-- ── 1. Scheduled expiry sweep — hourly, matches this project's other
--        pg_cron jobs' cadence style (already enabled by
--        20260914075503_alert_job_notifications.sql). No Edge Function
--        needed here — the function is pure SQL/plpgsql, so cron calls it
--        directly rather than via net.http_post.
SELECT cron.schedule(
  'expire-benefit-grants',
  '5 * * * *',
  $$ SELECT public.expire_benefit_grants(); $$
);

-- ── 2. Reconciliation drift tracking ─────────────────────────
CREATE TABLE IF NOT EXISTS public.benefit_reconciliation_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  drift_count int NOT NULL,
  drift jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX idx_benefit_reconciliation_checks_time ON public.benefit_reconciliation_checks (checked_at DESC);

GRANT SELECT ON public.benefit_reconciliation_checks TO authenticated;
GRANT ALL ON public.benefit_reconciliation_checks TO service_role;
ALTER TABLE public.benefit_reconciliation_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins read reconciliation checks" ON public.benefit_reconciliation_checks
  FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.run_benefit_reconciliation_check()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _drift jsonb;
  _count int;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb), count(*)
    INTO _drift, _count
    FROM public.benefit_reconciliation_report() r;

  INSERT INTO public.benefit_reconciliation_checks (drift_count, drift)
    VALUES (_count, _drift);

  IF _count > 0 THEN
    RAISE WARNING 'benefit ledger reconciliation drift detected: % compan(y/ies) affected — %', _count, _drift;
  END IF;

  RETURN _count;
END $$;

REVOKE ALL ON FUNCTION public.run_benefit_reconciliation_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_benefit_reconciliation_check() TO service_role;

-- Every 6 hours — frequent enough to catch drift quickly, infrequent enough
-- not to be noisy against a table that (per Section 8) is a parallel
-- best-effort mirror, not yet the authoritative balance.
SELECT cron.schedule(
  'benefit-reconciliation-check',
  '15 */6 * * *',
  $$ SELECT public.run_benefit_reconciliation_check(); $$
);

-- Run once now so there's an immediate baseline row instead of waiting up
-- to 6 hours for the first data point.
SELECT public.run_benefit_reconciliation_check();

-- ── 3. Unlimited plan: replace -1 allowances with real caps ──
UPDATE public.plans
SET limits = limits || jsonb_build_object(
  'live_jobs_max', 500,
  'classic_posts_per_month', 1000,
  'trending_posts_per_month', 100,
  'contact_credits_per_month', 500,
  'boost_credits_per_month', 100
)
WHERE name = 'Unlimited' AND is_custom = false;

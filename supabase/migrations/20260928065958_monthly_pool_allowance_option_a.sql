-- Monthly pooled contact/boost allowance for paid plans — Option A from
-- employer-monetization-implementation-plan.md's Task 2.2/2.3 decision.
--
-- Problem with the per-job allowance (job_unlock_allowance) as the ONLY free
-- mechanism for paid plans: it STACKS across every concurrently-open job. A
-- Regular-plan company with 5 live jobs already gets 5x its per-job number
-- in free unlocks that month, not the "N/month" figure the plan is sold on —
-- a bigger revenue leak in the opposite direction from the bug fixed in
-- 20260928061212_fix_unlock_allowance_plan_source.sql. Option A replaces the
-- per-job mechanism with one company-wide monthly pool per paid plan,
-- resolved and counted the same way job-tier monthly quotas already are in
-- get_company_entitlements()/activate_job_with_tier().
--
-- Re-runnable.

-- ---------------------------------------------------------------------
-- 1. resolve_company_plan_limit(): the "look up this company's active plan,
--    fall back to Basic, then to a caller-supplied default" pattern, used
--    3x now (job allowance seeding, contact pool, boost pool) — extracted
--    instead of copy-pasted a 3rd time.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_company_plan_limit(
  _company_id uuid,
  _key text,
  _fallback int DEFAULT NULL
) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (p.limits->>_key)::int
       FROM public.company_plans cp JOIN public.plans p ON p.id = cp.plan_id
       WHERE cp.company_id = _company_id AND cp.status = 'active'
         AND (cp.ends_at IS NULL OR cp.ends_at > now())
       LIMIT 1),
    (SELECT (p.limits->>_key)::int
       FROM public.plans p WHERE p.name = 'Basic' AND p.is_custom = false
       ORDER BY p.created_at LIMIT 1),
    _fallback
  );
$$;
REVOKE ALL ON FUNCTION public.resolve_company_plan_limit(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_company_plan_limit(uuid, text, int) TO service_role;

-- ---------------------------------------------------------------------
-- 2. tg_seed_job_unlock_allowance(): refactored to call the helper above
--    instead of its own inline copy of the same lookup — behaviorally
--    identical to 20260928061212_fix_unlock_allowance_plan_source.sql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_seed_job_unlock_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _raw int;
  _total int;
BEGIN
  IF NEW.status = 'active' THEN
    _raw := public.resolve_company_plan_limit(NEW.company_id, 'unlocks_per_job', 25);
    _total := CASE WHEN _raw = -1 THEN 1000000 ELSE _raw END;
    INSERT INTO public.job_unlock_allowance (job_id, company_id, total)
      VALUES (NEW.id, NEW.company_id, _total)
      ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 3. plans.limits: add contact_credits_per_month / boost_credits_per_month;
--    zero out unlocks_per_job for paid plans (Regular/Unlimited) since the
--    monthly pool replaces it — a plan should have exactly one free
--    contact-unlock mechanism active, never two stacked. Basic keeps
--    unlocks_per_job=0 (unchanged) and gets explicit 0 pool keys too, so
--    every plan row has the same key set.
--
--    Numbers carry over the previous per-job figures as the new monthly
--    figures (Regular: 50 -> 50/month; matches roughly the same generosity
--    for a single-job company while capping the multi-job stacking case) —
--    explicitly a starting hypothesis, not final pricing; admin-editable via
--    the plans table (no dedicated UI yet — see the implementation plan's
--    Task 2.4 note on that gap).
-- ---------------------------------------------------------------------
UPDATE public.plans
  SET limits = limits || '{"contact_credits_per_month": 0, "boost_credits_per_month": 0}'::jsonb
  WHERE name = 'Basic' AND is_custom = false;

UPDATE public.plans
  SET limits = limits || '{"unlocks_per_job": 0, "contact_credits_per_month": 50, "boost_credits_per_month": 5}'::jsonb
  WHERE name = 'Regular' AND is_custom = false;

UPDATE public.plans
  SET limits = limits || '{"unlocks_per_job": 0, "contact_credits_per_month": -1, "boost_credits_per_month": -1}'::jsonb
  WHERE name = 'Unlimited' AND is_custom = false;

-- ---------------------------------------------------------------------
-- 4. candidate_unlocks.source — which of the three mechanisms paid for this
--    unlock, so the monthly pool can be counted the same way job-tier
--    quotas already are (live COUNT since month-start), not a separate
--    decrementing counter table. Backfill: credits_spent=0 rows predate this
--    column and were all job-allowance-sourced (the only free mechanism
--    that existed before this migration); credits_spent>0 rows were wallet.
-- ---------------------------------------------------------------------
ALTER TABLE public.candidate_unlocks ADD COLUMN IF NOT EXISTS source text;
UPDATE public.candidate_unlocks SET source = CASE WHEN credits_spent > 0 THEN 'wallet' ELSE 'allowance' END
  WHERE source IS NULL;
ALTER TABLE public.candidate_unlocks ALTER COLUMN source SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.candidate_unlocks
    ADD CONSTRAINT candidate_unlocks_source_check
    CHECK (source IN ('allowance', 'monthly_pool', 'wallet'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 5. job_boosts.source — same idea for boosts. Every existing row predates
--    the pool and was wallet-charged (credits_spent already > 0 for all of
--    them), so backfilling to 'wallet' is exact, not best-effort.
-- ---------------------------------------------------------------------
ALTER TABLE public.job_boosts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'wallet';
DO $$ BEGIN
  ALTER TABLE public.job_boosts
    ADD CONSTRAINT job_boosts_source_check
    CHECK (source IN ('monthly_pool', 'wallet'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 6. unlock_candidate(): insert the monthly-pool step between the per-job
--    allowance (now 0 for paid plans, so it no-ops there and only still
--    applies to any legacy/custom plan that sets it nonzero) and the wallet
--    fallback. A company advisory lock guards the COUNT-then-INSERT pool
--    check against the same race apply_credit_delta's row lock prevents for
--    the wallet — mirrors activate_job_with_tier()'s existing lock order
--    (job row lock -> company advisory lock -> wallet row lock), so no new
--    deadlock ordering is introduced. Signature unchanged (4 args).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unlock_candidate(
  _company_id uuid,
  _job_id uuid,
  _candidate_user_id uuid,
  _actor uuid DEFAULT NULL
) RETURNS TABLE (already_unlocked boolean, balance_after int, source text, allowance_left int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exists boolean;
  _bal int;
  _job_company uuid;
  _job_status public.job_status;
  _job_expires timestamptz;
  _per_unlock int;
  _consumed int;
  _left int;
  _pool_limit int;
  _pool_used int;
  _use_pool boolean;
  _month_start timestamptz;
BEGIN
  SELECT company_id, status, expires_at INTO _job_company, _job_status, _job_expires
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _job_company IS NULL OR _job_company <> _company_id THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;
  IF _job_status <> 'active' OR (_job_expires IS NOT NULL AND _job_expires <= now()) THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.candidate_unlocks
                WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id)
    INTO _exists;
  IF _exists THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    SELECT total - used INTO _left FROM public.job_unlock_allowance WHERE job_id = _job_id;
    RETURN QUERY SELECT true, COALESCE(_bal, 0), 'already'::text, _left;
    RETURN;
  END IF;

  -- Per-job allowance first (0 for paid plans post-migration; still applies
  -- to any plan that keeps it nonzero).
  UPDATE public.job_unlock_allowance
    SET used = used + 1
    WHERE job_id = _job_id AND used < total
    RETURNING total - used INTO _left;
  GET DIAGNOSTICS _consumed = ROW_COUNT;

  IF _consumed = 1 THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0, 'allowance');
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'allowance'::text, _left;
    RETURN;
  END IF;

  -- Monthly pool second.
  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));
  _pool_limit := public.resolve_company_plan_limit(_company_id, 'contact_credits_per_month', 0);
  _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  IF _pool_limit = -1 THEN
    _use_pool := true;
  ELSIF _pool_limit > 0 THEN
    SELECT count(*) INTO _pool_used FROM public.candidate_unlocks
      WHERE company_id = _company_id AND source = 'monthly_pool' AND created_at >= _month_start;
    _use_pool := _pool_used < _pool_limit;
  ELSE
    _use_pool := false;
  END IF;

  IF _use_pool THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0, 'monthly_pool');
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'monthly_pool'::text, _left;
    RETURN;
  END IF;

  -- Wallet fallback last.
  SELECT COALESCE(credits_per_unlock, 5) INTO _per_unlock FROM public.plan_settings WHERE id = 1;
  BEGIN
    _bal := public.apply_credit_delta(
      _company_id, -_per_unlock, 'unlock'::public.credit_txn_kind,
      jsonb_build_object('candidate_user_id', _candidate_user_id, 'job_id', _job_id), _actor,
      'contact'::public.benefit_type
    );
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'no_credits';
  END;

  INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
    VALUES (_company_id, _job_id, _candidate_user_id, _actor, _per_unlock, 'wallet');
  RETURN QUERY SELECT false, _bal, 'credits'::text, 0;
END $$;

REVOKE ALL ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 7. apply_boost(): same monthly-pool insertion before the wallet charge.
--    Signature unchanged (1 arg).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_boost(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _status public.job_status;
  _created_at timestamptz;
  _title text;
  _settings RECORD;
  _boosts_today int;
  _balance int;
  _ends_at timestamptz;
  _boost_id uuid;
  _pool_limit int;
  _pool_used int;
  _use_pool boolean;
  _month_start timestamptz;
  _credits_spent int;
  _source text;
BEGIN
  SELECT company_id, status, created_at, title INTO _company_id, _status, _created_at, _title
  FROM public.jobs WHERE id = _job_id;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _status <> 'active' THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  SELECT * INTO _settings FROM public.boost_settings WHERE id = 1;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RAISE EXCEPTION 'boost_disabled';
  END IF;

  IF (timezone('Asia/Kolkata', _created_at))::date = (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'boost_same_day';
  END IF;

  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.job_boosts
    WHERE job_id = _job_id AND boost_day = (timezone('Asia/Kolkata', now()))::date
  ) THEN
    RAISE EXCEPTION 'boost_same_day';
  END IF;

  SELECT count(*) INTO _boosts_today FROM public.job_boosts
  WHERE company_id = _company_id AND boost_day = (timezone('Asia/Kolkata', now()))::date;
  IF _boosts_today >= _settings.max_boosts_per_company_day THEN
    RAISE EXCEPTION 'boost_daily_cap';
  END IF;

  _ends_at := now() + (_settings.window_hours::text || ' hours')::interval;

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));
  _pool_limit := public.resolve_company_plan_limit(_company_id, 'boost_credits_per_month', 0);
  _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  IF _pool_limit = -1 THEN
    _use_pool := true;
  ELSIF _pool_limit > 0 THEN
    SELECT count(*) INTO _pool_used FROM public.job_boosts
      WHERE company_id = _company_id AND source = 'monthly_pool' AND created_at >= _month_start;
    _use_pool := _pool_used < _pool_limit;
  ELSE
    _use_pool := false;
  END IF;

  IF _use_pool THEN
    _credits_spent := 0;
    _source := 'monthly_pool';
    SELECT COALESCE(boost_balance, 0) INTO _balance FROM public.employer_credit_wallets WHERE company_id = _company_id;
  ELSE
    BEGIN
      _balance := public.apply_credit_delta(
        _company_id, -_settings.cost_credits, 'boost'::public.credit_txn_kind,
        jsonb_build_object('job_id', _job_id), auth.uid(), 'boost'::public.benefit_type
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'Insufficient credits%' THEN
        RAISE EXCEPTION 'no_credits';
      END IF;
      RAISE;
    END;
    _credits_spent := _settings.cost_credits;
    _source := 'wallet';
  END IF;

  INSERT INTO public.job_boosts (company_id, job_id, ends_at, credits_spent, boosted_by, source)
    VALUES (_company_id, _job_id, _ends_at, _credits_spent, auth.uid(), _source)
    RETURNING id INTO _boost_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'job.boosted', 'Job boosted',
    _title, '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'boost_id', _boost_id, 'ends_at', _ends_at, 'credits_spent', _credits_spent, 'source', _source)
  );

  RETURN jsonb_build_object(
    'boost_id', _boost_id, 'ends_at', _ends_at,
    'credits_spent', _credits_spent, 'balance_after', _balance, 'source', _source
  );
END $$;

-- ---------------------------------------------------------------------
-- 8. get_company_entitlements(): surface this-month pool usage alongside
--    the existing per-tier monthly counters, so client code (the boost
--    button's client-side eligibility check in particular — it must not
--    block a company that has pool capacity left just because its wallet
--    boost_balance reads 0) can compute remaining pool capacity without a
--    bespoke RPC. Signature unchanged (1 arg).
-- ---------------------------------------------------------------------
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
  _plan_ends_at timestamptz;
  _limits jsonb;
  _subscribed boolean := false;
  _prices jsonb;
  _month_start timestamptz;
  _live_jobs int;
  _classic_m int;
  _classic_plus_m int;
  _trending_m int;
  _contact_pool_m int;
  _boost_pool_m int;
BEGIN
  IF NOT (public.has_company_membership(auth.uid(), _company_id)
          OR public.has_platform_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT cp.plan_id, p.name, p.limits, cp.ends_at
    INTO _plan_id, _plan_name, _limits, _plan_ends_at
  FROM public.company_plans cp
  JOIN public.plans p ON p.id = cp.plan_id
  WHERE cp.company_id = _company_id
    AND cp.status = 'active'
    AND (cp.ends_at IS NULL OR cp.ends_at > now())
  LIMIT 1;

  IF _plan_id IS NOT NULL THEN
    _subscribed := true;
  ELSE
    SELECT p.id, p.name, p.limits
      INTO _plan_id, _plan_name, _limits
    FROM public.plans p
    WHERE p.name = 'Basic' AND p.is_custom = false
    ORDER BY p.created_at
    LIMIT 1;
    _plan_ends_at := NULL;
  END IF;

  IF _limits IS NULL THEN
    _plan_id := NULL;
    _plan_name := 'Free';
    _limits := '{"live_jobs_max":5,"classic_posts_per_month":5,"classic_plus_enabled":false,"trending_posts_per_month":0,"repost_allowed":false,"unlocks_per_job":0,"response_retention_days":30,"contact_credits_per_month":0,"boost_credits_per_month":0}'::jsonb;
  END IF;

  SELECT COALESCE(
           (SELECT tier_prices FROM public.plan_settings WHERE id = 1),
           '{"classic":0,"classic_plus":0,"trending":50}'::jsonb)
    INTO _prices;

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

  SELECT count(*) INTO _contact_pool_m FROM public.candidate_unlocks
    WHERE company_id = _company_id AND source = 'monthly_pool' AND created_at >= _month_start;
  SELECT count(*) INTO _boost_pool_m FROM public.job_boosts
    WHERE company_id = _company_id AND source = 'monthly_pool' AND created_at >= _month_start;

  RETURN jsonb_build_object(
    'plan_id', _plan_id,
    'plan_name', _plan_name,
    'subscribed', _subscribed,
    'plan_ends_at', _plan_ends_at,
    'limits', _limits,
    'tier_prices', _prices,
    'usage', jsonb_build_object(
      'live_jobs', _live_jobs,
      'classic_posts_this_month', _classic_m,
      'classic_plus_posts_this_month', _classic_plus_m,
      'trending_posts_this_month', _trending_m,
      'contact_pool_used_this_month', _contact_pool_m,
      'boost_pool_used_this_month', _boost_pool_m
    )
  );
END $$;

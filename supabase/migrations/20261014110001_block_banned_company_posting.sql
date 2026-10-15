-- A banned company (companies.banned_at, set by admin_resolve_company_report)
-- must not be able to post again — without this guard, a banned company
-- could still activate an existing draft job via activate_job_with_tier()
-- even though all its active/paused jobs were force-closed by the ban.
-- Reproduces the current function body verbatim (last defined in
-- 20260928061654_benefit_type_split.sql) with one added guard.

CREATE OR REPLACE FUNCTION public.activate_job_with_tier(_job_id uuid, _tier public.job_tier)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _status public.job_status;
  _title text;
  _ent jsonb;
  _limits jsonb;
  _prices jsonb;
  _usage jsonb;
  _live_jobs_max int;
  _quota int;
  _used int;
  _price int;
  _tier_source text;
  _balance int;
BEGIN
  SELECT company_id, status, title INTO _company_id, _status, _title
  FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.companies WHERE id = _company_id AND banned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'company_banned';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'job_not_draft';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));

  _ent := public.get_company_entitlements(_company_id);
  _limits := _ent->'limits';
  _prices := _ent->'tier_prices';
  _usage := _ent->'usage';

  _live_jobs_max := (_limits->>'live_jobs_max')::int;
  IF _live_jobs_max <> -1 AND (_usage->>'live_jobs')::int >= _live_jobs_max THEN
    RAISE EXCEPTION 'live_jobs_max_reached';
  END IF;

  IF _tier = 'classic' THEN
    _quota := (_limits->>'classic_posts_per_month')::int;
    _used := (_usage->>'classic_posts_this_month')::int;
    IF _quota = -1 OR _used < _quota THEN
      _tier_source := 'plan';
    ELSE
      _price := COALESCE((_prices->>'classic')::int, 0);
      IF _price > 0 THEN
        BEGIN
          PERFORM public.apply_credit_delta(
            _company_id, -_price, 'job_post'::public.credit_txn_kind,
            jsonb_build_object('job_id', _job_id, 'tier', _tier), auth.uid(),
            'job_post'::public.benefit_type
          );
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM LIKE 'Insufficient credits%' THEN RAISE EXCEPTION 'no_credits'; END IF;
          RAISE;
        END;
      END IF;
      _tier_source := 'credits';
    END IF;
  ELSIF _tier = 'classic_plus' THEN
    IF NOT COALESCE((_limits->>'classic_plus_enabled')::boolean, false) THEN
      RAISE EXCEPTION 'classic_plus_not_available';
    END IF;
    _tier_source := 'plan';
  ELSIF _tier = 'trending' THEN
    _quota := (_limits->>'trending_posts_per_month')::int;
    _used := (_usage->>'trending_posts_this_month')::int;
    IF _quota = -1 OR _used < _quota THEN
      _tier_source := 'plan';
    ELSE
      _price := COALESCE((_prices->>'trending')::int, 50);
      IF _price > 0 THEN
        BEGIN
          PERFORM public.apply_credit_delta(
            _company_id, -_price, 'job_post'::public.credit_txn_kind,
            jsonb_build_object('job_id', _job_id, 'tier', _tier), auth.uid(),
            'job_post'::public.benefit_type
          );
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM LIKE 'Insufficient credits%' THEN RAISE EXCEPTION 'no_credits'; END IF;
          RAISE;
        END;
      END IF;
      _tier_source := 'credits';
    END IF;
  END IF;

  UPDATE public.jobs
    SET status = 'active', tier = _tier, tier_source = _tier_source,
        expires_at = now() + interval '30 days'
    WHERE id = _job_id;

  SELECT COALESCE(job_post_balance, 0) INTO _balance
  FROM public.employer_credit_wallets WHERE company_id = _company_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'job.posted', 'Job posted', _title,
    '/employer/jobs/' || _job_id || '/applicants',
    jsonb_build_object('job_id', _job_id, 'tier', _tier, 'tier_source', _tier_source)
  );

  RETURN jsonb_build_object(
    'job_id', _job_id, 'tier', _tier, 'tier_source', _tier_source,
    'balance_after', COALESCE(_balance, 0)
  );
END $$;

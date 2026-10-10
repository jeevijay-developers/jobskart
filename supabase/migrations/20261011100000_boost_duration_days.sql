-- Job Boost: employer picks a duration in whole days (1 day = the existing 24h boost).
--   * expiry   = now() + N days
--   * credits  = boost_settings.cost_credits (the existing rate) x N, charged once, atomically,
--                through the existing apply_credit_delta + row/advisory locks
--   * unlimited plan allowance stays free for any N; a limited monthly allowance covers N = 1 only
-- Replaces apply_boost(uuid) with apply_boost(uuid, int DEFAULT 1): old one-argument calls still work.

DROP FUNCTION IF EXISTS public.apply_boost(uuid);

CREATE OR REPLACE FUNCTION public.apply_boost(_job_id uuid, _days int DEFAULT 1)
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
  _cost int;
BEGIN
  IF _days IS NULL OR _days < 1 OR _days > 30 THEN
    RAISE EXCEPTION 'invalid_boost_days';
  END IF;

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

  -- A multi-day boost covers its whole window: no second (paid) boost while one is still running.
  IF EXISTS (SELECT 1 FROM public.job_boosts WHERE job_id = _job_id AND ends_at > now()) THEN
    RAISE EXCEPTION 'boost_active';
  END IF;

  SELECT count(*) INTO _boosts_today FROM public.job_boosts
  WHERE company_id = _company_id AND boost_day = (timezone('Asia/Kolkata', now()))::date;
  IF _boosts_today >= _settings.max_boosts_per_company_day THEN
    RAISE EXCEPTION 'boost_daily_cap';
  END IF;

  _ends_at := now() + make_interval(days => _days);
  _cost := _settings.cost_credits * _days; -- existing per-boost rate, charged once per day

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));
  _pool_limit := public.resolve_company_plan_limit(_company_id, 'boost_credits_per_month', 0);
  _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  IF _pool_limit = -1 THEN
    _use_pool := true;
  ELSIF _pool_limit > 0 THEN
    SELECT count(*) INTO _pool_used FROM public.job_boosts
      WHERE company_id = _company_id AND source = 'monthly_pool' AND created_at >= _month_start;
    -- A limited monthly allowance counts whole boosts, so it only covers a single-day boost.
    _use_pool := _days = 1 AND _pool_used < _pool_limit;
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
        _company_id, -_cost, 'boost'::public.credit_txn_kind,
        jsonb_build_object('job_id', _job_id), auth.uid(), 'boost'::public.benefit_type
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'Insufficient credits%' THEN
        RAISE EXCEPTION 'no_credits';
      END IF;
      RAISE;
    END;
    _credits_spent := _cost;
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

REVOKE ALL ON FUNCTION public.apply_boost(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_boost(uuid, int) TO authenticated;

-- Fix a bug introduced in 20260928065958_monthly_pool_allowance_option_a.sql:
-- unlock_candidate() declares RETURNS TABLE(..., source text, ...), which
-- implicitly creates a PL/pgSQL variable named `source` in the function
-- body. That migration also added a real `source` column to
-- candidate_unlocks, and referenced it unqualified inside SELECT/WHERE/
-- INSERT statements in this function — Postgres cannot tell whether `source`
-- means the OUT-parameter variable or the table column in that context and
-- raises "column reference is ambiguous" (a well-known PL/pgSQL gotcha: a
-- local variable/OUT-param sharing a name with a column referenced in an
-- embedded SQL command). Found by actually calling the function end-to-end
-- against a test company on the Regular plan, not by static review.
--
-- Fix: alias candidate_unlocks as `cu` and qualify every reference to its
-- `source` column. The function's own return column stays named `source`
-- (unchanged contract — src/lib/credits.functions.ts reads
-- `result?.source`), only the internal SQL text changes.

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

  SELECT EXISTS(SELECT 1 FROM public.candidate_unlocks cu
                WHERE cu.company_id = _company_id AND cu.candidate_user_id = _candidate_user_id)
    INTO _exists;
  IF _exists THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    SELECT total - used INTO _left FROM public.job_unlock_allowance WHERE job_id = _job_id;
    RETURN QUERY SELECT true, COALESCE(_bal, 0), 'already'::text, _left;
    RETURN;
  END IF;

  UPDATE public.job_unlock_allowance
    SET used = used + 1
    WHERE job_id = _job_id AND used < total
    RETURNING total - used INTO _left;
  GET DIAGNOSTICS _consumed = ROW_COUNT;

  IF _consumed = 1 THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks AS cu (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0, 'allowance');
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'allowance'::text, _left;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));
  _pool_limit := public.resolve_company_plan_limit(_company_id, 'contact_credits_per_month', 0);
  _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  IF _pool_limit = -1 THEN
    _use_pool := true;
  ELSIF _pool_limit > 0 THEN
    SELECT count(*) INTO _pool_used FROM public.candidate_unlocks cu
      WHERE cu.company_id = _company_id AND cu.source = 'monthly_pool' AND cu.created_at >= _month_start;
    _use_pool := _pool_used < _pool_limit;
  ELSE
    _use_pool := false;
  END IF;

  IF _use_pool THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks AS cu (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0, 'monthly_pool');
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'monthly_pool'::text, _left;
    RETURN;
  END IF;

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

  INSERT INTO public.candidate_unlocks AS cu (company_id, job_id, candidate_user_id, unlocked_by, credits_spent, source)
    VALUES (_company_id, _job_id, _candidate_user_id, _actor, _per_unlock, 'wallet');
  RETURN QUERY SELECT false, _bal, 'credits'::text, 0;
END $$;

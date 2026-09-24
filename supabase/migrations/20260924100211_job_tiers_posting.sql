-- Job Types — Phase 2: posting & charging. See job-types-implementation.md.
--
-- Design deviation from the plan doc, documented here because it's the kind
-- of thing a future reader would otherwise "fix" back to the literal wording:
-- the plan describes one RPC `create_job_with_tier(_company_id, _tier,
-- _payload jsonb, _actor)` that both inserts the job row AND does the
-- tier/money logic from a jsonb blob. That requires jsonb_populate_record()
-- over the ~50-column jobs table, which silently sets any column NOT
-- present in the payload to NULL rather than its DEFAULT — a landmine for
-- every NOT NULL DEFAULT column (is_featured, pan_india_ok, screening_questions,
-- ...). Instead this ships as two steps that compose with what already works:
--   1. The client inserts the job row itself, exactly as it does today for
--      drafts (JobWizard's existing buildFieldsFromForm() path) — this is
--      untouched and still goes through ordinary RLS.
--   2. This migration's activate_job_with_tier(_job_id, _tier) RPC is the
--      ONLY way to flip a draft to status='active': it re-verifies
--      membership, gates by tier entitlement, charges credits when the plan
--      quota is exhausted, and stamps tier/tier_source/expires_at.
-- The RLS tightening below (jobs INSERT WITH CHECK status='draft') ships in
-- THIS SAME migration as the RPC, per the plan's own risk note — otherwise
-- there'd be a window where employers can't post at all, or worse, could
-- still insert an active job directly.

-- 1) RLS: an INSERT can only ever create a draft. Publishing an existing
--    draft to 'active' happens exclusively through activate_job_with_tier().
--    The UPDATE policy is untouched (close/reopen/edit-in-place keep working
--    as direct updates until Phase 3 ships their own RPCs).
DROP POLICY IF EXISTS "Company members can insert jobs" ON public.jobs;
CREATE POLICY "Company members can insert draft jobs" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = posted_by
    AND public.has_company_membership(auth.uid(), company_id)
    AND status = 'draft'
  );

-- 2) activate_job_with_tier(_job_id, _tier) -----------------------------------
-- The only place tier entitlement + credit-charging logic for posting lives.
-- SECURITY DEFINER; row-locks the job first (serializes concurrent calls on
-- the SAME draft), then a per-company advisory lock (serializes concurrent
-- posts across different draft jobs for the same company while quota is
-- counted — a plain row lock can't protect a COUNT(*) over jobs), then
-- apply_credit_delta()'s own wallet row lock. Lock order (job row ->
-- company advisory lock -> wallet row) is the same in every call, so no
-- deadlock is possible between concurrent activations.
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

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _status <> 'draft' THEN
    RAISE EXCEPTION 'job_not_draft';
  END IF;

  -- Serializes quota counting across concurrent posts for this company.
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
      -- Skip the ledger entirely at price 0 (admin default) — a $0 line item
      -- in credit_transactions would be noise, not an audit fact worth keeping.
      IF _price > 0 THEN
        BEGIN
          PERFORM public.apply_credit_delta(
            _company_id, -_price, 'job_post'::public.credit_txn_kind,
            jsonb_build_object('job_id', _job_id, 'tier', _tier), auth.uid()
          );
        EXCEPTION WHEN OTHERS THEN
          IF SQLERRM LIKE 'Insufficient credits%' THEN RAISE EXCEPTION 'no_credits'; END IF;
          RAISE;
        END;
      END IF;
      _tier_source := 'credits';
    END IF;
  ELSIF _tier = 'classic_plus' THEN
    -- Classic+ is a plan perk (Unlimited plans only per the product table),
    -- not a standalone credit purchase — no charging branch, block if absent.
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
            jsonb_build_object('job_id', _job_id, 'tier', _tier), auth.uid()
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

  SELECT COALESCE(balance, 0) INTO _balance
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

REVOKE ALL ON FUNCTION public.activate_job_with_tier(uuid, public.job_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_job_with_tier(uuid, public.job_tier) TO authenticated;

-- 3) credits_activity trigger: label 'job_post' distinctly from the generic
--    "Credit adjustment" ELSE branch (mirrors the 'boost' case added by the
--    boost engine migration). 'repost' is added too since Phase 3's
--    repost_job() will reuse the same credit_txn_kind.
CREATE OR REPLACE FUNCTION public.tg_credits_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.created_by,
    CASE NEW.kind::text WHEN 'purchase' THEN 'credits.purchased'
                       WHEN 'unlock'   THEN 'credits.spent'
                       WHEN 'grant'    THEN 'credits.granted'
                       WHEN 'boost'    THEN 'credits.spent'
                       WHEN 'job_post' THEN 'credits.spent'
                       WHEN 'repost'   THEN 'credits.spent'
                       ELSE 'credits.adjusted' END,
    CASE NEW.kind::text WHEN 'purchase' THEN 'Credits purchased'
                       WHEN 'unlock'   THEN 'Credit spent on unlock'
                       WHEN 'grant'    THEN 'Credits granted'
                       WHEN 'boost'    THEN 'Credits spent on boost'
                       WHEN 'job_post' THEN 'Credits spent on job post'
                       WHEN 'repost'   THEN 'Credits spent on repost'
                       ELSE 'Credit adjustment' END,
    (CASE WHEN NEW.delta > 0 THEN '+' ELSE '' END) || NEW.delta::text || ' credits · balance ' || NEW.balance_after::text,
    '/employer/credits',
    jsonb_build_object('delta', NEW.delta, 'kind', NEW.kind, 'reference', NEW.reference)
  );
  RETURN NEW;
END $$;

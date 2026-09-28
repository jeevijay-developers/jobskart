-- Named balances: split employer_credit_wallets' single generic `balance`
-- into three named pools (job_post / contact / boost) so an employer always
-- sees what a balance is for (see
-- employer-monetization-detailed-implementation-plan.md Phase 1,
-- Tasks 1.1-1.6). Re-runnable.

-- ---------------------------------------------------------------------
-- 1. benefit_type enum
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.benefit_type AS ENUM ('job_post', 'contact', 'boost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 2. employer_credit_wallets: rename balance -> job_post_balance (metadata
--    only, no data movement — every company's existing purchased-credit
--    balance becomes their job-post balance, the documented, deliberate
--    choice since job posts were the dominant historical use), add the two
--    new pools defaulting to 0 (no separate backfill UPDATE needed).
--
--    Deliberately NOT adding CHECK (job_post_balance >= 0) etc: non-
--    negativity is enforced by apply_credit_delta() raising 'Insufficient
--    credits' after the UPDATE, which callers pattern-match on
--    (SQLERRM LIKE 'Insufficient credits%') to map to the `no_credits`
--    error code. A DB-level CHECK violation would raise a different
--    SQLSTATE/message and silently break that mapping.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.employer_credit_wallets RENAME COLUMN balance TO job_post_balance;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

ALTER TABLE public.employer_credit_wallets
  ADD COLUMN IF NOT EXISTS contact_balance int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS boost_balance int NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- 3. credit_transactions.benefit_type
--    Backfilled to 'job_post' for every historical row as a best-effort,
--    not historically-accurate, mapping: `kind` remains the source of truth
--    for *why* a txn happened; `benefit_type` (a question that didn't exist
--    before this split) is only fully accurate from this migration forward.
-- ---------------------------------------------------------------------
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type;
UPDATE public.credit_transactions SET benefit_type = 'job_post' WHERE benefit_type IS NULL;
ALTER TABLE public.credit_transactions ALTER COLUMN benefit_type SET NOT NULL;

-- ---------------------------------------------------------------------
-- 4. credit_packs.benefit_type — DEFAULT is safe here (unlike
--    credit_transactions above) because every currently-seeded pack
--    (Starter/Growth/Pro/Enterprise) genuinely only ever granted the
--    generic (now job-post) balance.
-- ---------------------------------------------------------------------
ALTER TABLE public.credit_packs
  ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type NOT NULL DEFAULT 'job_post';

-- ---------------------------------------------------------------------
-- 5. razorpay_orders.benefit_type — snapshot at order-creation time so an
--    admin editing/deactivating a pack between checkout and webhook
--    delivery can never change what an already-quoted order credits
--    (mirrors why subtotal_inr/gst_inr/credits are already snapshotted).
--    Nullable: plan orders have no benefit_type.
-- ---------------------------------------------------------------------
ALTER TABLE public.razorpay_orders ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type;

-- ---------------------------------------------------------------------
-- 6. apply_credit_delta(): add _benefit_type as the LAST parameter.
--
--    Every existing internal caller invokes this POSITIONALLY inside
--    PL/pgSQL (e.g. apply_credit_delta(_company_id, -_price, 'job_post',
--    jsonb_build_object(...), auth.uid())), not with named arguments.
--    Inserting _benefit_type anywhere before the existing last parameter
--    (_actor) would silently misbind every un-updated positional call's
--    later arguments into the wrong parameters, with no compile error.
--    Appending it last with DEFAULT 'job_post' keeps every call site
--    working exactly as before until each is explicitly updated below.
--
--    Postgres function identity includes the parameter type LIST — adding a
--    parameter makes this a DIFFERENT overload, not a replacement of the
--    5-arg version, so the old 5-arg signature must be explicitly dropped
--    first or it would keep existing (and immediately error at call time,
--    since its body still references the now-renamed `balance` column).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  _company_id uuid,
  _delta int,
  _kind public.credit_txn_kind,
  _reference jsonb DEFAULT NULL,
  _actor uuid DEFAULT NULL,
  _benefit_type public.benefit_type DEFAULT 'job_post'
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance int;
  _col text;
BEGIN
  INSERT INTO public.employer_credit_wallets (company_id, job_post_balance)
    VALUES (_company_id, 0)
    ON CONFLICT (company_id) DO NOTHING;

  -- Fixed, hardcoded mapping — _col can only ever be one of these three
  -- literal strings (never derived from unvalidated input), so building the
  -- UPDATE dynamically via format('%I', _col) has no injection surface.
  _col := CASE _benefit_type
    WHEN 'job_post' THEN 'job_post_balance'
    WHEN 'contact' THEN 'contact_balance'
    WHEN 'boost' THEN 'boost_balance'
  END;

  EXECUTE format(
    'UPDATE public.employer_credit_wallets SET %I = %I + $1, updated_at = now() WHERE company_id = $2 RETURNING %I',
    _col, _col, _col
  ) INTO _new_balance USING _delta, _company_id;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, reference, created_by, benefit_type)
    VALUES (_company_id, _kind, _delta, _new_balance, _reference, _actor, _benefit_type);

  RETURN _new_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) TO service_role;

-- ---------------------------------------------------------------------
-- 7. activate_job_with_tier(): job_post_balance explicitly, both charge
--    branches pass _benefit_type := 'job_post' explicitly (behaviorally a
--    no-op since that's the default, done anyway so every call site is
--    self-documenting rather than relying on a silent default).
--    Signature unchanged (2 args) — CREATE OR REPLACE keeps existing grants.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 8. apply_boost(): charge boost_balance. Signature unchanged (1 arg).
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

  INSERT INTO public.job_boosts (company_id, job_id, ends_at, credits_spent, boosted_by)
    VALUES (_company_id, _job_id, _ends_at, _settings.cost_credits, auth.uid())
    RETURNING id INTO _boost_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'job.boosted', 'Job boosted',
    _title, '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'boost_id', _boost_id, 'ends_at', _ends_at, 'credits_spent', _settings.cost_credits)
  );

  RETURN jsonb_build_object(
    'boost_id', _boost_id, 'ends_at', _ends_at,
    'credits_spent', _settings.cost_credits, 'balance_after', _balance
  );
END $$;

-- ---------------------------------------------------------------------
-- 9. unlock_candidate(): contact_balance for both the "already unlocked"
--    read and the wallet-fallback charge. Signature unchanged (4 args).
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

  UPDATE public.job_unlock_allowance
    SET used = used + 1
    WHERE job_id = _job_id AND used < total
    RETURNING total - used INTO _left;
  GET DIAGNOSTICS _consumed = ROW_COUNT;

  IF _consumed = 1 THEN
    SELECT contact_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0);
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'allowance'::text, _left;
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

  INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent)
    VALUES (_company_id, _job_id, _candidate_user_id, _actor, _per_unlock);
  RETURN QUERY SELECT false, _bal, 'credits'::text, 0;
END $$;

REVOKE ALL ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 10. create_credit_pack_order(): also select+snapshot benefit_type.
--     Signature unchanged (3 args).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit_pack_order(
  _company_id uuid,
  _pack_id uuid,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pack record;
  _subtotal numeric(12,2);
  _gst numeric(12,2);
  _paise bigint;
  _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT id, name, credits, price_inr, benefit_type INTO _pack
    FROM public.credit_packs
    WHERE id = _pack_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pack_unavailable';
  END IF;

  _subtotal := _pack.price_inr;
  _gst := round(_subtotal * 0.18, 2);
  _paise := round((_subtotal + _gst) * 100)::bigint;

  INSERT INTO public.razorpay_orders (
    company_id, pack_id, amount_inr, credits,
    subtotal_inr, gst_inr, amount_paise, status, created_by, benefit_type
  ) VALUES (
    _company_id, _pack.id, _pack.price_inr, _pack.credits,
    _subtotal, _gst, _paise, 'created', _actor, _pack.benefit_type
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object(
    'order_id', _id,
    'amount_paise', _paise,
    'subtotal_inr', _subtotal,
    'gst_inr', _gst,
    'credits', _pack.credits,
    'pack_name', _pack.name
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 11. fulfill_razorpay_order(): credit-pack branch reads benefit_type from
--     the order row (snapshotted at creation, step 10 above), never
--     re-queries credit_packs at fulfilment time. COALESCE to 'job_post'
--     only covers orders created before this migration that are still
--     sitting in 'created' status with no benefit_type set.
--     Signature unchanged (5 args).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order(
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _amount_paise bigint,
  _via text,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _o public.razorpay_orders%ROWTYPE;
  _expected bigint;
  _bal int;
  _is_plan boolean;
BEGIN
  IF _via NOT IN ('client', 'webhook') THEN
    RAISE EXCEPTION 'invalid_via';
  END IF;

  SELECT * INTO _o
    FROM public.razorpay_orders
    WHERE razorpay_order_id = _razorpay_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF _actor IS NOT NULL AND NOT public.has_company_membership(_actor, _o.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  _is_plan := _o.plan_id IS NOT NULL;

  IF _o.status = 'paid' THEN
    IF _is_plan THEN
      RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'balance', NULL, 'order_kind', 'plan');
    END IF;
    SELECT job_post_balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _o.company_id;
    RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'balance', coalesce(_bal, 0), 'order_kind', 'credit_pack');
  END IF;

  IF _o.status = 'amount_mismatch' THEN
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'balance', NULL, 'order_kind', CASE WHEN _is_plan THEN 'plan' ELSE 'credit_pack' END);
  END IF;

  _expected := coalesce(_o.amount_paise, _o.amount_inr::bigint * 100);
  IF _amount_paise IS NOT NULL AND _amount_paise <> _expected THEN
    UPDATE public.razorpay_orders
      SET status = 'amount_mismatch',
          razorpay_payment_id = _razorpay_payment_id,
          fulfilled_via = _via,
          failure_reason = format('Paid %s paise, expected %s paise', _amount_paise, _expected)
      WHERE id = _o.id;
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'balance', NULL, 'order_kind', CASE WHEN _is_plan THEN 'plan' ELSE 'credit_pack' END);
  END IF;

  IF _is_plan THEN
    PERFORM public.activate_company_plan(_o.company_id, _o.plan_id, _actor);
    BEGIN
      PERFORM public.issue_plan_invoice(_o.id, _razorpay_payment_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_plan_invoice failed for order %: %', _o.id, SQLERRM;
    END;
  ELSE
    _bal := public.apply_credit_delta(
      _o.company_id, _o.credits, 'purchase'::public.credit_txn_kind,
      jsonb_build_object('order_id', _o.id, 'razorpay_payment_id', _razorpay_payment_id, 'via', _via),
      _actor, COALESCE(_o.benefit_type, 'job_post'::public.benefit_type)
    );
    BEGIN
      PERFORM public.issue_credit_pack_invoice(_o.id, _razorpay_payment_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_credit_pack_invoice failed for order %: %', _o.id, SQLERRM;
    END;
  END IF;

  UPDATE public.razorpay_orders
    SET status = 'paid',
        razorpay_payment_id = _razorpay_payment_id,
        fulfilled_via = _via,
        failure_reason = NULL
    WHERE id = _o.id;

  IF _is_plan THEN
    RETURN jsonb_build_object('status', 'paid', 'already_applied', false, 'balance', NULL, 'order_kind', 'plan');
  END IF;
  RETURN jsonb_build_object('status', 'paid', 'already_applied', false, 'balance', _bal, 'order_kind', 'credit_pack');
END;
$$;

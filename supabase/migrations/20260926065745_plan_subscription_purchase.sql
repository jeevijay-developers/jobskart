-- Plan subscriptions (Basic/Regular/Unlimited) purchased via the same
-- Razorpay Orders flow already used for credit packs. See prompt structure/
-- monetization.md and the credit-pack path in
-- 20260923064309_razorpay_hardening_gst.sql for the pattern this mirrors.
-- Re-runnable.

-- ---------------------------------------------------------------------
-- 1. razorpay_orders: allow a "plan" order alongside "credit pack" orders
-- ---------------------------------------------------------------------
ALTER TABLE public.razorpay_orders
  ALTER COLUMN pack_id DROP NOT NULL;
ALTER TABLE public.razorpay_orders
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'razorpay_orders_kind_xor'
      AND conrelid = 'public.razorpay_orders'::regclass
  ) THEN
    ALTER TABLE public.razorpay_orders
      ADD CONSTRAINT razorpay_orders_kind_xor
      CHECK ((pack_id IS NOT NULL)::int + (plan_id IS NOT NULL)::int = 1);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. create_plan_order(): quote + insert the pending order
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_plan_order(
  _company_id uuid,
  _plan_id uuid,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _plan record;
  _subtotal numeric(12,2);
  _gst numeric(12,2);
  _paise bigint;
  _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT id, name, price_inr INTO _plan
    FROM public.plans
    WHERE id = _plan_id AND is_custom = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_unavailable';
  END IF;

  -- Basic (₹0) isn't a checkout — it's a free switch via
  -- switch_company_plan_to_basic() below.
  IF _plan.price_inr <= 0 THEN
    RAISE EXCEPTION 'plan_not_purchasable';
  END IF;

  _subtotal := _plan.price_inr;
  _gst := round(_subtotal * 0.18, 2);
  _paise := round((_subtotal + _gst) * 100)::bigint;

  INSERT INTO public.razorpay_orders (
    company_id, plan_id, amount_inr, credits,
    subtotal_inr, gst_inr, amount_paise, status, created_by
  ) VALUES (
    _company_id, _plan.id, _plan.price_inr, 0,
    _subtotal, _gst, _paise, 'created', _actor
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object(
    'order_id', _id,
    'amount_paise', _paise,
    'subtotal_inr', _subtotal,
    'gst_inr', _gst,
    'plan_name', _plan.name
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 3. activate_company_plan(): the only path that grants a paid subscription
-- ---------------------------------------------------------------------
-- Flat 30-day term, one-time charge, manually renewed (no Razorpay
-- Subscriptions integration — same one-time-order model as credit packs).
CREATE OR REPLACE FUNCTION public.activate_company_plan(
  _company_id uuid,
  _plan_id uuid,
  _actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serializes concurrent plan changes for the same company (mirrors the
  -- advisory lock in activate_job_with_tier).
  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));

  UPDATE public.company_plans
    SET status = 'expired'
    WHERE company_id = _company_id AND status = 'active';

  INSERT INTO public.company_plans (company_id, plan_id, status, starts_at, ends_at, created_by)
  VALUES (_company_id, _plan_id, 'active', now(), now() + interval '30 days', _actor);
END;
$$;

-- ---------------------------------------------------------------------
-- 4. switch_company_plan_to_basic(): free downgrade, no payment
-- ---------------------------------------------------------------------
-- Basic is simply "no active company_plans row" — get_company_entitlements()
-- already falls back to the seeded Basic plan when none exists. Downgrading
-- doesn't touch already-active jobs/boosts; it only affects future publishes,
-- same as how the live-jobs cap already behaves for a company at its limit.
CREATE OR REPLACE FUNCTION public.switch_company_plan_to_basic(
  _company_id uuid,
  _actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));

  UPDATE public.company_plans
    SET status = 'cancelled'
    WHERE company_id = _company_id AND status = 'active';
END;
$$;

-- ---------------------------------------------------------------------
-- 5. issue_plan_invoice(): GST invoice for a plan purchase
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_plan_invoice(
  _order_id uuid,
  _razorpay_payment_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seller_state constant text := '08'; -- Rajasthan; keep in sync with SELLER in src/lib/invoice-pdf.ts
  _existing uuid;
  _order record;
  _plan record;
  _company record;
  _state_code text;
  _cgst numeric(12,2);
  _sgst numeric(12,2);
  _intra boolean;
  _invoice_id uuid;
  _inv_no text;
BEGIN
  SELECT id INTO _existing FROM public.invoices WHERE source = 'plan' AND source_id = _order_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  SELECT * INTO _order FROM public.razorpay_orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _plan FROM public.plans WHERE id = _order.plan_id;
  SELECT * INTO _company FROM public.companies WHERE id = _order.company_id;

  _state_code := public.buyer_gst_state_code(_company.gst_number, _company.pincode);
  _intra := coalesce(_state_code = _seller_state, false);
  _cgst := CASE WHEN _intra THEN round(_order.gst_inr / 2, 2) ELSE 0 END;
  _sgst := CASE WHEN _intra THEN _order.gst_inr - _cgst ELSE 0 END;

  _inv_no := public.next_invoice_number();

  INSERT INTO public.invoices (
    invoice_number, company_id, source, source_id, line_items,
    subtotal_inr, cgst_inr, sgst_inr, igst_inr, total_inr,
    buyer_snapshot, payment_method, payment_reference, payment_status
  ) VALUES (
    _inv_no, _order.company_id, 'plan', _order.id,
    jsonb_build_array(jsonb_build_object(
      'description', coalesce(_plan.name, 'Plan') || ' Plan — 30-day subscription',
      'hsn_sac', '998313',
      'qty', 1,
      'rate_inr', _order.subtotal_inr
    )),
    _order.subtotal_inr, _cgst, _sgst, CASE WHEN _intra THEN 0 ELSE _order.gst_inr END,
    round(_order.amount_paise / 100.0, 2),
    jsonb_build_object(
      'name', _company.name, 'gstin', _company.gst_number,
      'pan', _company.pan_number, 'city', _company.hq_city,
      'pincode', _company.pincode,
      'state_code', _state_code,
      'state', public.gst_state_name(_state_code)
    ),
    'Razorpay', _razorpay_payment_id, 'Paid'
  )
  ON CONFLICT (invoice_number) DO NOTHING
  RETURNING id INTO _invoice_id;

  RETURN _invoice_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 6. fulfill_razorpay_order(): branch credit-pack vs plan fulfilment
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
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _o.company_id;
    RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'balance', coalesce(_bal, 0), 'order_kind', 'credit_pack');
  END IF;

  IF _o.status = 'amount_mismatch' THEN
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'balance', NULL, 'order_kind', CASE WHEN _is_plan THEN 'plan' ELSE 'credit_pack' END);
  END IF;

  -- 'created' or 'failed' (Razorpay allows a retry on the same order).
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
    -- Invoice failure must never block plan activation (same rule as credit packs).
    BEGIN
      PERFORM public.issue_plan_invoice(_o.id, _razorpay_payment_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_plan_invoice failed for order %: %', _o.id, SQLERRM;
    END;
  ELSE
    _bal := public.apply_credit_delta(
      _o.company_id, _o.credits, 'purchase'::public.credit_txn_kind,
      jsonb_build_object('order_id', _o.id, 'razorpay_payment_id', _razorpay_payment_id, 'via', _via),
      _actor
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

-- ---------------------------------------------------------------------
-- 7. get_company_entitlements(): surface the active plan's expiry
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
BEGIN
  IF NOT (public.has_company_membership(auth.uid(), _company_id)
          OR public.has_platform_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Active subscription (partial unique index guarantees <= 1 active row).
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
    -- No active plan => fall back to the seeded Basic (free) plan limits.
    SELECT p.id, p.name, p.limits
      INTO _plan_id, _plan_name, _limits
    FROM public.plans p
    WHERE p.name = 'Basic' AND p.is_custom = false
    ORDER BY p.created_at
    LIMIT 1;
    _plan_ends_at := NULL;
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
    'plan_ends_at', _plan_ends_at,
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

-- ---------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_plan_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_company_plan(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_plan_invoice(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_plan_order(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_company_plan(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_plan_invoice(uuid, text) TO service_role;

-- No payment involved — safe for the client to call directly, membership-gated.
REVOKE EXECUTE ON FUNCTION public.switch_company_plan_to_basic(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_company_plan_to_basic(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_company_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_entitlements(uuid) TO authenticated;

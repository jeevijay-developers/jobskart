-- Fix a bug introduced in 20260928061654_benefit_type_split.sql:
-- fulfill_razorpay_order()'s "already paid" idempotent-retry short-circuit
-- (hit when a client-verify and a webhook race, or a webhook retries after
-- fulfilment already happened) always read job_post_balance regardless of
-- the order's actual benefit_type — a webhook retry on an already-fulfilled
-- Boost Pack or contact pack purchase would report the wrong balance back
-- to the caller. The fresh-fulfilment branch already correctly reports
-- whichever balance apply_credit_delta() touched; this fixes the retry
-- branch to match.

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
    SELECT CASE COALESCE(_o.benefit_type, 'job_post'::public.benefit_type)
      WHEN 'job_post' THEN job_post_balance
      WHEN 'contact' THEN contact_balance
      WHEN 'boost' THEN boost_balance
    END INTO _bal
    FROM public.employer_credit_wallets WHERE company_id = _o.company_id;
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

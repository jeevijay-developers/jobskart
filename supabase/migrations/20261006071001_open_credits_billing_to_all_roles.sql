-- Credits module is now usable by every employer company role (super_admin,
-- hr_admin, recruiter), not just super_admin. Reads were already open to all
-- members via RLS; this widens the three money-moving RPCs from
-- super_admin-only to any active company member. Bodies are otherwise
-- unchanged from 20260930170000_multi_user_rbac_hardening.sql. Re-runnable.
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

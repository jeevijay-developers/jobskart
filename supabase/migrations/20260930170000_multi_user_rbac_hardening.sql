-- ============================================================================
-- Multi-User Recruiter Roles & RBAC hardening
-- ============================================================================
-- 1. Restore anon preview of an invite (invite.$token.tsx calls
--    get_invite_by_token before it knows whether the visitor is signed in).
-- 2. Require super_admin (not just membership) for money-moving RPCs:
--    create_credit_pack_order, create_plan_order, switch_company_plan_to_basic.
-- 3. Add cancel/resend invite RPCs (super_admin or hr_admin).
-- 4. Restrict company_documents & company_verifications writes to
--    super_admin/hr_admin (any member can still view).
-- 5. Restrict jobs UPDATE/DELETE for recruiters to jobs they posted;
--    super_admin/hr_admin keep full company-wide access.
-- Re-runnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Restore public token lookup for invites (needed by /invite/$token for anon)
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO anon;

-- ----------------------------------------------------------------------------
-- 2. Restrict credit pack / plan purchase & downgrade to super admins
-- ----------------------------------------------------------------------------
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
  IF _actor IS NULL OR NOT public.has_company_role(_actor, _company_id, 'super_admin') THEN
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
  IF _actor IS NULL OR NOT public.has_company_role(_actor, _company_id, 'super_admin') THEN
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
  IF _actor IS NULL OR NOT public.has_company_role(_actor, _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));

  UPDATE public.company_plans
    SET status = 'cancelled'
    WHERE company_id = _company_id AND status = 'active';
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Cancel and resend invite RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_employer_invite(_company_id uuid, _invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_authorized boolean;
  _inv public.employer_invites%ROWTYPE;
BEGIN
  _is_authorized := public.has_company_role(auth.uid(), _company_id, 'super_admin')
                 OR public.has_company_role(auth.uid(), _company_id, 'hr_admin');
  IF NOT _is_authorized THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT * INTO _inv FROM public.employer_invites
    WHERE id = _invite_id AND company_id = _company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF _inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot cancel an invite that has already been accepted';
  END IF;

  DELETE FROM public.employer_invites WHERE id = _invite_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invite_cancelled',
    'Invitation cancelled',
    'Invitation for ' || _inv.email || ' was cancelled',
    '/employer/team',
    jsonb_build_object('invite_id', _invite_id, 'email', _inv.email)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_employer_invite(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_employer_invite(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resend_employer_invite(_company_id uuid, _invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_authorized boolean;
  _inv public.employer_invites%ROWTYPE;
  _new_token text;
  _new_expiry timestamptz;
BEGIN
  _is_authorized := public.has_company_role(auth.uid(), _company_id, 'super_admin')
                 OR public.has_company_role(auth.uid(), _company_id, 'hr_admin');
  IF NOT _is_authorized THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT * INTO _inv FROM public.employer_invites
    WHERE id = _invite_id AND company_id = _company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF _inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot resend an invite that has already been accepted';
  END IF;

  _new_token := encode(gen_random_bytes(24), 'hex');
  _new_expiry := now() + interval '7 days';

  UPDATE public.employer_invites
    SET token = _new_token, expires_at = _new_expiry
    WHERE id = _invite_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invite_resent',
    'Invitation resent',
    'Invitation for ' || _inv.email || ' was refreshed',
    '/employer/team',
    jsonb_build_object('invite_id', _invite_id, 'email', _inv.email)
  );

  RETURN jsonb_build_object(
    'id', _invite_id,
    'email', _inv.email,
    'token', _new_token,
    'expires_at', _new_expiry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resend_employer_invite(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_employer_invite(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Tighten company documents & legal KYC RLS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Company members manage their documents" ON public.company_documents;

CREATE POLICY "Company members can view documents" ON public.company_documents
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

CREATE POLICY "Admins can insert company documents" ON public.company_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
  );

CREATE POLICY "Admins can update company documents" ON public.company_documents
  FOR UPDATE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
  )
  WITH CHECK (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
  );

CREATE POLICY "Admins can delete company documents" ON public.company_documents
  FOR DELETE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
  );

DROP POLICY IF EXISTS "cv members insert" ON public.company_verifications;
CREATE POLICY "Admins can submit company verifications" ON public.company_verifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
  );

-- ----------------------------------------------------------------------------
-- 5. Tighten jobs UPDATE/DELETE RLS for multi-recruiter isolation
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Company members can update jobs" ON public.jobs;
CREATE POLICY "Authorized members can update jobs" ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
    OR (public.has_company_membership(auth.uid(), company_id) AND posted_by = auth.uid())
  )
  WITH CHECK (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
    OR (public.has_company_membership(auth.uid(), company_id) AND posted_by = auth.uid())
  );

DROP POLICY IF EXISTS "Company members can delete jobs" ON public.jobs;
CREATE POLICY "Authorized members can delete jobs" ON public.jobs
  FOR DELETE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'super_admin')
    OR public.has_company_role(auth.uid(), company_id, 'hr_admin')
    OR (public.has_company_membership(auth.uid(), company_id) AND posted_by = auth.uid() AND status = 'draft')
  );

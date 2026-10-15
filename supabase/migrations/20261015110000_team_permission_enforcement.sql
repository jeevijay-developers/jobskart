-- ============================================================================
-- Team module Phase 1A (part 2): enforce permissions in the database
-- ============================================================================
-- 1. SECURITY FIX: employer_members INSERT policy was `user_id = auth.uid()`
--    only, so any signed-in user could add themselves as super_admin of ANY
--    company. Self-insert is now limited to bootstrapping a company the user
--    created that has no members yet (employer sign-up). All other membership
--    changes go through SECURITY DEFINER RPCs (accept_invite, create_company_
--    with_owner, set_member_role, ...).
-- 2. Direct UPDATE on employer_members by the client is removed; owners use
--    set_member_role / set_member_permissions / set_member_manager so the
--    escalation and last-owner guards cannot be bypassed.
-- 3. Posting, boosting and unlocking are permission-gated at the table level
--    (covers plan-quota and allowance paths that never touch the wallet).
-- 4. Money-moving purchase RPCs use credits.purchase / billing.manage instead
--    of the hard-coded super_admin enum.
-- Re-runnable.
-- ============================================================================

-- ── 1. Close the self-insert hole ───────────────────────────
CREATE OR REPLACE FUNCTION public.can_bootstrap_company_membership(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = _company_id AND c.created_by = _user_id)
     AND NOT EXISTS (SELECT 1 FROM public.employer_members m WHERE m.company_id = _company_id);
$$;
REVOKE ALL ON FUNCTION public.can_bootstrap_company_membership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_bootstrap_company_membership(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "User can insert own membership" ON public.employer_members;
CREATE POLICY "Creator bootstraps first owner membership" ON public.employer_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'super_admin'
    AND public.can_bootstrap_company_membership(auth.uid(), company_id)
  );

-- ── 2. No direct client UPDATE / DELETE on memberships ──────
DROP POLICY IF EXISTS "Super admins can update team memberships" ON public.employer_members;
DROP POLICY IF EXISTS "Super admins can remove team memberships" ON public.employer_members;
REVOKE UPDATE, DELETE, TRUNCATE ON public.employer_members FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.employer_members FROM anon;
REVOKE UPDATE ON public.employer_invites FROM anon, authenticated;
REVOKE INSERT ON public.employer_invites FROM anon, authenticated;
GRANT INSERT ON public.employer_members TO authenticated;

-- ── 3. Table-level permission guards ────────────────────────
-- Skipped for service-role / SQL sessions (auth.uid() IS NULL) and platform admins.
CREATE OR REPLACE FUNCTION public.tg_require_job_create_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_platform_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'active') THEN
    IF NOT public.has_company_permission(auth.uid(), NEW.company_id, 'jobs.create') THEN
      RAISE EXCEPTION 'insufficient_permissions';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jobs_require_create_permission ON public.jobs;
CREATE TRIGGER trg_jobs_require_create_permission
  BEFORE INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_require_job_create_permission();

CREATE OR REPLACE FUNCTION public.tg_require_boost_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := COALESCE(auth.uid(), NEW.boosted_by);
BEGIN
  IF auth.uid() IS NULL AND NEW.boosted_by IS NULL THEN RETURN NEW; END IF;
  IF public.has_platform_role(_actor, 'super_admin') THEN RETURN NEW; END IF;
  IF NOT public.has_company_permission(_actor, NEW.company_id, 'jobs.boost') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_job_boosts_require_permission ON public.job_boosts;
CREATE TRIGGER trg_job_boosts_require_permission
  BEFORE INSERT ON public.job_boosts
  FOR EACH ROW EXECUTE FUNCTION public.tg_require_boost_permission();

CREATE OR REPLACE FUNCTION public.tg_require_unlock_permission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := COALESCE(auth.uid(), NEW.unlocked_by);
BEGIN
  IF _actor IS NULL THEN RETURN NEW; END IF;
  IF public.has_platform_role(_actor, 'super_admin') THEN RETURN NEW; END IF;
  IF NOT public.has_company_permission(_actor, NEW.company_id, 'candidates.unlock') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_candidate_unlocks_require_permission ON public.candidate_unlocks;
CREATE TRIGGER trg_candidate_unlocks_require_permission
  BEFORE INSERT ON public.candidate_unlocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_require_unlock_permission();

-- ── 4. Purchase RPCs on permissions ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_credit_pack_order(
  _company_id uuid, _pack_id uuid, _actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pack record; _subtotal numeric(12,2); _gst numeric(12,2); _paise bigint; _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_company_permission(_actor, _company_id, 'credits.purchase') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT id, name, credits, price_inr, benefit_type INTO _pack
    FROM public.credit_packs WHERE id = _pack_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'pack_unavailable'; END IF;
  _subtotal := _pack.price_inr;
  _gst := round(_subtotal * 0.18, 2);
  _paise := round((_subtotal + _gst) * 100)::bigint;
  INSERT INTO public.razorpay_orders (
    company_id, pack_id, amount_inr, credits, subtotal_inr, gst_inr, amount_paise, status, created_by, benefit_type
  ) VALUES (
    _company_id, _pack.id, _pack.price_inr, _pack.credits, _subtotal, _gst, _paise, 'created', _actor, _pack.benefit_type
  ) RETURNING id INTO _id;
  RETURN jsonb_build_object(
    'order_id', _id, 'amount_paise', _paise, 'subtotal_inr', _subtotal,
    'gst_inr', _gst, 'credits', _pack.credits, 'pack_name', _pack.name
  );
END $$;

CREATE OR REPLACE FUNCTION public.create_plan_order(
  _company_id uuid, _plan_id uuid, _actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _plan record; _subtotal numeric(12,2); _gst numeric(12,2); _paise bigint; _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_company_permission(_actor, _company_id, 'billing.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT id, name, price_inr INTO _plan FROM public.plans WHERE id = _plan_id AND is_custom = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_unavailable'; END IF;
  IF _plan.price_inr <= 0 THEN RAISE EXCEPTION 'plan_not_purchasable'; END IF;
  _subtotal := _plan.price_inr;
  _gst := round(_subtotal * 0.18, 2);
  _paise := round((_subtotal + _gst) * 100)::bigint;
  INSERT INTO public.razorpay_orders (
    company_id, plan_id, amount_inr, credits, subtotal_inr, gst_inr, amount_paise, status, created_by
  ) VALUES (
    _company_id, _plan.id, _plan.price_inr, 0, _subtotal, _gst, _paise, 'created', _actor
  ) RETURNING id INTO _id;
  RETURN jsonb_build_object(
    'order_id', _id, 'amount_paise', _paise, 'subtotal_inr', _subtotal,
    'gst_inr', _gst, 'plan_name', _plan.name
  );
END $$;

CREATE OR REPLACE FUNCTION public.switch_company_plan_to_basic(_company_id uuid, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _actor IS NULL OR NOT public.has_company_permission(_actor, _company_id, 'billing.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_company_id::text));
  UPDATE public.company_plans SET status = 'cancelled'
    WHERE company_id = _company_id AND status = 'active';
END $$;

-- Re-assert privileges (CREATE OR REPLACE keeps them, but be explicit).
REVOKE EXECUTE ON FUNCTION public.create_credit_pack_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_pack_order(uuid, uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_plan_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_plan_order(uuid, uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.switch_company_plan_to_basic(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_company_plan_to_basic(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- Credits lock-down: only people with the right permission can see or move money
-- ============================================================================
-- 1. SECURITY FIX (critical): employer_credit_wallets had INSERT and UPDATE
--    policies for ANY company member, so a recruiter could PATCH their own
--    wallet to 999999 credits straight through the REST API. Every money table
--    is now write-protected for clients; balances only change inside
--    SECURITY DEFINER functions (apply_credit_delta & co) and service role.
-- 2. Reading the wallet, transactions, orders, invoices and grant ledger now
--    requires a credits/billing permission (platform admins keep access).
--    Members who only spend get their own balance through credit_summary().
-- 3. Default templates: buying credits / managing billing is Owner + Finance
--    only (HR Admin can view billing). Supersedes the "open to all roles"
--    default of 20261006071001.
-- 4. fulfill_razorpay_order() checks the buyer's permission, not just membership.
-- Re-runnable.
-- ============================================================================

-- ── 1. Write lock-down on every money table ─────────────────
DROP POLICY IF EXISTS "Members can insert wallet" ON public.employer_credit_wallets;
DROP POLICY IF EXISTS "Members can update wallet" ON public.employer_credit_wallets;

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'employer_credit_wallets', 'credit_transactions', 'razorpay_orders', 'invoices',
    'company_benefit_grants', 'company_benefit_ledger', 'job_unlock_allowance',
    'candidate_unlocks', 'job_boosts', 'candidate_invites', 'company_plans'
  ] LOOP
    IF to_regclass('public.' || _t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', _t);
    END IF;
  END LOOP;
END $$;

-- ── 2. Permission-based reads ───────────────────────────────
CREATE OR REPLACE FUNCTION public.can_view_company_credits(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_platform_role(_user_id, 'super_admin')
      OR public.has_company_permission(_user_id, _company_id, 'credits.view_all')
      OR public.has_company_permission(_user_id, _company_id, 'billing.view')
      OR public.has_company_permission(_user_id, _company_id, 'credits.purchase');
$$;
REVOKE ALL ON FUNCTION public.can_view_company_credits(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_company_credits(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members can view wallet" ON public.employer_credit_wallets;
CREATE POLICY "Credit viewers can view wallet" ON public.employer_credit_wallets
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

DROP POLICY IF EXISTS "Members can view txns" ON public.credit_transactions;
CREATE POLICY "Credit viewers can view txns" ON public.credit_transactions
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

DROP POLICY IF EXISTS "members read own company grants" ON public.company_benefit_grants;
CREATE POLICY "credit viewers read grants" ON public.company_benefit_grants
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

DROP POLICY IF EXISTS "members read own company ledger" ON public.company_benefit_ledger;
CREATE POLICY "credit viewers read ledger" ON public.company_benefit_ledger
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

DROP POLICY IF EXISTS "Members can view orders" ON public.razorpay_orders;
CREATE POLICY "Billing viewers can view orders" ON public.razorpay_orders
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

DROP POLICY IF EXISTS "Members can view their company invoices" ON public.invoices;
CREATE POLICY "Billing viewers can view invoices" ON public.invoices
  FOR SELECT TO authenticated USING (public.can_view_company_credits(auth.uid(), company_id));

-- ── 3. Default template permissions ─────────────────────────
DELETE FROM public.company_role_permissions rp
 USING public.company_roles r
 WHERE rp.role_id = r.id AND r.company_id IS NULL
   AND r.key IN ('hr_admin', 'manager', 'recruiter')
   AND rp.permission_key IN ('credits.purchase', 'billing.manage');

DELETE FROM public.company_role_permissions rp
 USING public.company_roles r
 WHERE rp.role_id = r.id AND r.company_id IS NULL
   AND r.key IN ('manager', 'recruiter')
   AND rp.permission_key = 'billing.view';

-- ── 4. Balance reads: members only see what they may ────────
-- Credit viewers see the whole picture. Spenders see the shared balance in pooled
-- mode, and only their own reservation in allocated mode.
CREATE OR REPLACE FUNCTION public.credit_summary(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _out jsonb := '{}'::jsonb; _b public.benefit_type; _alloc int; _mine int; _mode text;
  _viewer boolean; _spender boolean; _wallet_visible boolean;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  SELECT credit_mode INTO _mode FROM public.companies WHERE id = _company_id;
  _viewer  := public.can_view_company_credits(auth.uid(), _company_id);
  _spender := public.has_company_permission(auth.uid(), _company_id, 'credits.view_own');
  _wallet_visible := _viewer OR (_mode = 'pooled' AND _spender);
  FOREACH _b IN ARRAY ARRAY['job_post','contact','boost']::public.benefit_type[] LOOP
    SELECT COALESCE(sum(balance), 0)::int INTO _alloc FROM public.member_credit_allocations
     WHERE company_id = _company_id AND benefit_type = _b;
    SELECT COALESCE(balance, 0) INTO _mine FROM public.member_credit_allocations
     WHERE company_id = _company_id AND user_id = auth.uid() AND benefit_type = _b;
    _out := _out || jsonb_build_object(_b::text, jsonb_build_object(
      'wallet',   CASE WHEN _wallet_visible THEN public.wallet_balance(_company_id, _b) END,
      'reserved', CASE WHEN _viewer THEN _alloc END,
      'pool',     CASE WHEN _viewer THEN public.wallet_balance(_company_id, _b) - _alloc END,
      'mine',     COALESCE(_mine, 0)
    ));
  END LOOP;
  RETURN jsonb_build_object(
    'mode', _mode,
    'benefits', _out,
    'can_pool_spend', public.has_company_permission(auth.uid(), _company_id, 'credits.pool_spend'),
    'can_view_all', _viewer
  );
END $$;

CREATE OR REPLACE FUNCTION public.company_benefit_balances(_company_id uuid)
RETURNS TABLE (benefit_type public.benefit_type, remaining bigint, nearest_expiry timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_company_credits(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  RETURN QUERY
  SELECT g.benefit_type, COALESCE(SUM(g.remaining), 0)::bigint,
         MIN(g.expires_at) FILTER (WHERE g.remaining > 0)
  FROM public.company_benefit_grants g
  WHERE g.company_id = _company_id
  GROUP BY g.benefit_type;
END $$;

-- ── 5. Order fulfilment checks the buyer's permission ───────

CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order(_razorpay_order_id text, _razorpay_payment_id text, _amount_paise bigint, _via text, _actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF _actor IS NOT NULL AND NOT public.has_company_permission(_actor, _o.company_id,
       CASE WHEN _o.plan_id IS NOT NULL THEN 'billing.manage' ELSE 'credits.purchase' END) THEN
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
$function$;

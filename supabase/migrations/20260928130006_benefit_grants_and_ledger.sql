-- ============================================================
-- Employer Monetization & Credit Strategy — Section 7 foundation
-- (employer-monetization-and-credit-strategy-plan.md)
-- ============================================================
--
-- Adds the benefit-grant + immutable-ledger model recommended in Section 7,
-- alongside (not instead of) the existing employer_credit_wallets /
-- credit_packs / credit_transactions tables — per Section 8's "Safe
-- sequence": add new tables, dual-write to keep them reconciled, backfill
-- existing balances, THEN cut consumption over later once reconciliation is
-- proven. This migration does NOT change which table is authoritative for
-- any live purchase/consumption decision — job posting, candidate unlocks,
-- and boosts still read/write employer_credit_wallets exactly as before.
-- The new tables accumulate in parallel so they can be verified against the
-- old wallet before anything switches over.
--
-- New tables (Section 7.1):
--   billing_products              — versioned purchasable items
--   billing_product_entitlements  — product -> benefit type/qty/validity
--   company_benefit_grants        — actual issued balance, per lot, with its
--                                    own expiry and remaining amount
--   company_benefit_ledger        — immutable grant/consume/expire/refund log
--
-- New RPCs (Section 7.2, subset — the safe, non-breaking subset):
--   grant_company_benefit()    — issue a new grant + ledger row
--   consume_company_benefit()  — idempotent (via _resource_key), row-locks
--                                 eligible grants oldest-expiry-first
--   expire_benefit_grants()    — scheduled sweep for lapsed grants
--   company_benefit_balances() — read helper for UI (remaining + nearest
--                                 expiry per benefit type)
--   admin_grant_company_benefit() — platform-admin-only wrapper, requires an
--                                    audit reason (Section 7.3)
--   benefit_reconciliation_report() — compares wallet balances against grant
--                                      totals so drift can be caught early
--
-- NOT built in this pass (require product/business decisions the plan
-- itself gates behind Phase 0 validation, not pure engineering):
--   company_subscriptions, billing_orders, promotion_campaigns,
--   candidate_contact_access. Subscriptions and orders already have working
--   equivalents (company_plans, razorpay_orders); campaigns and time-bound
--   contact access are explicitly Phase 3/4 in the document.

-- ── 1. billing_products / billing_product_entitlements ──────
CREATE TABLE IF NOT EXISTS public.billing_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('one_time_pack', 'subscription', 'addon')),
  price_inr int NOT NULL CHECK (price_inr >= 0),
  legacy_credit_pack_id uuid REFERENCES public.credit_packs(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_product_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.billing_products(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  validity_days int,  -- NULL = no expiry
  UNIQUE (product_id, benefit_type)
);

GRANT SELECT ON public.billing_products, public.billing_product_entitlements TO authenticated;
GRANT ALL ON public.billing_products, public.billing_product_entitlements TO service_role;
ALTER TABLE public.billing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_product_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can read active products" ON public.billing_products
  FOR SELECT TO authenticated USING (active);
CREATE POLICY "anyone can read entitlements of active products" ON public.billing_product_entitlements
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.billing_products p WHERE p.id = product_id AND p.active)
  );

-- Seed billing_products/entitlements from the current live credit_packs, so
-- the catalogue already reflects reality on day one (1:1 mapping, same
-- price/quantity, no expiry — matching credit_packs' own current behavior,
-- which has no per-pack validity field today).
INSERT INTO public.billing_products (code, name, kind, price_inr, legacy_credit_pack_id, active)
  SELECT 'legacy_' || cp.id::text, cp.name, 'one_time_pack', cp.price_inr, cp.id, cp.active
  FROM public.credit_packs cp
  ON CONFLICT (code) DO NOTHING;

INSERT INTO public.billing_product_entitlements (product_id, benefit_type, quantity, validity_days)
  SELECT bp.id, cp.benefit_type, cp.credits, NULL
  FROM public.billing_products bp
  JOIN public.credit_packs cp ON cp.id = bp.legacy_credit_pack_id
  ON CONFLICT (product_id, benefit_type) DO NOTHING;

-- ── 2. company_benefit_grants ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_benefit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  remaining int NOT NULL CHECK (remaining >= 0 AND remaining <= quantity),
  source text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,  -- NULL = never expires
  reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_company_benefit_grants_eligible
  ON public.company_benefit_grants (company_id, benefit_type, expires_at)
  WHERE remaining > 0;

GRANT SELECT ON public.company_benefit_grants TO authenticated;
GRANT ALL ON public.company_benefit_grants TO service_role;
ALTER TABLE public.company_benefit_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own company grants" ON public.company_benefit_grants
  FOR SELECT TO authenticated USING (public.has_company_membership(auth.uid(), company_id));

-- ── 3. company_benefit_ledger (append-only) ──────────────────
CREATE TABLE IF NOT EXISTS public.company_benefit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  event text NOT NULL CHECK (event IN ('grant', 'consume', 'expire', 'refund', 'adjust')),
  delta int NOT NULL,
  grant_id uuid REFERENCES public.company_benefit_grants(id) ON DELETE SET NULL,
  resource_key text,
  reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Idempotency guard: at most one 'consume' ledger row per
-- (company, benefit_type, resource_key) when a resource_key is supplied —
-- this is what makes consume_company_benefit() safe to call twice for the
-- same logical action (client retry, webhook redelivery).
CREATE UNIQUE INDEX idx_company_benefit_ledger_consume_idem
  ON public.company_benefit_ledger (company_id, benefit_type, resource_key)
  WHERE event = 'consume' AND resource_key IS NOT NULL;
CREATE INDEX idx_company_benefit_ledger_company ON public.company_benefit_ledger (company_id, created_at DESC);

GRANT SELECT ON public.company_benefit_ledger TO authenticated;
GRANT ALL ON public.company_benefit_ledger TO service_role;
ALTER TABLE public.company_benefit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own company ledger" ON public.company_benefit_ledger
  FOR SELECT TO authenticated USING (public.has_company_membership(auth.uid(), company_id));

-- ── 4. grant_company_benefit() ───────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_company_benefit(
  _company_id uuid,
  _benefit_type public.benefit_type,
  _quantity int,
  _validity_days int DEFAULT NULL,
  _source text DEFAULT 'admin_adjustment',
  _reference jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _grant_id uuid;
  _expires timestamptz;
BEGIN
  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  _expires := CASE WHEN _validity_days IS NULL THEN NULL ELSE now() + (_validity_days || ' days')::interval END;

  INSERT INTO public.company_benefit_grants
      (company_id, benefit_type, quantity, remaining, source, expires_at, reference, created_by)
    VALUES (_company_id, _benefit_type, _quantity, _quantity, _source, _expires, _reference, _actor)
    RETURNING id INTO _grant_id;

  INSERT INTO public.company_benefit_ledger
      (company_id, benefit_type, event, delta, grant_id, reference, created_by)
    VALUES (_company_id, _benefit_type, 'grant', _quantity, _grant_id, _reference, _actor);

  RETURN _grant_id;
END $$;

REVOKE ALL ON FUNCTION public.grant_company_benefit(uuid, public.benefit_type, int, int, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_company_benefit(uuid, public.benefit_type, int, int, text, jsonb, uuid) TO service_role;

-- ── 5. consume_company_benefit() ─────────────────────────────
-- Locks eligible (non-expired, remaining>0) grants for the company/benefit
-- type oldest-expiring first, decrements across as many as needed, and
-- writes ONE ledger row per call summarizing every grant touched. Idempotent
-- when _resource_key is supplied: a repeat call with the same key is a no-op
-- that returns the current total instead of double-consuming.
CREATE OR REPLACE FUNCTION public.consume_company_benefit(
  _company_id uuid,
  _benefit_type public.benefit_type,
  _quantity int,
  _resource_key text DEFAULT NULL,
  _reference jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _remaining_needed int := _quantity;
  _row record;
  _take int;
  _total_remaining int;
  _breakdown jsonb := '[]'::jsonb;
  _touched_grant uuid;
  _touched_count int := 0;
BEGIN
  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  IF _resource_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.company_benefit_ledger
    WHERE company_id = _company_id AND benefit_type = _benefit_type
      AND event = 'consume' AND resource_key = _resource_key
  ) THEN
    SELECT COALESCE(SUM(remaining), 0) INTO _total_remaining
      FROM public.company_benefit_grants
      WHERE company_id = _company_id AND benefit_type = _benefit_type;
    RETURN _total_remaining;
  END IF;

  FOR _row IN
    SELECT id, remaining FROM public.company_benefit_grants
    WHERE company_id = _company_id AND benefit_type = _benefit_type
      AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at ASC NULLS LAST
    FOR UPDATE
  LOOP
    EXIT WHEN _remaining_needed <= 0;
    _take := LEAST(_row.remaining, _remaining_needed);
    UPDATE public.company_benefit_grants SET remaining = remaining - _take WHERE id = _row.id;
    _breakdown := _breakdown || jsonb_build_object('grant_id', _row.id, 'taken', _take);
    _touched_grant := _row.id;
    _touched_count := _touched_count + 1;
    _remaining_needed := _remaining_needed - _take;
  END LOOP;

  IF _remaining_needed > 0 THEN
    RAISE EXCEPTION 'insufficient_benefit_balance';
  END IF;

  INSERT INTO public.company_benefit_ledger
      (company_id, benefit_type, event, delta, grant_id, resource_key, reference, created_by)
    VALUES (
      _company_id, _benefit_type, 'consume', -_quantity,
      CASE WHEN _touched_count = 1 THEN _touched_grant ELSE NULL END,
      _resource_key,
      _reference || jsonb_build_object('grants_consumed', _breakdown),
      _actor
    );

  SELECT COALESCE(SUM(remaining), 0) INTO _total_remaining
    FROM public.company_benefit_grants
    WHERE company_id = _company_id AND benefit_type = _benefit_type;
  RETURN _total_remaining;
END $$;

REVOKE ALL ON FUNCTION public.consume_company_benefit(uuid, public.benefit_type, int, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_company_benefit(uuid, public.benefit_type, int, text, jsonb, uuid) TO service_role;

-- ── 6. expire_benefit_grants() — scheduled sweep ─────────────
CREATE OR REPLACE FUNCTION public.expire_benefit_grants()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
  _count int := 0;
BEGIN
  FOR _row IN
    SELECT id, company_id, benefit_type, remaining
    FROM public.company_benefit_grants
    WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.company_benefit_grants SET remaining = 0 WHERE id = _row.id;
    INSERT INTO public.company_benefit_ledger (company_id, benefit_type, event, delta, grant_id, reference)
      VALUES (_row.company_id, _row.benefit_type, 'expire', -_row.remaining, _row.id, jsonb_build_object('reason', 'validity_elapsed'));
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $$;

REVOKE ALL ON FUNCTION public.expire_benefit_grants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_benefit_grants() TO service_role;

-- ── 7. company_benefit_balances() — UI read helper ───────────
CREATE OR REPLACE FUNCTION public.company_benefit_balances(_company_id uuid)
RETURNS TABLE (benefit_type public.benefit_type, remaining bigint, nearest_expiry timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  RETURN QUERY
  SELECT g.benefit_type, COALESCE(SUM(g.remaining), 0)::bigint,
         MIN(g.expires_at) FILTER (WHERE g.remaining > 0)
  FROM public.company_benefit_grants g
  WHERE g.company_id = _company_id
  GROUP BY g.benefit_type;
END $$;

REVOKE ALL ON FUNCTION public.company_benefit_balances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_benefit_balances(uuid) TO authenticated;

-- ── 8. admin_grant_company_benefit() — platform-admin wrapper ─
-- Section 7.3: "Admin adjustments require separate audit reason."
CREATE OR REPLACE FUNCTION public.admin_grant_company_benefit(
  _company_id uuid,
  _benefit_type public.benefit_type,
  _quantity int,
  _validity_days int,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _grant_id uuid;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  _grant_id := public.grant_company_benefit(
    _company_id, _benefit_type, _quantity, _validity_days,
    'admin_adjustment', jsonb_build_object('reason', _reason), auth.uid()
  );
  RETURN _grant_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_grant_company_benefit(uuid, public.benefit_type, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_company_benefit(uuid, public.benefit_type, int, int, text) TO authenticated;

-- ── 9. benefit_reconciliation_report() — drift detector ──────
-- Compares employer_credit_wallets (still authoritative) against the new
-- grants total per company/benefit_type, so any divergence introduced while
-- both systems run in parallel is visible before anything cuts over.
CREATE OR REPLACE FUNCTION public.benefit_reconciliation_report()
RETURNS TABLE (
  company_id uuid,
  benefit_type public.benefit_type,
  wallet_balance int,
  grants_remaining bigint,
  drift bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH wallet AS (
    SELECT company_id, 'job_post'::public.benefit_type AS benefit_type, job_post_balance AS balance FROM public.employer_credit_wallets
    UNION ALL
    SELECT company_id, 'contact'::public.benefit_type, contact_balance FROM public.employer_credit_wallets
    UNION ALL
    SELECT company_id, 'boost'::public.benefit_type, boost_balance FROM public.employer_credit_wallets
  ),
  grants AS (
    SELECT g.company_id, g.benefit_type, COALESCE(SUM(g.remaining), 0) AS remaining
    FROM public.company_benefit_grants g
    GROUP BY g.company_id, g.benefit_type
  )
  SELECT w.company_id, w.benefit_type, w.balance, COALESCE(g.remaining, 0),
         COALESCE(g.remaining, 0) - w.balance
  FROM wallet w
  LEFT JOIN grants g ON g.company_id = w.company_id AND g.benefit_type = w.benefit_type
  WHERE w.balance <> COALESCE(g.remaining, 0)
  ORDER BY w.company_id;
$$;

REVOKE ALL ON FUNCTION public.benefit_reconciliation_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.benefit_reconciliation_report() TO service_role;

-- ── 10. Backfill: convert every existing wallet balance into a  ──
--        legacy_migration grant, no expiry, no value loss.
DO $$
DECLARE _w record;
BEGIN
  FOR _w IN SELECT company_id, job_post_balance, contact_balance, boost_balance FROM public.employer_credit_wallets
  LOOP
    IF _w.job_post_balance > 0 THEN
      PERFORM public.grant_company_benefit(
        _w.company_id, 'job_post'::public.benefit_type, _w.job_post_balance, NULL,
        'legacy_migration',
        jsonb_build_object('migrated_from', 'employer_credit_wallets.job_post_balance', 'migration', '20260928130006_benefit_grants_and_ledger'),
        NULL
      );
    END IF;
    IF _w.contact_balance > 0 THEN
      PERFORM public.grant_company_benefit(
        _w.company_id, 'contact'::public.benefit_type, _w.contact_balance, NULL,
        'legacy_migration',
        jsonb_build_object('migrated_from', 'employer_credit_wallets.contact_balance', 'migration', '20260928130006_benefit_grants_and_ledger'),
        NULL
      );
    END IF;
    IF _w.boost_balance > 0 THEN
      PERFORM public.grant_company_benefit(
        _w.company_id, 'boost'::public.benefit_type, _w.boost_balance, NULL,
        'legacy_migration',
        jsonb_build_object('migrated_from', 'employer_credit_wallets.boost_balance', 'migration', '20260928130006_benefit_grants_and_ledger'),
        NULL
      );
    END IF;
  END LOOP;
END $$;

-- ── 11. Dual-write: apply_credit_delta() now also mirrors every ──
--        grant/consume into the new ledger, in the same transaction,
--        but wrapped so a failure here can NEVER block or roll back the
--        authoritative wallet mutation (same "best-effort side write"
--        pattern already used for invoice issuance in
--        fulfill_razorpay_order). This is what keeps the two systems
--        reconciled going forward without touching every call site.
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

  -- Best-effort mirror into the new grant/ledger model. Never blocks the
  -- wallet mutation above, which stays authoritative for now.
  BEGIN
    IF _delta > 0 THEN
      PERFORM public.grant_company_benefit(
        _company_id, _benefit_type, _delta, NULL,
        'apply_credit_delta:' || _kind::text, COALESCE(_reference, '{}'::jsonb), _actor
      );
    ELSIF _delta < 0 THEN
      PERFORM public.consume_company_benefit(
        _company_id, _benefit_type, -_delta, NULL,
        COALESCE(_reference, '{}'::jsonb) || jsonb_build_object('via', 'apply_credit_delta', 'kind', _kind::text), _actor
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'benefit ledger mirror failed for company % (% %): %', _company_id, _kind, _benefit_type, SQLERRM;
  END;

  RETURN _new_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) TO service_role;

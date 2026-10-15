-- ============================================================================
-- Team module Phase 3: reserved per-member credits
-- (prompt structure/team-management.md section 10)
-- ============================================================================
-- Model: employer_credit_wallets stays the authoritative company total. A
-- member allocation is a RESERVATION against that total:
--     pool available = wallet balance - SUM(member allocations)      (per benefit)
-- Allocating moves credits pool -> member, delegating moves member -> member
-- (inside the delegator's subtree), reclaiming moves them back. A spend by a
-- member debits the wallet AND that member's allocation in one transaction, so
-- the invariant  wallet >= SUM(allocations)  always holds.
-- The mode is opt-in per company (companies.credit_mode): 'pooled' keeps the
-- existing behaviour untouched, 'allocated' enforces reservations.
-- Enforcement lives in apply_credit_delta(), the single choke point every
-- spend (job post, boost, unlock, invite) already goes through, with the
-- wallet row locked first (same order everywhere => no deadlocks).
-- Re-runnable.
-- ============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS credit_mode text NOT NULL DEFAULT 'pooled'
  CHECK (credit_mode IN ('pooled', 'allocated'));

-- ── 1. Tables ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_credit_allocations (
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  balance      int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, benefit_type)
);

CREATE TABLE IF NOT EXISTS public.member_credit_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  event        text NOT NULL CHECK (event IN ('allocate','delegate','reclaim','spend','refund','sweep','trim','release')),
  from_user    uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = company pool
  to_user      uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = pool / left the company
  qty          int NOT NULL CHECK (qty > 0),
  actor        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idem_key     text,
  reference    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_credit_ledger_idem
  ON public.member_credit_ledger (company_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_member_credit_ledger_company ON public.member_credit_ledger (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_credit_ledger_spend
  ON public.member_credit_ledger (company_id, from_user, created_at) WHERE event = 'spend';

CREATE TABLE IF NOT EXISTS public.credit_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requester    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  benefit_type public.benefit_type NOT NULL,
  qty          int NOT NULL CHECK (qty BETWEEN 1 AND 100000),
  reason       text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  routed_to    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  decided_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  decision_note text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_requests_company_status ON public.credit_requests (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_requests_requester ON public.credit_requests (requester, status);

-- ── 2. Helpers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_balance(_company_id uuid, _benefit public.benefit_type)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE _benefit WHEN 'job_post' THEN job_post_balance WHEN 'contact' THEN contact_balance ELSE boost_balance END
    FROM public.employer_credit_wallets WHERE company_id = _company_id
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.pool_available(_company_id uuid, _benefit public.benefit_type)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.wallet_balance(_company_id, _benefit)
       - COALESCE((SELECT sum(balance) FROM public.member_credit_allocations
                    WHERE company_id = _company_id AND benefit_type = _benefit), 0)::int;
$$;

CREATE OR REPLACE FUNCTION public.benefit_spend_permission(_benefit public.benefit_type)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _benefit WHEN 'job_post' THEN 'jobs.create' WHEN 'contact' THEN 'candidates.unlock' ELSE 'jobs.boost' END;
$$;

-- Core mover. _from / _to NULL = company pool. Locks the wallet row first, then
-- allocation rows in user_id order. Internal: not granted to clients.
CREATE OR REPLACE FUNCTION public.move_member_credits(
  _company_id uuid, _from uuid, _to uuid, _benefit public.benefit_type, _qty int,
  _event text, _actor uuid, _idem text DEFAULT NULL, _ref jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _have int; _col text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF _from IS NOT DISTINCT FROM _to THEN RAISE EXCEPTION 'invalid_transfer'; END IF;

  IF _idem IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.member_credit_ledger WHERE company_id = _company_id AND idem_key = _idem
  ) THEN RETURN; END IF;

  INSERT INTO public.employer_credit_wallets (company_id, job_post_balance) VALUES (_company_id, 0)
    ON CONFLICT (company_id) DO NOTHING;
  PERFORM 1 FROM public.employer_credit_wallets WHERE company_id = _company_id FOR UPDATE;

  IF _to IS NOT NULL THEN
    INSERT INTO public.member_credit_allocations (company_id, user_id, benefit_type, balance)
      VALUES (_company_id, _to, _benefit, 0) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM 1 FROM public.member_credit_allocations
   WHERE company_id = _company_id AND benefit_type = _benefit AND user_id IN (_from, _to)
   ORDER BY user_id FOR UPDATE;

  IF _from IS NULL THEN
    IF public.pool_available(_company_id, _benefit) < _qty THEN RAISE EXCEPTION 'pool_insufficient'; END IF;
  ELSE
    SELECT balance INTO _have FROM public.member_credit_allocations
     WHERE company_id = _company_id AND user_id = _from AND benefit_type = _benefit;
    IF COALESCE(_have, 0) < _qty THEN RAISE EXCEPTION 'holder_insufficient'; END IF;
    UPDATE public.member_credit_allocations SET balance = balance - _qty, updated_at = now()
     WHERE company_id = _company_id AND user_id = _from AND benefit_type = _benefit;
  END IF;
  IF _to IS NOT NULL THEN
    UPDATE public.member_credit_allocations SET balance = balance + _qty, updated_at = now()
     WHERE company_id = _company_id AND user_id = _to AND benefit_type = _benefit;
  END IF;

  INSERT INTO public.member_credit_ledger (company_id, benefit_type, event, from_user, to_user, qty, actor, idem_key, reference)
    VALUES (_company_id, _benefit, _event, _from, _to, _qty, _actor, _idem, _ref);
END $$;

-- ── 3. Enforcement inside apply_credit_delta (the spend choke point) ──
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
  _wallet_before int;
  _mode text;
  _is_member boolean;
  _spend boolean;
  _qty int;
  _alloc int;
  _alloc_sum int;
  _deficit int;
  _row record;
  _take int;
BEGIN
  INSERT INTO public.employer_credit_wallets (company_id, job_post_balance)
    VALUES (_company_id, 0)
    ON CONFLICT (company_id) DO NOTHING;

  _col := CASE _benefit_type
    WHEN 'job_post' THEN 'job_post_balance'
    WHEN 'contact' THEN 'contact_balance'
    WHEN 'boost' THEN 'boost_balance'
  END;

  -- Lock the wallet row FIRST (same order in every credit function).
  EXECUTE format('SELECT %I FROM public.employer_credit_wallets WHERE company_id = $1 FOR UPDATE', _col)
    INTO _wallet_before USING _company_id;

  SELECT credit_mode INTO _mode FROM public.companies WHERE id = _company_id;
  _is_member := _actor IS NOT NULL AND public.has_company_membership(_actor, _company_id);
  _spend := _delta < 0 AND _kind IN ('unlock', 'boost', 'job_post', 'repost', 'invite');

  -- Permission first, so an unauthorised caller is told so rather than "no credits".
  IF _spend AND _is_member
     AND NOT public.has_company_permission(_actor, _company_id, public.benefit_spend_permission(_benefit_type)) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  -- Then the stable legacy message BEFORE touching the row: callers map 'Insufficient credits' to
  -- no_credits, and the wallet CHECK (balance >= 0) would otherwise fire first with a different error.
  IF _wallet_before + _delta < 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  IF _spend AND _is_member THEN
    IF _mode = 'allocated' THEN
      _qty := -_delta;
      SELECT balance INTO _alloc FROM public.member_credit_allocations
       WHERE company_id = _company_id AND user_id = _actor AND benefit_type = _benefit_type FOR UPDATE;
      IF COALESCE(_alloc, 0) >= _qty THEN
        UPDATE public.member_credit_allocations SET balance = balance - _qty, updated_at = now()
         WHERE company_id = _company_id AND user_id = _actor AND benefit_type = _benefit_type;
        INSERT INTO public.member_credit_ledger (company_id, benefit_type, event, from_user, to_user, qty, actor, reference)
          VALUES (_company_id, _benefit_type, 'spend', _actor, NULL, _qty, _actor, COALESCE(_reference, '{}'::jsonb));
      ELSIF public.has_company_permission(_actor, _company_id, 'credits.pool_spend') THEN
        SELECT COALESCE(sum(balance), 0)::int INTO _alloc_sum FROM public.member_credit_allocations
         WHERE company_id = _company_id AND benefit_type = _benefit_type;
        IF _wallet_before - _alloc_sum < _qty THEN RAISE EXCEPTION 'pool_insufficient'; END IF;
      ELSE
        RAISE EXCEPTION 'member_balance_insufficient';
      END IF;
    END IF;
  ELSIF _delta > 0 AND _kind = 'refund' AND _is_member AND _mode = 'allocated' THEN
    -- A refund to someone holding an allocation goes back to their allocation.
    UPDATE public.member_credit_allocations SET balance = balance + _delta, updated_at = now()
     WHERE company_id = _company_id AND user_id = _actor AND benefit_type = _benefit_type;
    IF FOUND THEN
      INSERT INTO public.member_credit_ledger (company_id, benefit_type, event, from_user, to_user, qty, actor, reference)
        VALUES (_company_id, _benefit_type, 'refund', NULL, _actor, _delta, _actor, COALESCE(_reference, '{}'::jsonb));
    END IF;
  END IF;

  EXECUTE format(
    'UPDATE public.employer_credit_wallets SET %I = %I + $1, updated_at = now() WHERE company_id = $2 RETURNING %I',
    _col, _col, _col
  ) INTO _new_balance USING _delta, _company_id;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  -- Admin adjustments / clawbacks may push the wallet under the reserved total:
  -- trim allocations (largest first) so  wallet >= SUM(allocations)  stays true.
  IF (_delta < 0 AND NOT _spend) OR (_spend AND NOT _is_member) THEN
    SELECT COALESCE(sum(balance), 0)::int INTO _alloc_sum FROM public.member_credit_allocations
     WHERE company_id = _company_id AND benefit_type = _benefit_type;
    _deficit := _alloc_sum - _new_balance;
    IF _deficit > 0 THEN
      FOR _row IN SELECT user_id, balance FROM public.member_credit_allocations
                   WHERE company_id = _company_id AND benefit_type = _benefit_type AND balance > 0
                   ORDER BY balance DESC, user_id FOR UPDATE
      LOOP
        EXIT WHEN _deficit <= 0;
        _take := LEAST(_row.balance, _deficit);
        UPDATE public.member_credit_allocations SET balance = balance - _take, updated_at = now()
         WHERE company_id = _company_id AND user_id = _row.user_id AND benefit_type = _benefit_type;
        INSERT INTO public.member_credit_ledger (company_id, benefit_type, event, from_user, to_user, qty, actor, reference)
          VALUES (_company_id, _benefit_type, 'trim', _row.user_id, NULL, _take, _actor,
                  jsonb_build_object('reason', 'wallet_reduced', 'kind', _kind::text));
        _deficit := _deficit - _take;
      END LOOP;
    END IF;
  END IF;

  INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, reference, created_by, benefit_type)
    VALUES (_company_id, _kind, _delta, _new_balance, _reference, _actor, _benefit_type);

  -- Best-effort mirror into the grant/ledger model (unchanged from the original).
  BEGIN
    IF _delta > 0 THEN
      PERFORM public.grant_company_benefit(
        _company_id, _benefit_type, _delta, NULL,
        'apply_credit_delta:' || _kind::text, COALESCE(_reference, '{}'::jsonb), _actor,
        CASE WHEN _kind = 'refund' THEN 'refund' ELSE 'grant' END
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

-- ── 4. Client-facing RPCs ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_credit_mode(_company_id uuid, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.allocate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _mode NOT IN ('pooled', 'allocated') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  PERFORM 1 FROM public.employer_credit_wallets WHERE company_id = _company_id FOR UPDATE;
  IF _mode = 'pooled' THEN
    -- Release every reservation back to the pool, with an audit trail.
    FOR _row IN SELECT user_id, benefit_type, balance FROM public.member_credit_allocations
                 WHERE company_id = _company_id AND balance > 0 FOR UPDATE LOOP
      INSERT INTO public.member_credit_ledger (company_id, benefit_type, event, from_user, to_user, qty, actor, reference)
        VALUES (_company_id, _row.benefit_type, 'release', _row.user_id, NULL, _row.balance, auth.uid(),
                jsonb_build_object('reason', 'mode_pooled'));
    END LOOP;
    UPDATE public.member_credit_allocations SET balance = 0, updated_at = now()
     WHERE company_id = _company_id AND balance > 0;
  END IF;
  UPDATE public.companies SET credit_mode = _mode WHERE id = _company_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.mode_changed', 'Credit mode changed',
    'Credits are now ' || CASE _mode WHEN 'allocated' THEN 'allocated per member' ELSE 'shared in one pool' END,
    '/employer/credits', jsonb_build_object('mode', _mode)
  );
END $$;

CREATE OR REPLACE FUNCTION public.allocate_member_credits(
  _company_id uuid, _to_user uuid, _benefit public.benefit_type, _qty int, _idem text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.allocate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF (SELECT credit_mode FROM public.companies WHERE id = _company_id) <> 'allocated' THEN
    RAISE EXCEPTION 'allocation_mode_off';
  END IF;
  IF NOT public.has_company_membership(_to_user, _company_id) THEN RAISE EXCEPTION 'target_not_member'; END IF;
  IF NOT public.has_company_permission(_to_user, _company_id, public.benefit_spend_permission(_benefit)) THEN
    RAISE EXCEPTION 'target_cannot_spend';
  END IF;
  PERFORM public.move_member_credits(_company_id, NULL, _to_user, _benefit, _qty, 'allocate', auth.uid(), _idem, '{}'::jsonb);
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.allocated', 'Credits allocated',
    _qty || ' ' || _benefit::text || ' credits allocated to a teammate', '/employer/credits',
    jsonb_build_object('to_user', _to_user, 'benefit', _benefit, 'qty', _qty)
  );
END $$;

CREATE OR REPLACE FUNCTION public.delegate_member_credits(
  _company_id uuid, _to_user uuid, _benefit public.benefit_type, _qty int, _idem text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.delegate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF (SELECT credit_mode FROM public.companies WHERE id = _company_id) <> 'allocated' THEN
    RAISE EXCEPTION 'allocation_mode_off';
  END IF;
  IF _to_user = auth.uid() OR NOT public.is_in_subtree(_company_id, auth.uid(), _to_user) THEN
    RAISE EXCEPTION 'target_not_in_subtree';
  END IF;
  IF NOT public.has_company_permission(_to_user, _company_id, public.benefit_spend_permission(_benefit)) THEN
    RAISE EXCEPTION 'target_cannot_spend';
  END IF;
  PERFORM public.move_member_credits(_company_id, auth.uid(), _to_user, _benefit, _qty, 'delegate', auth.uid(), _idem, '{}'::jsonb);
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.delegated', 'Credits delegated',
    _qty || ' ' || _benefit::text || ' credits delegated to a team member', '/employer/credits',
    jsonb_build_object('to_user', _to_user, 'benefit', _benefit, 'qty', _qty)
  );
END $$;

-- _qty NULL = everything the member holds. Pool authority (credits.allocate) returns
-- credits to the pool; a manager (credits.reclaim) takes back from their subtree into
-- their own balance.
CREATE OR REPLACE FUNCTION public.reclaim_member_credits(
  _company_id uuid, _from_user uuid, _benefit public.benefit_type, _qty int DEFAULT NULL, _idem text DEFAULT NULL
) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _pool_auth boolean; _have int; _take int;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.reclaim') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  _pool_auth := public.has_company_permission(auth.uid(), _company_id, 'credits.allocate');
  IF NOT _pool_auth AND (_from_user = auth.uid() OR NOT public.is_in_subtree(_company_id, auth.uid(), _from_user)) THEN
    RAISE EXCEPTION 'target_not_in_subtree';
  END IF;
  PERFORM 1 FROM public.employer_credit_wallets WHERE company_id = _company_id FOR UPDATE;
  SELECT balance INTO _have FROM public.member_credit_allocations
   WHERE company_id = _company_id AND user_id = _from_user AND benefit_type = _benefit;
  _have := COALESCE(_have, 0);
  _take := COALESCE(_qty, _have);
  IF _take <= 0 THEN RETURN 0; END IF;
  IF _take > _have THEN RAISE EXCEPTION 'reclaim_exceeds_balance'; END IF;
  PERFORM public.move_member_credits(
    _company_id, _from_user, CASE WHEN _pool_auth THEN NULL ELSE auth.uid() END,
    _benefit, _take, 'reclaim', auth.uid(), _idem, '{}'::jsonb);
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.reclaimed', 'Credits reclaimed',
    _take || ' ' || _benefit::text || ' credits taken back', '/employer/credits',
    jsonb_build_object('from_user', _from_user, 'benefit', _benefit, 'qty', _take)
  );
  RETURN _take;
END $$;

-- Offboarding: move everything a member holds to their manager (if that manager can spend it) else the pool.
CREATE OR REPLACE FUNCTION public.sweep_member_credits(_company_id uuid, _user_id uuid, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record; _mgr uuid; _target uuid;
BEGIN
  SELECT reports_to INTO _mgr FROM public.employer_members WHERE company_id = _company_id AND user_id = _user_id;
  FOR _row IN SELECT benefit_type, balance FROM public.member_credit_allocations
               WHERE company_id = _company_id AND user_id = _user_id AND balance > 0 LOOP
    _target := NULL;
    IF _mgr IS NOT NULL AND public.has_company_membership(_mgr, _company_id)
       AND public.has_company_permission(_mgr, _company_id, public.benefit_spend_permission(_row.benefit_type)) THEN
      _target := _mgr;
    END IF;
    PERFORM public.move_member_credits(_company_id, _user_id, _target, _row.benefit_type, _row.balance, 'sweep', _actor, NULL,
      jsonb_build_object('reason', 'member_removed'));
  END LOOP;
END $$;

-- remove_member now sweeps credits (same body as the permission-based version + sweep).
CREATE OR REPLACE FUNCTION public.remove_member(_company_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.remove') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF public.is_company_owner(_user_id, _company_id) THEN
    IF NOT public.is_company_owner(auth.uid(), _company_id) THEN RAISE EXCEPTION 'cannot_escalate'; END IF;
    IF public.active_owner_count(_company_id) <= 1 THEN RAISE EXCEPTION 'last_super_admin'; END IF;
  END IF;
  -- Sweep BEFORE revoking so the manager lookup still sees the reporting line.
  PERFORM public.sweep_member_credits(_company_id, _user_id, auth.uid());
  UPDATE public.employer_members
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found or already revoked'; END IF;
  UPDATE public.employer_members
     SET reports_to = (SELECT reports_to FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id)
   WHERE company_id = _company_id AND reports_to = _user_id;
  UPDATE public.credit_requests SET status = 'cancelled', decided_at = now(), decision_note = 'member_removed'
   WHERE company_id = _company_id AND requester = _user_id AND status = 'pending';
  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.revoked', 'Team member access revoked',
    COALESCE(_name, 'A teammate') || '''s access was revoked', '/employer/team',
    jsonb_build_object('user_id', _user_id, 'revoked_by', auth.uid())
  );
END $$;

-- ── 5. Requests ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_member_credits(
  _company_id uuid, _benefit public.benefit_type, _qty int, _reason text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _mgr uuid;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  IF (SELECT credit_mode FROM public.companies WHERE id = _company_id) <> 'allocated' THEN
    RAISE EXCEPTION 'allocation_mode_off';
  END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 100000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF (SELECT count(*) FROM public.credit_requests
       WHERE company_id = _company_id AND requester = auth.uid() AND status = 'pending') >= 5 THEN
    RAISE EXCEPTION 'too_many_pending_requests';
  END IF;
  SELECT reports_to INTO _mgr FROM public.employer_members
   WHERE company_id = _company_id AND user_id = auth.uid() AND status = 'active';
  INSERT INTO public.credit_requests (company_id, requester, benefit_type, qty, reason, routed_to)
    VALUES (_company_id, auth.uid(), _benefit, _qty, left(COALESCE(_reason, ''), 500), _mgr)
    RETURNING id INTO _id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.requested', 'Credits requested',
    'Requested ' || _qty || ' ' || _benefit::text || ' credits', '/employer/credits',
    jsonb_build_object('request_id', _id, 'benefit', _benefit, 'qty', _qty)
  );
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_credit_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.credit_requests SET status = 'cancelled', decided_at = now()
   WHERE id = _request_id AND requester = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_pending'; END IF;
END $$;

-- Approver = the routed manager (paying from their own balance) or anyone with pool authority.
CREATE OR REPLACE FUNCTION public.decide_credit_request(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.credit_requests%ROWTYPE; _pool_auth boolean;
BEGIN
  SELECT * INTO _r FROM public.credit_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'request_not_pending'; END IF;
  IF NOT public.has_company_permission(auth.uid(), _r.company_id, 'credits.approve_requests') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  _pool_auth := public.has_company_permission(auth.uid(), _r.company_id, 'credits.allocate');
  IF NOT _pool_auth AND (_r.routed_to IS DISTINCT FROM auth.uid()
      OR NOT public.is_in_subtree(_r.company_id, auth.uid(), _r.requester)) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _approve THEN
    IF NOT public.has_company_membership(_r.requester, _r.company_id) THEN RAISE EXCEPTION 'target_not_member'; END IF;
    IF NOT public.has_company_permission(_r.requester, _r.company_id, public.benefit_spend_permission(_r.benefit_type)) THEN
      RAISE EXCEPTION 'target_cannot_spend';
    END IF;
    PERFORM public.move_member_credits(
      _r.company_id, CASE WHEN _pool_auth THEN NULL ELSE auth.uid() END, _r.requester, _r.benefit_type, _r.qty,
      CASE WHEN _pool_auth THEN 'allocate' ELSE 'delegate' END, auth.uid(), 'req:' || _r.id::text,
      jsonb_build_object('request_id', _r.id));
  END IF;

  UPDATE public.credit_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'denied' END,
         decided_by = auth.uid(), decided_at = now(), decision_note = left(_note, 500)
   WHERE id = _r.id;
  PERFORM public.log_employer_activity(
    _r.company_id, auth.uid(), CASE WHEN _approve THEN 'credits.request_approved' ELSE 'credits.request_denied' END,
    CASE WHEN _approve THEN 'Credit request approved' ELSE 'Credit request denied' END,
    _r.qty || ' ' || _r.benefit_type::text || ' credits', '/employer/credits',
    jsonb_build_object('request_id', _r.id, 'requester', _r.requester)
  );
END $$;

-- ── 6. Read model ───────────────────────────────────────────
-- Company-level summary: mode + per-benefit wallet / reserved / pool + the caller's own balances.
CREATE OR REPLACE FUNCTION public.credit_summary(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb := '{}'::jsonb; _b public.benefit_type; _alloc int; _mine int;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  FOREACH _b IN ARRAY ARRAY['job_post','contact','boost']::public.benefit_type[] LOOP
    SELECT COALESCE(sum(balance), 0)::int INTO _alloc FROM public.member_credit_allocations
     WHERE company_id = _company_id AND benefit_type = _b;
    SELECT COALESCE(balance, 0) INTO _mine FROM public.member_credit_allocations
     WHERE company_id = _company_id AND user_id = auth.uid() AND benefit_type = _b;
    _out := _out || jsonb_build_object(_b::text, jsonb_build_object(
      'wallet', public.wallet_balance(_company_id, _b),
      'reserved', _alloc,
      'pool', public.wallet_balance(_company_id, _b) - _alloc,
      'mine', COALESCE(_mine, 0)
    ));
  END LOOP;
  RETURN jsonb_build_object(
    'mode', (SELECT credit_mode FROM public.companies WHERE id = _company_id),
    'benefits', _out,
    'can_pool_spend', public.has_company_permission(auth.uid(), _company_id, 'credits.pool_spend')
  );
END $$;

-- Per-member balances + 30-day spend, limited to what the caller may see.
CREATE OR REPLACE FUNCTION public.credit_allocation_overview(_company_id uuid)
RETURNS TABLE (
  user_id uuid, full_name text, email text, role_name text, reports_to uuid,
  benefit_type public.benefit_type, balance int, spent_30d int
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _all boolean; _team boolean;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  _all  := public.has_company_permission(auth.uid(), _company_id, 'credits.view_all');
  _team := public.has_company_permission(auth.uid(), _company_id, 'credits.view_team');
  RETURN QUERY
  SELECT m.user_id, p.full_name, p.email, r.name, m.reports_to, b.b,
         COALESCE(a.balance, 0)::int,
         COALESCE((SELECT sum(l.qty) FROM public.member_credit_ledger l
                    WHERE l.company_id = _company_id AND l.event = 'spend' AND l.from_user = m.user_id
                      AND l.benefit_type = b.b AND l.created_at > now() - interval '30 days'), 0)::int
    FROM public.employer_members m
    JOIN public.company_roles r ON r.id = m.role_id
    LEFT JOIN public.profiles p ON p.id = m.user_id
    CROSS JOIN (SELECT unnest(ARRAY['job_post','contact','boost']::public.benefit_type[]) AS b) b
    LEFT JOIN public.member_credit_allocations a
           ON a.company_id = m.company_id AND a.user_id = m.user_id AND a.benefit_type = b.b
   WHERE m.company_id = _company_id AND m.status = 'active'
     AND (m.user_id = auth.uid()
          OR _all
          OR (_team AND public.is_in_subtree(_company_id, auth.uid(), m.user_id)))
   ORDER BY p.full_name NULLS LAST, b.b;
END $$;

-- ── 7. RLS + privileges ─────────────────────────────────────
ALTER TABLE public.member_credit_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allocations visible" ON public.member_credit_allocations;
CREATE POLICY "allocations visible" ON public.member_credit_allocations FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_company_permission(auth.uid(), company_id, 'credits.view_all')
    OR (public.has_company_permission(auth.uid(), company_id, 'credits.view_team')
        AND public.is_in_subtree(company_id, auth.uid(), user_id))
  );

DROP POLICY IF EXISTS "credit ledger visible" ON public.member_credit_ledger;
CREATE POLICY "credit ledger visible" ON public.member_credit_ledger FOR SELECT TO authenticated
  USING (
    from_user = auth.uid() OR to_user = auth.uid()
    OR public.has_company_permission(auth.uid(), company_id, 'credits.view_all')
    OR (public.has_company_permission(auth.uid(), company_id, 'credits.view_team')
        AND (public.is_in_subtree(company_id, auth.uid(), COALESCE(from_user, to_user))
             OR public.is_in_subtree(company_id, auth.uid(), COALESCE(to_user, from_user))))
  );

DROP POLICY IF EXISTS "credit requests visible" ON public.credit_requests;
CREATE POLICY "credit requests visible" ON public.credit_requests FOR SELECT TO authenticated
  USING (
    requester = auth.uid() OR routed_to = auth.uid()
    OR public.has_company_permission(auth.uid(), company_id, 'credits.view_all')
    OR public.has_company_permission(auth.uid(), company_id, 'credits.allocate')
  );

REVOKE ALL ON public.member_credit_allocations, public.member_credit_ledger, public.credit_requests FROM anon, authenticated;
GRANT SELECT ON public.member_credit_allocations, public.member_credit_ledger, public.credit_requests TO authenticated;
GRANT ALL ON public.member_credit_allocations, public.member_credit_ledger, public.credit_requests TO service_role;

REVOKE ALL ON FUNCTION public.move_member_credits(uuid, uuid, uuid, public.benefit_type, int, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_member_credits(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_balance(uuid, public.benefit_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pool_available(uuid, public.benefit_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_member_credits(uuid, uuid, uuid, public.benefit_type, int, text, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_member_credits(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_balance(uuid, public.benefit_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.pool_available(uuid, public.benefit_type) TO service_role;

DO $$
DECLARE _sig text;
BEGIN
  FOREACH _sig IN ARRAY ARRAY[
    'public.set_credit_mode(uuid, text)',
    'public.allocate_member_credits(uuid, uuid, public.benefit_type, int, text)',
    'public.delegate_member_credits(uuid, uuid, public.benefit_type, int, text)',
    'public.reclaim_member_credits(uuid, uuid, public.benefit_type, int, text)',
    'public.request_member_credits(uuid, public.benefit_type, int, text)',
    'public.cancel_credit_request(uuid)',
    'public.decide_credit_request(uuid, boolean, text)',
    'public.credit_summary(uuid)',
    'public.credit_allocation_overview(uuid)',
    'public.remove_member(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _sig);
  END LOOP;
END $$;

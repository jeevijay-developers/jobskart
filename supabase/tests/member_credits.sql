-- member_credits.sql -- tests for 20261015120000_reserved_member_credits.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql and the team_permissions migrations.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/member_credits.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK.

BEGIN;

CREATE FUNCTION public.__t_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
CREATE FUNCTION public.__t_reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE FUNCTION public.__t_fails(_sql text, _expect text, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(_expect IN SQLERRM) = 0 THEN
      RAISE EXCEPTION '% -- expected "%" but got "%"', _label, _expect, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '% -- expected failure "%" but statement succeeded', _label, _expect;
END $$;
CREATE FUNCTION public.__t_alloc(_uid uuid, _b public.benefit_type DEFAULT 'contact') RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT balance FROM public.member_credit_allocations
    WHERE company_id = '00000000-0000-4000-8000-00000000d001' AND user_id = _uid AND benefit_type = _b), 0)
$$;
CREATE FUNCTION public.__t_req(_requester uuid, _status text DEFAULT 'pending', _qty int DEFAULT NULL) RETURNS uuid
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.credit_requests WHERE requester = _requester AND status = _status AND (_qty IS NULL OR qty = _qty)
  ORDER BY created_at LIMIT 1
$$;
CREATE FUNCTION public.__t_wallet(_b public.benefit_type DEFAULT 'contact') RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.wallet_balance('00000000-0000-4000-8000-00000000d001', _b) $$;
CREATE FUNCTION public.__t_pool(_b public.benefit_type DEFAULT 'contact') RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.pool_available('00000000-0000-4000-8000-00000000d001', _b) $$;
CREATE FUNCTION public.__t_invariant() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE _b public.benefit_type;
BEGIN
  FOREACH _b IN ARRAY ARRAY['job_post','contact','boost']::public.benefit_type[] LOOP
    IF public.pool_available('00000000-0000-4000-8000-00000000d001', _b) < 0 THEN
      RAISE EXCEPTION 'invariant broken: wallet < sum(allocations) for %', _b;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.set_credit_mode_for_test(_co uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.companies SET credit_mode = 'allocated' WHERE id = _co
$$;

-- team: owner e001 ; manager c001 ; c002 (recruiter, reports to c001) ; c003 (recruiter, reports to c001) ; v: c004 viewer
DO $t$
DECLARE
  _co constant uuid := '00000000-0000-4000-8000-00000000d001';
  _mgr uuid; _rec uuid; _view uuid;
BEGIN
  SELECT id INTO _mgr  FROM public.company_roles WHERE company_id IS NULL AND key = 'manager';
  SELECT id INTO _rec  FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter';
  SELECT id INTO _view FROM public.company_roles WHERE company_id IS NULL AND key = 'viewer';
  INSERT INTO public.employer_members (user_id, company_id, role, role_id) VALUES
    ('00000000-0000-4000-8000-00000000c001', _co, 'recruiter', _mgr),
    ('00000000-0000-4000-8000-00000000c002', _co, 'recruiter', _rec),
    ('00000000-0000-4000-8000-00000000c003', _co, 'recruiter', _rec),
    ('00000000-0000-4000-8000-00000000c004', _co, 'recruiter', _view);
  UPDATE public.employer_members SET reports_to = '00000000-0000-4000-8000-00000000c001'
   WHERE company_id = _co AND user_id IN ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000c004');
  UPDATE public.employer_members SET reports_to = '00000000-0000-4000-8000-00000000e001'
   WHERE company_id = _co AND user_id = '00000000-0000-4000-8000-00000000c001';
  -- fund the wallet: 100 contact, 50 job_post
  INSERT INTO public.employer_credit_wallets (company_id) VALUES (_co) ON CONFLICT DO NOTHING;
  UPDATE public.employer_credit_wallets SET contact_balance = 0, job_post_balance = 0, boost_balance = 0 WHERE company_id = _co;
  PERFORM public.apply_credit_delta(_co, 100, 'grant', '{}'::jsonb, NULL, 'contact');
  PERFORM public.apply_credit_delta(_co, 50,  'grant', '{}'::jsonb, NULL, 'job_post');
  ASSERT public.__t_wallet() = 100, 'setup: wallet funded';
END $t$;

-- a. pooled mode (default) keeps legacy behaviour; permissions still enforced on spend
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  ASSERT (SELECT credit_mode FROM public.companies WHERE id = _co) = 'pooled', 'a1: default mode is pooled';
  PERFORM public.apply_credit_delta(_co, -2, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c002', 'contact');
  ASSERT public.__t_wallet() = 98, 'a2: recruiter spends from the shared pool in pooled mode';
  PERFORM public.__t_fails(
    $q$SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -1, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c004', 'contact')$q$,
    'insufficient_permissions', 'a3: viewer cannot spend even in pooled mode');
  PERFORM public.__t_fails(
    $q$SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -1, 'boost', '{}'::jsonb, '00000000-0000-4000-8000-00000000c004', 'boost')$q$,
    'insufficient_permissions', 'a4: viewer cannot boost');
  ASSERT public.__t_wallet() = 98, 'a5: failed spends are not charged';
  -- callers map this exact message to no_credits; the wallet CHECK constraint must never pre-empt it
  PERFORM public.__t_fails(
    $q$SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -1000, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c002', 'contact')$q$,
    'Insufficient credits', 'a6: overdraw raises the legacy Insufficient credits message');
END $t$;

-- b. only pool authority switches modes
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails($q$SELECT public.set_credit_mode('00000000-0000-4000-8000-00000000d001', 'allocated')$q$,
  'insufficient_permissions', 'b1: recruiter cannot switch credit mode');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.set_credit_mode('00000000-0000-4000-8000-00000000d001', 'allocated');
SELECT public.__t_reset();

-- c. allocated mode: no allocation => blocked; owner holds pool_spend
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  PERFORM public.__t_fails(
    $q$SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -1, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c002', 'contact')$q$,
    'member_balance_insufficient', 'c1: recruiter with no allocation is blocked');
  PERFORM public.apply_credit_delta(_co, -3, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000e001', 'contact');
  ASSERT public.__t_wallet() = 95 AND public.__t_pool() = 95, 'c2: owner spends the pool directly';
END $t$;

-- d. allocation + spend
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'contact', 10, 'k1');
SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'contact', 10, 'k1');  -- idempotent replay
SELECT public.__t_fails($q$SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002', 'contact', 1000, 'k2')$q$,
  'pool_insufficient', 'd1: cannot allocate more than the pool');
SELECT public.__t_fails($q$SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c004', 'contact', 1, 'k3')$q$,
  'target_cannot_spend', 'd2: cannot allocate to a role that cannot spend this benefit');
SELECT public.__t_fails($q$SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002', 'contact', 1, 'k4')$q$,
  'target_not_member', 'd3: cannot allocate to a non-member');
SELECT public.__t_reset();
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 10, 'd4: replayed allocation applied once';
  ASSERT public.__t_pool() = 85 AND public.__t_wallet() = 95, 'd5: reservation lowers the pool, not the wallet';
  PERFORM public.apply_credit_delta(_co, -3, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c001', 'contact');
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 7 AND public.__t_wallet() = 92 AND public.__t_pool() = 85,
    'd6: member spend debits wallet AND allocation';
  PERFORM public.__t_fails(
    $q$SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -8, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000c001', 'contact')$q$,
    'member_balance_insufficient', 'd7: cannot spend more than the allocation');
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 7 AND public.__t_wallet() = 92, 'd8: failed spend leaves everything untouched';
  PERFORM public.__t_invariant();
END $t$;

-- e. delegation inside the subtree
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002', 'contact', 4, 'dk1');
SELECT public.__t_fails($q$SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'contact', 4, 'dk2')$q$,
  'holder_insufficient', 'e1: cannot delegate more than you hold');
SELECT public.__t_fails($q$SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'contact', 1, 'dk3')$q$,
  'target_not_in_subtree', 'e2: cannot delegate to self');
SELECT public.__t_fails($q$SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', 'contact', 1, 'dk4')$q$,
  'target_not_in_subtree', 'e3: cannot delegate upward');
SELECT public.__t_fails($q$SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c004', 'contact', 1, 'dk5')$q$,
  'target_cannot_spend', 'e4: cannot delegate to a viewer');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails($q$SELECT public.delegate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'contact', 1, 'dk6')$q$,
  'insufficient_permissions', 'e5: recruiter cannot delegate');
SELECT public.__t_fails($q$SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002', 'contact', 1, 'dk7')$q$,
  'insufficient_permissions', 'e6: recruiter cannot allocate from the pool');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 3 AND public.__t_alloc('00000000-0000-4000-8000-00000000c002') = 4, 'e7: delegation moved 4';
  ASSERT public.__t_wallet() = 92 AND public.__t_pool() = 85, 'e8: delegation does not touch wallet or pool';
  PERFORM public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -4, 'invite', '{}'::jsonb, '00000000-0000-4000-8000-00000000c002', 'contact');
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c002') = 0, 'e9: invite spend uses the contact allocation';
  PERFORM public.__t_invariant();
END $t$;

-- f. reclaim: manager takes back from subtree into own balance; pool authority returns to pool
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'contact', 6, 'fk1');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
SELECT public.__t_fails($q$SELECT public.reclaim_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'contact', 99, 'fk2')$q$,
  'reclaim_exceeds_balance', 'f1: cannot reclaim more than held');
SELECT public.__t_fails($q$SELECT public.reclaim_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', 'contact', 1, 'fk3')$q$,
  'target_not_in_subtree', 'f2: manager cannot reclaim from outside the subtree');
SELECT public.reclaim_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'contact', 2, 'fk4');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c003') = 4 AND public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 5,
    'f3: manager reclaim lands in the manager balance';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.reclaim_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'contact', NULL, 'fk5');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 0, 'f4: owner reclaim-all empties the member';
  ASSERT public.__t_pool() = 85 - 6 + 5, 'f5: owner reclaim returns credits to the pool (pool=' || public.__t_pool() || ')';
  PERFORM public.__t_invariant();
END $t$;

-- g. refund goes back to the spender's allocation; admin clawback trims allocations
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _c3 constant uuid := '00000000-0000-4000-8000-00000000c003';
        _before int; _w int;
BEGIN
  _before := public.__t_alloc(_c3);  -- 4
  PERFORM public.apply_credit_delta(_co, -1, 'unlock', '{}'::jsonb, _c3, 'contact');
  PERFORM public.apply_credit_delta(_co, 1, 'refund', '{}'::jsonb, _c3, 'contact');
  ASSERT public.__t_alloc(_c3) = _before, 'g1: refund restores the spender allocation';
  -- platform clawback bigger than the pool must trim reservations, not break the invariant
  _w := public.__t_wallet();
  PERFORM public.apply_credit_delta(_co, -(public.__t_pool() + 2), 'adjustment', '{}'::jsonb, NULL, 'contact');
  PERFORM public.__t_invariant();
  ASSERT public.__t_pool() = 0, 'g2: pool exhausted';
  ASSERT public.__t_alloc(_c3) = _before - 2, 'g3: reservation trimmed by the deficit';
  ASSERT EXISTS (SELECT 1 FROM public.member_credit_ledger WHERE company_id = _co AND event = 'trim'), 'g4: trim recorded';
  -- top the wallet back up for the rest of the suite
  PERFORM public.apply_credit_delta(_co, 50, 'grant', '{}'::jsonb, NULL, 'contact');
END $t$;

-- h. requests
DO $t$ BEGIN
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000c003');
  PERFORM public.request_member_credits('00000000-0000-4000-8000-00000000d001', 'contact', 5, 'need more');
  PERFORM public.__t_reset();
  ASSERT (SELECT routed_to FROM public.credit_requests WHERE requester = '00000000-0000-4000-8000-00000000c003') = '00000000-0000-4000-8000-00000000c001',
    'h1: request routes to the reporting manager';
END $t$;
-- the manager holds 0 -> approval from own balance fails with holder_insufficient
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
SELECT public.__t_fails($q$SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003'), true, 'ok')$q$,
  'holder_insufficient', 'h2: manager without balance cannot approve from own pocket');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails($q$SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003'), true, 'ok')$q$,
  'insufficient_permissions', 'h3: a recruiter cannot decide requests');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003'), true, 'ok');
SELECT public.__t_fails($q$SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003', 'approved'), true, 'again')$q$,
  'request_not_pending', 'h4: a request is decided once');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c003') = 2 + 5, 'h5: owner approval allocates from the pool (c003=' || public.__t_alloc('00000000-0000-4000-8000-00000000c003') || ')';
END $t$;
-- manager with balance can approve from own balance and deny works
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.allocate_member_credits('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'contact', 10, 'hk1');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c003');
SELECT public.request_member_credits('00000000-0000-4000-8000-00000000d001', 'contact', 3, 'again');
SELECT public.request_member_credits('00000000-0000-4000-8000-00000000d001', 'contact', 9, 'too much');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003', 'pending', 3), true, 'ok');
SELECT public.decide_credit_request(public.__t_req('00000000-0000-4000-8000-00000000c003', 'pending', 9), false, 'no');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 7 AND public.__t_alloc('00000000-0000-4000-8000-00000000c003') = 10, 'h6: manager approval is a delegation from their own balance';
  ASSERT (SELECT status FROM public.credit_requests WHERE requester='00000000-0000-4000-8000-00000000c003' AND qty=9) = 'denied', 'h7: denied';
  PERFORM public.__t_invariant();
END $t$;

-- i. visibility
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
DO $t$ BEGIN
  ASSERT (SELECT count(*) FROM public.member_credit_allocations WHERE user_id <> auth.uid()) = 0, 'i1: recruiter sees only own allocation rows';
  ASSERT (SELECT count(DISTINCT user_id) FROM public.credit_allocation_overview('00000000-0000-4000-8000-00000000d001')) = 1, 'i2: overview limited to self for a recruiter';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
DO $t$ BEGIN
  ASSERT (SELECT count(DISTINCT user_id) FROM public.credit_allocation_overview('00000000-0000-4000-8000-00000000d001')) = 4,
    'i3: manager sees self + three reports (c002, c003, c004)';
  ASSERT (SELECT count(*) FROM public.member_credit_allocations WHERE user_id = '00000000-0000-4000-8000-00000000e001') = 0, 'i4: manager does not see the owner row';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');
DO $t$ BEGIN
  ASSERT (SELECT count(*) FROM public.member_credit_allocations) = 0, 'i5: other companies see nothing';
  ASSERT (SELECT count(*) FROM public.member_credit_ledger) = 0, 'i6: other companies see no ledger';
END $t$;
SELECT public.__t_fails($q$SELECT public.credit_summary('00000000-0000-4000-8000-00000000d001')$q$, 'insufficient_permissions', 'i7: summary requires membership');
SELECT public.__t_fails($q$INSERT INTO public.member_credit_allocations (company_id, user_id, benefit_type, balance) VALUES ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000e002', 'contact', 999)$q$,
  'permission denied', 'i8: allocations are not client-writable');
SELECT public.__t_reset();

-- j. offboarding sweeps credits to the manager
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.remove_member('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c003') = 0 AND public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 17,
    'j1: removed member balance moved to the manager (c001=' || public.__t_alloc('00000000-0000-4000-8000-00000000c001') || ')';
  PERFORM public.__t_invariant();
END $t$;
-- manager removed -> balance goes to the pool when the manager cannot be the target
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.remove_member('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c001') = 0, 'j2: removed manager holds nothing';
  PERFORM public.__t_invariant();
END $t$;

-- j2. real spend RPC end to end: apply_boost as an authenticated recruiter in allocated mode
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _job uuid; _res jsonb; _boost_before int;
BEGIN
  PERFORM public.set_credit_mode_for_test(_co);
  SELECT j.id INTO _job FROM public.jobs j
   WHERE j.company_id = _co AND j.status = 'active' AND j.created_at < date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
     AND NOT EXISTS (SELECT 1 FROM public.job_boosts b WHERE b.job_id = j.id AND b.ends_at > now())
   ORDER BY j.id LIMIT 1;
  IF _job IS NULL THEN RAISE NOTICE 'j2 skipped: no boostable fixture job'; RETURN; END IF;
  UPDATE public.employer_credit_wallets SET boost_balance = 5 WHERE company_id = _co;
  UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter')
   WHERE company_id = _co AND user_id = '00000000-0000-4000-8000-00000000c002';
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000c002');
  BEGIN
    PERFORM public.apply_boost(_job, 1);
    RAISE EXCEPTION 'j2a: boost without an allocation must fail';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%member_balance_insufficient%' AND SQLERRM NOT LIKE '%no_credits%' AND SQLERRM NOT LIKE '%boost_%' THEN
      RAISE EXCEPTION 'j2a: unexpected error %', SQLERRM;
    END IF;
  END;
  PERFORM public.__t_reset();
  ASSERT public.wallet_balance(_co, 'boost') = 5, 'j2b: failed boost charged nothing';
  PERFORM public.move_member_credits(_co, NULL, '00000000-0000-4000-8000-00000000c002', 'boost', 2, 'allocate', NULL, 'j2-alloc', '{}'::jsonb);
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000c002');
  _res := public.apply_boost(_job, 1);
  PERFORM public.__t_reset();
  ASSERT public.wallet_balance(_co, 'boost') < 5, 'j2c: boost debited the wallet';
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000c002', 'boost') < 2, 'j2d: boost debited the member allocation';
  PERFORM public.__t_invariant();
END $t$;

-- k. leaving allocated mode releases every reservation
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.set_credit_mode('00000000-0000-4000-8000-00000000d001', 'pooled');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT (SELECT COALESCE(sum(balance), 0) FROM public.member_credit_allocations WHERE company_id = '00000000-0000-4000-8000-00000000d001') = 0,
    'k1: all reservations released';
  ASSERT public.__t_pool() = public.__t_wallet(), 'k2: whole wallet is pool again';
  ASSERT EXISTS (SELECT 1 FROM public.member_credit_ledger WHERE event = 'release'), 'k3: release audited';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails($q$SELECT public.request_member_credits('00000000-0000-4000-8000-00000000d001', 'contact', 1, 'x')$q$,
  'allocation_mode_off', 'k4: requests are meaningless in pooled mode');
SELECT public.__t_reset();

ROLLBACK;
\echo member_credits.sql: ALL PASSED

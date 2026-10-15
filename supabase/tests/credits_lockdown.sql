-- credits_lockdown.sql -- tests for 20261015130000_credits_lockdown.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/credits_lockdown.sql
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
CREATE FUNCTION public.__t_count(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _n bigint; BEGIN EXECUTE _sql INTO _n; RETURN _n; END $$;

-- team in company d001: owner e001, finance e002, hr_admin c001, recruiter c002, manager c003
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  INSERT INTO public.employer_members (user_id, company_id, role, role_id) VALUES
    ('00000000-0000-4000-8000-00000000e002', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='finance')),
    ('00000000-0000-4000-8000-00000000c001', _co, 'hr_admin',  (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='hr_admin')),
    ('00000000-0000-4000-8000-00000000c002', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter')),
    ('00000000-0000-4000-8000-00000000c003', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='manager'));
  INSERT INTO public.employer_credit_wallets (company_id) VALUES (_co) ON CONFLICT DO NOTHING;
  UPDATE public.employer_credit_wallets SET contact_balance = 40, job_post_balance = 7, boost_balance = 3 WHERE company_id = _co;
  INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, benefit_type)
    VALUES (_co, 'grant', 40, 40, 'contact');
END $t$;

-- a. the exploit: a member rewriting their own wallet through the API
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails($q$UPDATE public.employer_credit_wallets SET contact_balance = 999999 WHERE company_id = '00000000-0000-4000-8000-00000000d001'$q$,
  'permission denied', 'a1: recruiter cannot UPDATE the wallet');
SELECT public.__t_fails($q$INSERT INTO public.employer_credit_wallets (company_id, contact_balance) VALUES ('00000000-0000-4000-8000-00000000d002', 999999)$q$,
  'permission denied', 'a2: recruiter cannot INSERT a wallet');
SELECT public.__t_fails($q$DELETE FROM public.employer_credit_wallets WHERE company_id = '00000000-0000-4000-8000-00000000d001'$q$,
  'permission denied', 'a3: recruiter cannot DELETE the wallet');
SELECT public.__t_fails($q$INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, benefit_type) VALUES ('00000000-0000-4000-8000-00000000d001', 'grant', 100, 100, 'contact')$q$,
  'permission denied', 'a4: cannot forge ledger rows');
SELECT public.__t_fails($q$UPDATE public.company_plans SET status = 'active'$q$, 'permission denied', 'a5: cannot touch plans');
SELECT public.__t_fails($q$UPDATE public.razorpay_orders SET status = 'paid'$q$, 'permission denied', 'a6: cannot mark orders paid');
SELECT public.__t_fails($q$INSERT INTO public.candidate_unlocks (company_id, candidate_user_id) VALUES ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c010')$q$,
  'permission denied', 'a7: cannot grant yourself unlocks');
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT (SELECT contact_balance FROM public.employer_credit_wallets WHERE company_id = '00000000-0000-4000-8000-00000000d001') = 40, 'a8: wallet untouched';
END $t$;

-- b. read access follows permissions
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');  -- recruiter
DO $t$ BEGIN
  ASSERT public.__t_count('select count(*) from public.employer_credit_wallets') = 0, 'b1: recruiter sees no wallet row';
  ASSERT public.__t_count('select count(*) from public.credit_transactions') = 0, 'b2: recruiter sees no transactions';
  ASSERT public.__t_count('select count(*) from public.razorpay_orders') = 0, 'b3: recruiter sees no orders';
  ASSERT public.__t_count('select count(*) from public.invoices') = 0, 'b4: recruiter sees no invoices';
END $t$;
SELECT public.__t_fails($q$SELECT * FROM public.company_benefit_balances('00000000-0000-4000-8000-00000000d001')$q$,
  'insufficient_permissions', 'b5: recruiter cannot read grant balances');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');  -- finance
DO $t$ BEGIN
  ASSERT public.__t_count('select count(*) from public.employer_credit_wallets') = 1, 'b6: finance sees the wallet';
  ASSERT public.__t_count('select count(*) from public.credit_transactions') = 1, 'b7: finance sees transactions';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');  -- hr_admin: billing.view + credits.view_all, no purchase
DO $t$ BEGIN
  ASSERT public.__t_count('select count(*) from public.employer_credit_wallets') = 1, 'b8: hr_admin can view billing';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');  -- another company's recruiter
DO $t$ BEGIN
  ASSERT public.__t_count('select count(*) from public.employer_credit_wallets') = 0, 'b9: other companies see nothing';
END $t$;
SELECT public.__t_reset();

-- c. credit_summary: spenders see the shared balance in pooled mode, only their own in allocated mode
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
DO $t$
DECLARE _s jsonb; _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  _s := public.credit_summary(_co);
  ASSERT (_s -> 'benefits' -> 'contact' ->> 'wallet')::int = 40, 'c1: recruiter sees the shared balance in pooled mode';
  ASSERT (_s -> 'benefits' -> 'contact' -> 'reserved') = 'null'::jsonb, 'c2: but not the reservation breakdown';
  ASSERT (_s ->> 'can_view_all')::boolean = false, 'c3: not a credit viewer';
END $t$;
SELECT public.__t_reset();
UPDATE public.companies SET credit_mode = 'allocated' WHERE id = '00000000-0000-4000-8000-00000000d001';
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
DO $t$
DECLARE _s jsonb; _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  _s := public.credit_summary(_co);
  ASSERT (_s -> 'benefits' -> 'contact' -> 'wallet') = 'null'::jsonb, 'c4: company wallet hidden from a recruiter in allocated mode';
  ASSERT (_s -> 'benefits' -> 'contact' -> 'pool') = 'null'::jsonb, 'c5: pool hidden too';
  ASSERT (_s -> 'benefits' -> 'contact' ->> 'mine')::int = 0, 'c6: own balance still visible';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');
DO $t$
DECLARE _s jsonb; _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  _s := public.credit_summary(_co);
  ASSERT (_s -> 'benefits' -> 'contact' ->> 'pool')::int = 40, 'c7: finance sees the pool';
  ASSERT (_s ->> 'can_view_all')::boolean, 'c8: finance is a credit viewer';
END $t$;
SELECT public.__t_reset();

-- d. purchases and fulfilment follow permissions
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _pack uuid; _order jsonb; _rzp constant text := 'order_lockdown_test';
BEGIN
  SELECT id INTO _pack FROM public.credit_packs WHERE active LIMIT 1;
  IF _pack IS NULL THEN RAISE EXCEPTION 'd: no active credit pack in the local seed'; END IF;
  PERFORM public.__t_fails(format($q$SELECT public.create_credit_pack_order(%L, %L, '00000000-0000-4000-8000-00000000c001')$q$, _co, _pack),
    'insufficient_permissions', 'd1: hr_admin cannot buy credits');
  PERFORM public.__t_fails(format($q$SELECT public.create_credit_pack_order(%L, %L, '00000000-0000-4000-8000-00000000c002')$q$, _co, _pack),
    'insufficient_permissions', 'd2: recruiter cannot buy credits');
  _order := public.create_credit_pack_order(_co, _pack, '00000000-0000-4000-8000-00000000e002');
  ASSERT _order ->> 'order_id' IS NOT NULL, 'd3: finance can buy credits';
  UPDATE public.razorpay_orders SET razorpay_order_id = _rzp WHERE id = (_order ->> 'order_id')::uuid;
  PERFORM public.__t_fails(format($q$SELECT public.fulfill_razorpay_order(%L, 'pay_x', NULL, 'client', '00000000-0000-4000-8000-00000000c002')$q$, _rzp),
    'insufficient_permissions', 'd4: a recruiter cannot fulfil someone else''s order as the client');
END $t$;

ROLLBACK;
\echo credits_lockdown.sql: ALL PASSED

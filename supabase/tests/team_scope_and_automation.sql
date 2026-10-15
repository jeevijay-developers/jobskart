-- team_scope_and_automation.sql -- tests for 20261015150000_team_scope_alerts_topups_seats.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/team_scope_and_automation.sql
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
CREATE FUNCTION public.__t_rows(_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _n bigint; BEGIN EXECUTE _sql; GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n; END $$;
CREATE FUNCTION public.__t_alloc(_uid uuid, _b public.benefit_type DEFAULT 'contact') RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT balance FROM public.member_credit_allocations
    WHERE company_id = '00000000-0000-4000-8000-00000000d001' AND user_id = _uid AND benefit_type = _b), 0)
$$;

-- Team in d001:  owner e001 | manager e002 | recruiter A e003 | recruiter B a001 (reports to e002) | viewer c013 | hr_admin c014
-- Jobs: fixture jobs by e001 (10 applications) + jobE3 (posted by e003, applicant c012) + jobA1 (posted by a001, applicant c004)
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001';
BEGIN
  INSERT INTO public.employer_members (user_id, company_id, role, role_id) VALUES
    ('00000000-0000-4000-8000-00000000e002', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='manager')),
    ('00000000-0000-4000-8000-00000000e003', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter')),
    ('00000000-0000-4000-8000-00000000a001', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter')),
    ('00000000-0000-4000-8000-00000000c013', _co, 'recruiter', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='viewer')),
    ('00000000-0000-4000-8000-00000000c014', _co, 'hr_admin',  (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='hr_admin'));
  UPDATE public.employer_members SET reports_to = '00000000-0000-4000-8000-00000000e001'
   WHERE company_id = _co AND user_id = '00000000-0000-4000-8000-00000000e002';
  UPDATE public.employer_members SET reports_to = '00000000-0000-4000-8000-00000000e002'
   WHERE company_id = _co AND user_id = '00000000-0000-4000-8000-00000000a001';

  INSERT INTO public.jobs (id, company_id, posted_by, title, status) VALUES
    ('00000000-0000-4000-8000-0000000e3e30', _co, '00000000-0000-4000-8000-00000000e003', 'Job by recruiter A', 'active'),
    ('00000000-0000-4000-8000-0000000a1a10', _co, '00000000-0000-4000-8000-00000000a001', 'Job by recruiter B', 'active');
  INSERT INTO public.applications (job_id, candidate_id, company_id) VALUES
    ('00000000-0000-4000-8000-0000000e3e30', '00000000-0000-4000-8000-00000000c012', _co),
    ('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000c004', _co);
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 12, 'setup: 12 applications';
END $t$;

-- ---------------------------------------------------------------- a. OPEN mode == today
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');  -- recruiter A
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 12,
    'a1: open mode: recruiter sees every company application';
  ASSERT public.__t_count($q$select count(*) from public.candidate_profiles where user_id = '00000000-0000-4000-8000-00000000c004'$q$) = 1,
    'a2: open mode: sees the profile of an applicant to a colleague''s job';
  ASSERT public.__t_rows($q$update public.applications set employer_notes = 'ok' where job_id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 1,
    'a3: open mode: can work any applicant';
  ASSERT public.__t_rows($q$update public.jobs set title = 'hijack' where id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 0,
    'a4: but a recruiter still cannot edit a colleague''s job (legacy rule)';
  ASSERT public.__t_rows($q$update public.jobs set title = 'mine' where id = '00000000-0000-4000-8000-0000000e3e30'$q$) = 1,
    'a5: own job is editable';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c013');  -- viewer: reads, cannot act
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 12, 'a6: viewer reads applicants';
  ASSERT public.__t_rows($q$update public.applications set employer_notes = 'x' where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 0,
    'a7: viewer cannot change applicants';
  ASSERT public.__t_rows($q$update public.jobs set title = 'x' where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 0,
    'a8: viewer cannot edit jobs';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');  -- finance-like check: a role without applicants.view
SELECT public.__t_reset();
UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'finance')
 WHERE company_id = '00000000-0000-4000-8000-00000000d001' AND user_id = '00000000-0000-4000-8000-00000000c013';
SELECT public.__t_as('00000000-0000-4000-8000-00000000c013');
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 0,
    'a9: a Finance member (no applicants.view) sees no applicants';
END $t$;
SELECT public.__t_reset();
UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'viewer')
 WHERE company_id = '00000000-0000-4000-8000-00000000d001' AND user_id = '00000000-0000-4000-8000-00000000c013';

-- ---------------------------------------------------------------- b. access mode switch
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
SELECT public.__t_fails($q$SELECT public.set_access_mode('00000000-0000-4000-8000-00000000d001', 'scoped')$q$,
  'insufficient_permissions', 'b1: recruiter cannot change the access mode');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.set_access_mode('00000000-0000-4000-8000-00000000d001', 'scoped');
SELECT public.__t_fails($q$SELECT public.set_access_mode('00000000-0000-4000-8000-00000000d001', 'bogus')$q$, 'invalid_mode', 'b2: invalid mode');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
DO $t$ BEGIN
  ASSERT (public.company_team_settings('00000000-0000-4000-8000-00000000d001') ->> 'access_mode') = 'scoped', 'b3: any member can read the team settings';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c012');
SELECT public.__t_fails($q$SELECT public.company_team_settings('00000000-0000-4000-8000-00000000d001')$q$,
  'insufficient_permissions', 'b4: outsiders cannot read another company''s settings');
SELECT public.__t_reset();

-- ---------------------------------------------------------------- c. SCOPED mode
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');  -- recruiter A: own scope
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 1,
    'c1: scoped: recruiter A sees only the applicant of their own job';
  ASSERT public.__t_count($q$select count(*) from public.candidate_profiles where user_id = '00000000-0000-4000-8000-00000000c004'$q$) = 0,
    'c2: scoped: the profile of a hidden applicant is hidden too (RLS cascades through applications)';
  ASSERT public.__t_count($q$select count(*) from public.candidate_profiles where user_id = '00000000-0000-4000-8000-00000000c012'$q$) = 1,
    'c3: scoped: own applicant profile still visible';
  ASSERT public.__t_rows($q$update public.applications set employer_notes = 'no' where job_id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 0,
    'c4: scoped: cannot act on a colleague''s applicants';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');  -- manager: team scope (a001 reports to e002)
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 1,
    'c5: scoped: manager sees their report''s job applicants but not recruiter A''s or the owner''s (' ||
    public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) || ')';
  ASSERT public.__t_rows($q$update public.jobs set title = 'team edit' where id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 1,
    'c6: scoped: manager can manage a report''s job';
  ASSERT public.__t_rows($q$update public.jobs set title = 'no' where id = '00000000-0000-4000-8000-0000000e3e30'$q$) = 0,
    'c7: scoped: but not an unrelated colleague''s job';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c014');  -- hr_admin: all
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 12, 'c8: scoped: hr_admin (all scope) sees everything';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');  -- owner: all
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 12, 'c9: scoped: owner sees everything';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
SELECT public.__t_fails($q$SELECT public.share_job('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000e003', 'viewer')$q$,
  'insufficient_permissions', 'c10: cannot share a job you cannot manage');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.share_job('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000e003', 'viewer');
SELECT public.__t_fails($q$SELECT public.share_job('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000c005', 'viewer')$q$,
  'target_not_member', 'c11: can only share with members');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 2,
    'c12: a shared job (viewer) becomes visible';
  ASSERT public.__t_rows($q$update public.applications set employer_notes = 'no' where job_id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 0,
    'c13: but a viewer share is read-only';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.share_job('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000e003', 'editor');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
DO $t$ BEGIN
  ASSERT public.__t_rows($q$update public.applications set employer_notes = 'yes' where job_id = '00000000-0000-4000-8000-0000000a1a10'$q$) = 1,
    'c14: an editor share lets them work the applicants';
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.unshare_job('00000000-0000-4000-8000-0000000a1a10', '00000000-0000-4000-8000-00000000e003');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications where company_id = '00000000-0000-4000-8000-00000000d001'$q$) = 1, 'c15: unshare removes access';
END $t$;
-- candidates are never affected by employer scope
SELECT public.__t_as('00000000-0000-4000-8000-00000000c012');
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.applications$q$) = 1, 'c16: a candidate still sees their own application';
END $t$;
SELECT public.__t_reset();

-- ---------------------------------------------------------------- d. reassign leaver's jobs
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
SELECT public.__t_fails($q$SELECT public.reassign_member_jobs('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e002')$q$,
  'insufficient_permissions', 'd1: recruiter cannot reassign jobs');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.__t_fails($q$SELECT public.reassign_member_jobs('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000c013')$q$,
  'target_cannot_own_jobs', 'd2: cannot reassign to someone who cannot post jobs');
DO $t$ BEGIN
  ASSERT public.reassign_member_jobs('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000e002') = 1,
    'd3: one job reassigned';
END $t$;
SELECT public.__t_reset();
DO $t$ BEGIN
  ASSERT (SELECT posted_by FROM public.jobs WHERE id = '00000000-0000-4000-8000-0000000e3e30') = '00000000-0000-4000-8000-00000000e002', 'd4: ownership moved';
END $t$;

-- ---------------------------------------------------------------- e. low-balance alerts + top-ups + export
UPDATE public.companies SET credit_mode = 'allocated', low_credit_threshold = 3 WHERE id = '00000000-0000-4000-8000-00000000d001';
INSERT INTO public.employer_credit_wallets (company_id) VALUES ('00000000-0000-4000-8000-00000000d001') ON CONFLICT DO NOTHING;
UPDATE public.employer_credit_wallets SET contact_balance = 0, job_post_balance = 0, boost_balance = 0 WHERE company_id = '00000000-0000-4000-8000-00000000d001';
SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', 30, 'grant', '{}'::jsonb, NULL, 'contact');
SELECT public.move_member_credits('00000000-0000-4000-8000-00000000d001', NULL, '00000000-0000-4000-8000-00000000a001', 'contact', 5, 'allocate', NULL, 'e-alloc', '{}'::jsonb);
SELECT public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -3, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000a001', 'contact');
DO $t$ BEGIN
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000a001') = 2, 'e1: balance 2 after spending 3';
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-00000000a001' AND type = 'credits.low.contact') = 1,
    'e2: member alerted on crossing the threshold';
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-00000000e002' AND type = 'credits.low.contact') = 1,
    'e3: their manager alerted too';
  PERFORM public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -1, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000a001', 'contact');
  ASSERT (SELECT count(*) FROM public.notifications WHERE user_id = '00000000-0000-4000-8000-00000000a001' AND type = 'credits.low.contact') = 1,
    'e4: no repeat alert while already below the threshold';
END $t$;

-- top-up rules
SELECT public.__t_as('00000000-0000-4000-8000-00000000a001');
SELECT public.__t_fails($q$SELECT public.set_topup_rule('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a001', 'contact', 10, 'weekly')$q$,
  'insufficient_permissions', 'e5: recruiter cannot create top-up rules');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.set_topup_rule('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000a001', 'contact', 10, 'weekly');
SELECT public.__t_fails($q$SELECT public.set_topup_rule('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c013', 'contact', 10, 'weekly')$q$,
  'target_cannot_spend', 'e6: cannot top up someone who cannot spend');
SELECT public.__t_reset();
DO $t$
DECLARE _next timestamptz;
BEGIN
  ASSERT public.run_credit_topups() = 1, 'e7: one rule ran';
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000a001') = 10, 'e8: topped up to the target';
  SELECT next_run_at INTO _next FROM public.credit_topup_rules LIMIT 1;
  ASSERT _next > now() + interval '6 days', 'e9: next run scheduled a week out';
  ASSERT public.run_credit_topups() = 0, 'e10: not due again yet';
  -- partial top-up when the pool is short
  PERFORM public.apply_credit_delta('00000000-0000-4000-8000-00000000d001', -9, 'unlock', '{}'::jsonb, '00000000-0000-4000-8000-00000000a001', 'contact');
  UPDATE public.credit_topup_rules SET next_run_at = now() - interval '1 minute';
  PERFORM public.move_member_credits('00000000-0000-4000-8000-00000000d001', NULL, '00000000-0000-4000-8000-00000000e003', 'contact',
    public.pool_available('00000000-0000-4000-8000-00000000d001', 'contact') - 4, 'allocate', NULL, 'e-drain', '{}'::jsonb);
  ASSERT public.run_credit_topups() = 1, 'e11: ran with a short pool';
  ASSERT public.__t_alloc('00000000-0000-4000-8000-00000000a001') = 1 + 4, 'e12: only what the pool had was added (a001=' || public.__t_alloc('00000000-0000-4000-8000-00000000a001') || ', pool=' || public.pool_available('00000000-0000-4000-8000-00000000d001','contact') || ', wallet=' || public.wallet_balance('00000000-0000-4000-8000-00000000d001','contact') || ')';
  -- pooled companies are skipped
  UPDATE public.companies SET credit_mode = 'pooled' WHERE id = '00000000-0000-4000-8000-00000000d001';
  UPDATE public.credit_topup_rules SET next_run_at = now() - interval '1 minute';
  ASSERT public.run_credit_topups() = 0, 'e13: rules do nothing in pooled mode';
END $t$;

-- export
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
SELECT public.__t_fails($q$SELECT * FROM public.member_credit_movements('00000000-0000-4000-8000-00000000d001', 30)$q$,
  'insufficient_permissions', 'e14: recruiters cannot export company movements');
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
DO $t$ BEGIN
  ASSERT public.__t_count($q$select count(*) from public.member_credit_movements('00000000-0000-4000-8000-00000000d001', 30)$q$) >= 3, 'e15: owner can export movements';
END $t$;
SELECT public.__t_reset();

-- ---------------------------------------------------------------- f. seat limits
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _tok text;
BEGIN
  -- d001 now has 6 active members (e001,e002,e003,a001,c013,c014); Basic allows 5
  ASSERT public.company_seat_limit(_co) = 5, 'f1: Basic plan seat limit is 5 (' || public.company_seat_limit(_co) || ')';
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000e001');
  PERFORM public.__t_fails(
    format($q$SELECT public.create_employer_invite(%L, 'extra@example.com', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter'))$q$, _co),
    'seat_limit_reached', 'f2: invites blocked when the plan is full');
  PERFORM public.__t_reset();
  -- upgrading lifts the cap
  INSERT INTO public.company_plans (company_id, plan_id, status, starts_at, ends_at)
    SELECT _co, id, 'active', now(), now() + interval '30 days' FROM public.plans WHERE name = 'Regular';
  ASSERT public.company_seat_limit(_co) = 25, 'f3: Regular plan allows 25';
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000e001');
  ASSERT (public.create_employer_invite(_co, 'extra@example.com', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter'))) ->> 'token' IS NOT NULL,
    'f4: invite allowed after upgrade';
  ASSERT (public.team_seat_status(_co) ->> 'pending')::int = 1 AND (public.team_seat_status(_co) ->> 'used')::int = 6, 'f5: seat status counts members and pending invites';
  PERFORM public.__t_reset();
  -- accepting while the plan is full fails
  UPDATE public.plans SET limits = limits || '{"team_seats_max": 6}'::jsonb WHERE name = 'Regular';
  SELECT token INTO _tok FROM public.employer_invites WHERE company_id = _co AND email = 'extra@example.com';
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000c005');
  PERFORM public.__t_fails(format($q$SELECT public.accept_invite(%L)$q$, _tok),
    'seat_limit_reached', 'f6: accepting is blocked when seats are full');
  PERFORM public.__t_reset();
END $t$;

ROLLBACK;
\echo team_scope_and_automation.sql: ALL PASSED

-- team_permissions.sql -- tests for 20261015100000_team_permissions_foundation.sql and
-- 20261015110000_team_permission_enforcement.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql (employers ...e001..e003, candidates ...c001.., companies ...d001..d003).
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/team_permissions.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK.

BEGIN;

CREATE FUNCTION public.__t_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION public.__t_reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Runs _sql and asserts it fails with a message containing _expect.
CREATE FUNCTION public.__t_fails(_sql text, _expect text, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(_expect IN SQLERRM) = 0 THEN
      RAISE EXCEPTION '% -- expected "%" but got "%"', _label, _expect, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '% -- expected failure "%" but statement succeeded', _label, _expect;
END $$;

GRANT EXECUTE ON FUNCTION public.__t_fails(text, text, text) TO PUBLIC;

-- ids
-- owner e001 / company d001 ; extra members: e002, e003, c001, c002, c003
DO $t$
DECLARE
  _co  constant uuid := '00000000-0000-4000-8000-00000000d001';
  _own constant uuid := '00000000-0000-4000-8000-00000000e001';
  _n int; _all int; _hr uuid; _rec uuid;
BEGIN
  -- a. seeded templates
  SELECT count(*) INTO _n FROM public.company_roles WHERE company_id IS NULL AND is_system;
  ASSERT _n = 6, 'a: six system templates, got ' || _n;
  SELECT count(*) INTO _all FROM public.permission_catalog;
  ASSERT _all >= 25, 'a: catalog seeded';
  SELECT count(*) INTO _n FROM public.company_role_permissions rp JOIN public.company_roles r ON r.id = rp.role_id
    WHERE r.key = 'super_admin' AND r.company_id IS NULL;
  ASSERT _n = _all, 'a: owner template holds every permission';
  ASSERT NOT EXISTS (SELECT 1 FROM public.employer_members WHERE role_id IS NULL), 'a: every member has role_id';

  -- b. permission resolver
  ASSERT public.has_company_permission(_own, _co, 'roles.manage'), 'b: owner has roles.manage';
  ASSERT public.has_company_permission('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d002', 'team.invite'), 'b: hr_admin can invite';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d002', 'roles.manage'), 'b: hr_admin cannot manage roles';
  -- credits lock-down (20261015130000): only Owner and Finance can buy; recruiters only see their own balance
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d003', 'credits.purchase'), 'b: recruiter cannot purchase';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d002', 'credits.purchase'), 'b: hr_admin cannot purchase';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d003', 'roles.manage'), 'b: recruiter cannot manage roles';
  ASSERT NOT public.has_company_permission(_own, '00000000-0000-4000-8000-00000000d002', 'jobs.view'), 'b: no cross-company permission';

  -- c. legacy enum writers stay in sync
  SELECT id INTO _hr  FROM public.company_roles WHERE company_id IS NULL AND key = 'hr_admin';
  SELECT id INTO _rec FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter';
  INSERT INTO public.employer_members (user_id, company_id, role) VALUES ('00000000-0000-4000-8000-00000000c001', _co, 'hr_admin');
  ASSERT (SELECT role_id FROM public.employer_members WHERE user_id = '00000000-0000-4000-8000-00000000c001' AND company_id = _co) = _hr,
    'c: enum-only insert resolves role_id';
  UPDATE public.employer_members SET role = 'recruiter' WHERE user_id = '00000000-0000-4000-8000-00000000c001' AND company_id = _co;
  ASSERT (SELECT role_id FROM public.employer_members WHERE user_id = '00000000-0000-4000-8000-00000000c001' AND company_id = _co) = _rec,
    'c: enum update moves role_id';
  INSERT INTO public.employer_members (user_id, company_id, role) VALUES
    ('00000000-0000-4000-8000-00000000c002', _co, 'recruiter'),
    ('00000000-0000-4000-8000-00000000c003', _co, 'recruiter');
END $t$;

-- d. self-insert hole closed
SELECT public.__t_as('00000000-0000-4000-8000-00000000c004');
SELECT public.__t_fails(
  $q$INSERT INTO public.employer_members (user_id, company_id, role) VALUES ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000d001', 'super_admin')$q$,
  'row-level security', 'd1: stranger must not self-insert as super_admin of an existing company');
SELECT public.__t_fails(
  $q$INSERT INTO public.employer_members (user_id, company_id, role) VALUES ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000d001', 'recruiter')$q$,
  'row-level security', 'd2: stranger must not self-insert as recruiter either');
SELECT public.__t_reset();

-- d3/d4: signup bootstrap still works exactly once
INSERT INTO public.companies (id, name, created_by) VALUES ('00000000-0000-4000-8000-00000000d0ff', 'Bootstrap Co', '00000000-0000-4000-8000-00000000c005');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c005');
INSERT INTO public.employer_members (user_id, company_id, role) VALUES ('00000000-0000-4000-8000-00000000c005', '00000000-0000-4000-8000-00000000d0ff', 'super_admin');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c006');
SELECT public.__t_fails(
  $q$INSERT INTO public.employer_members (user_id, company_id, role) VALUES ('00000000-0000-4000-8000-00000000c006', '00000000-0000-4000-8000-00000000d0ff', 'super_admin')$q$,
  'row-level security', 'd4: only the creator may bootstrap, and only once');
-- d5: owner cannot UPDATE memberships directly (must use RPCs with guards)
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.__t_fails(
  $q$UPDATE public.employer_members SET role = 'hr_admin' WHERE company_id = '00000000-0000-4000-8000-00000000d001'$q$,
  'permission denied', 'd5: direct UPDATE on employer_members is revoked');
SELECT public.__t_reset();

-- e. plan gating for custom roles (d001 has no paid plan yet)
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.__t_fails(
  $q$SELECT public.create_company_role('00000000-0000-4000-8000-00000000d001', 'Night Shift Lead', 'x', ARRAY['jobs.view'], 'own')$q$,
  'plan_requires_upgrade', 'e1: free plan cannot create custom roles');
SELECT public.__t_reset();
INSERT INTO public.company_plans (company_id, plan_id, status, starts_at, ends_at)
SELECT '00000000-0000-4000-8000-00000000d001', p.id, 'active', now(), now() + interval '30 days'
  FROM public.plans p WHERE p.name = 'Regular';
DO $t$ BEGIN ASSERT public.company_has_custom_roles('00000000-0000-4000-8000-00000000d001'), 'e2: paid plan enables custom roles'; END $t$;

-- f. custom role CRUD + escalation guards
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _rid uuid; _rid2 uuid;
BEGIN
  _rid := public.create_company_role(_co, 'Role Admin', 'can manage roles', ARRAY['roles.manage','team.view','jobs.view','team.manage_roles'], 'all');
  ASSERT _rid IS NOT NULL, 'f1: owner creates a custom role';
  ASSERT (SELECT count(*) FROM public.company_role_permissions WHERE role_id = _rid) = 4, 'f1: permissions stored';
  PERFORM public.__t_fails(
    format($q$SELECT public.create_company_role(%L, 'Role Admin', '', ARRAY['jobs.view'], 'own')$q$, _co),
    'role_name_taken', 'f2: duplicate role name rejected');
  PERFORM public.__t_fails(
    format($q$SELECT public.create_company_role(%L, 'Bad Perm', '', ARRAY['nope.nope'], 'own')$q$, _co),
    'unknown_permission', 'f3: unknown permission rejected');
  -- assign to c002
  PERFORM public.set_member_role(_co, '00000000-0000-4000-8000-00000000c002', _rid);
  ASSERT (SELECT role_id FROM public.employer_members WHERE user_id='00000000-0000-4000-8000-00000000c002' AND company_id=_co) = _rid, 'f4: custom role assigned';
  ASSERT (SELECT role FROM public.employer_members WHERE user_id='00000000-0000-4000-8000-00000000c002' AND company_id=_co) = 'recruiter',
    'f4: legacy enum shadow is least-privilege recruiter for custom roles';
  ASSERT public.has_company_permission('00000000-0000-4000-8000-00000000c002', _co, 'roles.manage'), 'f4: member holds the custom permission';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000c002', _co, 'billing.manage'), 'f4: and nothing more';
END $t$;

-- c002 (roles.manage but NOT billing.manage) cannot mint a role with billing.manage
SELECT public.__t_as('00000000-0000-4000-8000-00000000c002');
SELECT public.__t_fails(
  $q$SELECT public.create_company_role('00000000-0000-4000-8000-00000000d001', 'Sneaky', '', ARRAY['billing.manage'], 'own')$q$,
  'cannot_escalate', 'f5: cannot create a role with permissions you do not hold');
SELECT public.__t_fails(
  $q$SELECT public.set_member_role('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'finance'))$q$,
  'cannot_escalate', 'f6: cannot hand out the Finance role (holds credits.purchase etc.)');
SELECT public.__t_fails(
  $q$SELECT public.set_member_role('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter'))$q$,
  'cannot_escalate', 'f7: non-owner cannot demote the owner');
SELECT public.__t_fails(
  $q$SELECT public.set_member_role('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'super_admin'))$q$,
  'cannot_escalate', 'f8: non-owner cannot mint an owner');
-- allowed: a lesser role with a subset of its own permissions
DO $t$ DECLARE _id uuid; BEGIN
  _id := public.create_company_role('00000000-0000-4000-8000-00000000d001', 'Job Viewer', '', ARRAY['jobs.view'], 'own');
  ASSERT _id IS NOT NULL, 'f9: subset role allowed';
  PERFORM public.update_company_role('00000000-0000-4000-8000-00000000d001', _id, 'Job Viewer 2', '', ARRAY['jobs.view','team.view'], 'own');
  PERFORM public.__t_fails(
    format($q$SELECT public.update_company_role('00000000-0000-4000-8000-00000000d001', %L, 'Job Viewer 2', '', ARRAY['jobs.view','billing.manage'], 'own')$q$, _id),
    'cannot_escalate', 'f10: update cannot add permissions you lack');
END $t$;
-- system templates are immutable
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.__t_fails(
  $q$SELECT public.update_company_role('00000000-0000-4000-8000-00000000d001', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter'), 'x', '', ARRAY['jobs.view'], 'own')$q$,
  'role_not_found', 'f11: system template cannot be edited via company RPC');
-- other company's roles are invisible / unusable
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');
SELECT public.__t_fails(
  $q$SELECT public.set_member_role('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000e002', (SELECT id FROM public.company_roles WHERE company_id = '00000000-0000-4000-8000-00000000d001' AND key='role_admin'))$q$,
  'insufficient_permissions', 'f12: hr_admin has no team.manage_roles');
DO $t$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.company_roles WHERE company_id = '00000000-0000-4000-8000-00000000d001'),
    'f13: RLS hides other company custom roles';
END $t$;
SELECT public.__t_reset();

-- g. last-owner protection and deletion rules
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
SELECT public.__t_fails(
  $q$SELECT public.remove_member('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001')$q$,
  'last_super_admin', 'g1: cannot revoke the last owner');
SELECT public.__t_fails(
  $q$SELECT public.update_member_role('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', 'recruiter')$q$,
  'last_super_admin', 'g2: cannot demote the last owner');
SELECT public.__t_fails(
  $q$SELECT public.delete_company_role('00000000-0000-4000-8000-00000000d001', (SELECT id FROM public.company_roles WHERE company_id='00000000-0000-4000-8000-00000000d001' AND key='role_admin'))$q$,
  'role_in_use', 'g3: role in use cannot be deleted');
DO $t$ DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _rid uuid; BEGIN
  SELECT id INTO _rid FROM public.company_roles WHERE company_id = _co AND key = 'role_admin';
  PERFORM public.set_member_role(_co, '00000000-0000-4000-8000-00000000c002',
    (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter'));
  PERFORM public.delete_company_role(_co, _rid);
  ASSERT NOT EXISTS (SELECT 1 FROM public.company_roles WHERE id = _rid), 'g4: unused role deletes';
END $t$;
SELECT public.__t_reset();

-- h. invites
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _inv jsonb; _custom uuid;
BEGIN
  _custom := public.create_company_role(_co, 'Shift Lead', '', ARRAY['jobs.view','jobs.create','applicants.view'], 'team');
  _inv := public.create_employer_invite(_co, 'NewHire@Example.com', _custom);
  ASSERT _inv ->> 'email' = 'newhire@example.com', 'h1: email normalised';
  PERFORM public.__t_fails(
    format($q$SELECT public.create_employer_invite(%L, 'newhire@example.com', %L)$q$, _co, _custom),
    'invite_already_pending', 'h2: duplicate pending invite');
  PERFORM public.__t_fails(
    format($q$SELECT public.create_employer_invite(%L, 'not-an-email', %L)$q$, _co, _custom),
    'invalid_email', 'h3: bad email');
END $t$;
-- hr_admin of d002 cannot invite an owner into d002
SELECT public.__t_as('00000000-0000-4000-8000-00000000e002');
SELECT public.__t_fails(
  $q$SELECT public.create_employer_invite('00000000-0000-4000-8000-00000000d002', 'x@example.com', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='super_admin'))$q$,
  'cannot_escalate', 'h4: hr_admin cannot invite an owner');
SELECT public.__t_fails(
  $q$SELECT public.create_employer_invite('00000000-0000-4000-8000-00000000d002', 'x@example.com', (SELECT id FROM public.company_roles WHERE company_id='00000000-0000-4000-8000-00000000d001' LIMIT 1))$q$,
  'role_not_found', 'h5: foreign custom role unusable');
SELECT public.__t_fails(
  $q$SELECT public.create_employer_invite('00000000-0000-4000-8000-00000000d002', 'x@example.com', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='finance'))$q$,
  'cannot_escalate', 'h6: hr_admin cannot invite Finance (billing perms)');
DO $t$ BEGIN
  ASSERT (public.create_employer_invite('00000000-0000-4000-8000-00000000d002', 'rec@example.com',
    (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter'))) ->> 'token' IS NOT NULL,
    'h7: hr_admin can invite a recruiter';
END $t$;
-- recruiter cannot invite at all
SELECT public.__t_as('00000000-0000-4000-8000-00000000e003');
SELECT public.__t_fails(
  $q$SELECT public.create_employer_invite('00000000-0000-4000-8000-00000000d003', 'y@example.com', (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='recruiter'))$q$,
  'insufficient_permissions', 'h8: recruiter cannot invite');
-- direct invite insert is closed
SELECT public.__t_fails(
  $q$INSERT INTO public.employer_invites (company_id, email, role, invited_by) VALUES ('00000000-0000-4000-8000-00000000d003', 'z@example.com', 'super_admin', '00000000-0000-4000-8000-00000000e003')$q$,
  'permission denied', 'h9: direct invite insert revoked');
SELECT public.__t_reset();

-- i. accept an invite for a custom role -> membership carries role_id
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _tok text; _rid uuid; _joined uuid;
BEGIN
  SELECT token, role_id INTO _tok, _rid FROM public.employer_invites WHERE company_id = _co AND email = 'newhire@example.com';
  PERFORM public.__t_as('00000000-0000-4000-8000-00000000c007');
  _joined := public.accept_invite(_tok);
  PERFORM public.__t_reset();
  ASSERT _joined = _co, 'i1: accept returns company';
  ASSERT (SELECT role_id FROM public.employer_members WHERE user_id='00000000-0000-4000-8000-00000000c007' AND company_id=_co) = _rid,
    'i2: joined with the invited custom role';
  ASSERT public.has_company_permission('00000000-0000-4000-8000-00000000c007', _co, 'jobs.create'), 'i3: custom permission active';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000c007', _co, 'candidates.unlock'), 'i3: no unlock';
END $t$;

-- j. per-member add-ons / revocations, hierarchy
SELECT public.__t_as('00000000-0000-4000-8000-00000000e001');
DO $t$ DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; BEGIN
  PERFORM public.set_member_permissions(_co, '00000000-0000-4000-8000-00000000c007', ARRAY['candidates.unlock'], ARRAY['applicants.view']);
  ASSERT public.has_company_permission('00000000-0000-4000-8000-00000000c007', _co, 'candidates.unlock'), 'j1: extra permission granted';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000c007', _co, 'applicants.view'), 'j1: revoked permission removed';
  PERFORM public.__t_fails(
    format($q$SELECT public.set_member_permissions(%L, '00000000-0000-4000-8000-00000000e001', ARRAY['jobs.view'], ARRAY[]::text[])$q$, _co),
    'role_locked', 'j2: owner permissions cannot be customised');

  PERFORM public.set_member_manager(_co, '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000e001');
  PERFORM public.set_member_manager(_co, '00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c001');
  PERFORM public.set_member_manager(_co, '00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000c002');
  ASSERT public.is_in_subtree(_co, '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c003'), 'j3: subtree is transitive';
  ASSERT NOT public.is_in_subtree(_co, '00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c001'), 'j3: not upward';
  PERFORM public.__t_fails(
    format($q$SELECT public.set_member_manager(%L, '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c003')$q$, _co),
    'hierarchy_cycle', 'j4: cycles rejected');
  PERFORM public.__t_fails(
    format($q$SELECT public.set_member_manager(%L, '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c001')$q$, _co),
    'hierarchy_cycle', 'j5: self-manager rejected');
  -- removing c001 re-parents c002 under e001
  PERFORM public.remove_member(_co, '00000000-0000-4000-8000-00000000c001');
  ASSERT (SELECT reports_to FROM public.employer_members WHERE user_id='00000000-0000-4000-8000-00000000c002' AND company_id=_co)
         = '00000000-0000-4000-8000-00000000e001', 'j6: direct reports move up on removal';
  ASSERT NOT public.has_company_permission('00000000-0000-4000-8000-00000000c001', _co, 'jobs.view'), 'j7: revoked member has no permissions';
  PERFORM public.reactivate_member(_co, '00000000-0000-4000-8000-00000000c001', 'recruiter');
  ASSERT public.has_company_permission('00000000-0000-4000-8000-00000000c001', _co, 'jobs.view'), 'j8: reactivated';
END $t$;
SELECT public.__t_reset();

-- k. table-level enforcement: a Viewer cannot draft or activate jobs; a Recruiter can
DO $t$ DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; BEGIN
  UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='viewer')
   WHERE user_id = '00000000-0000-4000-8000-00000000c003' AND company_id = _co;
END $t$;
SELECT public.__t_as('00000000-0000-4000-8000-00000000c003');
SELECT public.__t_fails(
  $q$INSERT INTO public.jobs (company_id, posted_by, title, status) VALUES ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c003', 'Viewer job', 'draft')$q$,
  'insufficient_permissions', 'k1: viewer cannot create a job draft');
SELECT public.__t_as('00000000-0000-4000-8000-00000000c001');
DO $t$ BEGIN
  INSERT INTO public.jobs (company_id, posted_by, title, status)
  VALUES ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001', 'Recruiter job', 'draft');
END $t$;
SELECT public.__t_reset();

-- l. purchase RPCs follow permissions (service-role style call with _actor)
DO $t$
DECLARE _co constant uuid := '00000000-0000-4000-8000-00000000d001'; _pack uuid;
BEGIN
  SELECT id INTO _pack FROM public.credit_packs WHERE active LIMIT 1;
  IF _pack IS NULL THEN RAISE NOTICE 'l: skipped (no active credit pack in local seed)'; RETURN; END IF;
  PERFORM public.__t_fails(
    format($q$SELECT public.create_credit_pack_order(%L, %L, '00000000-0000-4000-8000-00000000c001')$q$, _co, _pack),
    'insufficient_permissions', 'l1: recruiter cannot buy credits');
  UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='viewer')
   WHERE user_id = '00000000-0000-4000-8000-00000000c001' AND company_id = _co;
  PERFORM public.__t_fails(
    format($q$SELECT public.create_credit_pack_order(%L, %L, '00000000-0000-4000-8000-00000000c001')$q$, _co, _pack),
    'insufficient_permissions', 'l1b: viewer cannot buy credits');
  UPDATE public.employer_members SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key='finance')
   WHERE user_id = '00000000-0000-4000-8000-00000000c001' AND company_id = _co;
  ASSERT (public.create_credit_pack_order(_co, _pack, '00000000-0000-4000-8000-00000000c001')) ->> 'order_id' IS NOT NULL,
    'l2: finance can buy credits';
  ASSERT (public.create_credit_pack_order(_co, _pack, '00000000-0000-4000-8000-00000000e001')) ->> 'order_id' IS NOT NULL,
    'l3: owner can buy credits';
END $t$;

ROLLBACK;
\echo team_permissions.sql: ALL PASSED

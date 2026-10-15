-- ============================================================================
-- Team module Phase 1A: permission catalog + custom roles (paid plans)
-- (prompt structure/team-management.md sections 5, 9)
-- ============================================================================
-- * permission_catalog          platform-owned list of permission keys
-- * company_roles               system templates (company_id NULL) + per-company custom roles
-- * company_role_permissions    role -> permission keys
-- * employer_members            + role_id, reports_to, extra/revoked permissions
-- * employer_invites            + role_id
-- * has_company_permission()    the one authority for "may this user do X in company Y"
-- * custom-role RPCs            create / update / delete / assign, with escalation guards
-- The legacy employer_role enum stays and is kept in sync by trigger, so every
-- existing policy / RPC that calls has_company_role() keeps working unchanged.
-- Re-runnable.
-- ============================================================================

-- ── 1. Permission catalog ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.permission_catalog (
  key         text PRIMARY KEY,
  grp         text NOT NULL,
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_sensitive boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0
);

INSERT INTO public.permission_catalog (key, grp, label, description, is_sensitive, sort_order) VALUES
  ('jobs.view',            'Jobs',       'View jobs',                  'See jobs in scope', false, 10),
  ('jobs.create',          'Jobs',       'Post jobs',                  'Create and publish jobs (spends job-post credits)', false, 11),
  ('jobs.edit',            'Jobs',       'Edit jobs',                  'Edit any job in scope, not only own', false, 12),
  ('jobs.close',           'Jobs',       'Close / delete jobs',        'Close or delete jobs in scope', false, 13),
  ('jobs.boost',           'Jobs',       'Boost jobs',                 'Apply boosts (spends boost credits)', false, 14),
  ('applicants.view',      'Applicants', 'View applicants',            'See applications and candidate responses', false, 20),
  ('applicants.manage',    'Applicants', 'Manage applicants',          'Shortlist, reject, schedule, change status', false, 21),
  ('applicants.export',    'Applicants', 'Export applicants',          'Download applicant data', true, 22),
  ('candidates.search',    'Candidate DB','Search candidate database', 'Run candidate DB searches', false, 30),
  ('candidates.unlock',    'Candidate DB','Unlock candidate contacts', 'Reveal phone/email (spends contact credits)', true, 31),
  ('team.view',            'Team',       'View team',                  'See the member list', false, 40),
  ('team.invite',          'Team',       'Invite members',             'Send, resend and cancel invites', false, 41),
  ('team.manage_roles',    'Team',       'Change member roles',        'Assign roles and per-member permissions', true, 42),
  ('team.remove',          'Team',       'Remove / restore members',   'Revoke and reactivate members', true, 43),
  ('roles.manage',         'Team',       'Manage custom roles',        'Create, edit and delete custom roles', true, 44),
  ('credits.view_own',     'Credits',    'View own credits',           'See own balance and history', false, 50),
  ('credits.view_team',    'Credits',    'View team credits',          'See balances and usage of own reports', false, 51),
  ('credits.view_all',     'Credits',    'View all credits',           'See every member balance and the pool', false, 52),
  ('credits.allocate',     'Credits',    'Allocate from pool',         'Give pool credits to members', true, 53),
  ('credits.delegate',     'Credits',    'Delegate to team',           'Give own credits to own reports', true, 54),
  ('credits.reclaim',      'Credits',    'Reclaim credits',            'Take credits back from members', true, 55),
  ('credits.approve_requests','Credits', 'Approve credit requests',    'Decide credit requests routed to you', false, 56),
  ('credits.pool_spend',   'Credits',    'Spend from company pool',    'Spend company pool credits directly', true, 57),
  ('credits.purchase',     'Credits',    'Buy credits and plans',      'Purchase credit packs and plans', true, 58),
  ('billing.view',         'Billing',    'View billing',               'See invoices, plan and orders', false, 60),
  ('billing.manage',       'Billing',    'Manage billing',             'Change plan, billing details', true, 61),
  ('company.edit',         'Company',    'Edit company profile',       'Edit company details', false, 70),
  ('verification.manage',  'Company',    'Manage verification',        'Submit company documents / KYC', false, 71),
  ('reports.view',         'Company',    'View reports',               'Analytics and reports', false, 72),
  ('activity.view',        'Company',    'View activity log',          'Company activity feed', false, 73)
ON CONFLICT (key) DO UPDATE
  SET grp = EXCLUDED.grp, label = EXCLUDED.label, description = EXCLUDED.description,
      is_sensitive = EXCLUDED.is_sensitive, sort_order = EXCLUDED.sort_order;

ALTER TABLE public.permission_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permission_catalog read" ON public.permission_catalog;
CREATE POLICY "permission_catalog read" ON public.permission_catalog
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.permission_catalog TO authenticated;
GRANT ALL ON public.permission_catalog TO service_role;

-- ── 2. Roles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,  -- NULL = system template
  key         text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false,
  is_locked   boolean NOT NULL DEFAULT false,   -- locked = owner-level, implicit all permissions, not editable
  base_role   public.employer_role NOT NULL DEFAULT 'recruiter',  -- legacy enum shadow
  scope       text NOT NULL DEFAULT 'own' CHECK (scope IN ('own', 'team', 'all')),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_roles_system_shape CHECK ((is_system AND company_id IS NULL) OR (NOT is_system AND company_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_roles_system_key
  ON public.company_roles (key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_roles_company_key
  ON public.company_roles (company_id, key) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_roles_company ON public.company_roles (company_id);

DROP TRIGGER IF EXISTS trg_company_roles_updated ON public.company_roles;
CREATE TRIGGER trg_company_roles_updated BEFORE UPDATE ON public.company_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.company_role_permissions (
  role_id        uuid NOT NULL REFERENCES public.company_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES public.permission_catalog(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

-- ── 3. Seed system templates (idempotent) ───────────────────
INSERT INTO public.company_roles (key, name, description, is_system, is_locked, base_role, scope) VALUES
  ('super_admin', 'Owner',     'Full control of the company account',                    true, true,  'super_admin', 'all'),
  ('hr_admin',    'HR Admin',  'Runs hiring, team invites, company profile and reports', true, false, 'hr_admin',    'all'),
  ('manager',     'Manager',   'Leads a team; delegates credits to own reports',         true, false, 'recruiter',   'team'),
  ('recruiter',   'Recruiter', 'Posts jobs and works own applicants',                    true, false, 'recruiter',   'own'),
  ('finance',     'Finance',   'Billing, credits and reports only',                      true, false, 'recruiter',   'all'),
  ('viewer',      'Viewer',    'Read-only access to jobs and applicants',                true, false, 'recruiter',   'all')
ON CONFLICT (key) WHERE company_id IS NULL DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      is_locked = EXCLUDED.is_locked, base_role = EXCLUDED.base_role, scope = EXCLUDED.scope;

-- Template permissions. Owner is locked (implicit all) but also gets explicit rows for display.
DO $$
DECLARE
  _t record;
  _map jsonb := jsonb_build_object(
    'hr_admin', jsonb_build_array(
      'jobs.view','jobs.create','jobs.edit','jobs.close','jobs.boost',
      'applicants.view','applicants.manage','applicants.export',
      'candidates.search','candidates.unlock',
      'team.view','team.invite','company.edit','verification.manage','reports.view','activity.view',
      'credits.view_own','credits.view_team','credits.view_all','credits.purchase','billing.view','billing.manage'),
    'manager', jsonb_build_array(
      'jobs.view','jobs.create','jobs.edit','jobs.close','jobs.boost',
      'applicants.view','applicants.manage','candidates.search','candidates.unlock',
      'team.view','reports.view','activity.view',
      'credits.view_own','credits.view_team','credits.delegate','credits.reclaim','credits.approve_requests',
      'credits.purchase','billing.view','billing.manage'),
    'recruiter', jsonb_build_array(
      'jobs.view','jobs.create','jobs.edit','jobs.close','jobs.boost',
      'applicants.view','applicants.manage','candidates.search','candidates.unlock',
      'team.view','credits.view_own','credits.purchase','billing.view','billing.manage'),
    'finance', jsonb_build_array(
      'jobs.view','team.view','reports.view','activity.view',
      'credits.view_own','credits.view_team','credits.view_all','credits.allocate','credits.reclaim',
      'credits.approve_requests','credits.purchase','billing.view','billing.manage'),
    'viewer', jsonb_build_array(
      'jobs.view','applicants.view','team.view')
  );
BEGIN
  -- Owner: every permission.
  INSERT INTO public.company_role_permissions (role_id, permission_key)
    SELECT r.id, p.key FROM public.company_roles r CROSS JOIN public.permission_catalog p
    WHERE r.company_id IS NULL AND r.key = 'super_admin'
  ON CONFLICT DO NOTHING;

  FOR _t IN SELECT r.id, r.key FROM public.company_roles r WHERE r.company_id IS NULL AND r.key <> 'super_admin' LOOP
    INSERT INTO public.company_role_permissions (role_id, permission_key)
      SELECT _t.id, v FROM jsonb_array_elements_text(_map -> _t.key) AS v
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── 4. Membership / invite columns ──────────────────────────
ALTER TABLE public.employer_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.company_roles(id),
  ADD COLUMN IF NOT EXISTS reports_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extra_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS revoked_permissions text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.employer_invites
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.company_roles(id);

CREATE INDEX IF NOT EXISTS idx_employer_members_role_id ON public.employer_members (role_id);
CREATE INDEX IF NOT EXISTS idx_employer_members_reports_to
  ON public.employer_members (company_id, reports_to) WHERE reports_to IS NOT NULL;

-- Backfill role_id from the legacy enum (system template with the same key).
UPDATE public.employer_members m
   SET role_id = r.id
  FROM public.company_roles r
 WHERE m.role_id IS NULL AND r.company_id IS NULL AND r.key = m.role::text;

UPDATE public.employer_invites i
   SET role_id = r.id
  FROM public.company_roles r
 WHERE i.role_id IS NULL AND r.company_id IS NULL AND r.key = i.role::text;

-- ── 5. Keep enum and role_id in sync (legacy writers set only `role`) ──
CREATE OR REPLACE FUNCTION public.tg_sync_member_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _base public.employer_role; _sys uuid; _rcompany uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id IS NULL THEN
      SELECT id INTO _sys FROM public.company_roles WHERE company_id IS NULL AND key = NEW.role::text;
      NEW.role_id := _sys;
    END IF;
  ELSE
    IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.role IS DISTINCT FROM OLD.role THEN
      SELECT id INTO _sys FROM public.company_roles WHERE company_id IS NULL AND key = NEW.role::text;
      NEW.role_id := _sys;
    END IF;
  END IF;

  IF NEW.role_id IS NOT NULL THEN
    SELECT base_role, company_id INTO _base, _rcompany FROM public.company_roles WHERE id = NEW.role_id;
    IF _rcompany IS NOT NULL AND _rcompany <> NEW.company_id THEN
      RAISE EXCEPTION 'role_wrong_company';
    END IF;
    IF _base IS NOT NULL THEN NEW.role := _base; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_member_role ON public.employer_members;
CREATE TRIGGER trg_sync_member_role BEFORE INSERT OR UPDATE ON public.employer_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_member_role();

CREATE OR REPLACE FUNCTION public.tg_sync_invite_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _base public.employer_role; _sys uuid; _rcompany uuid;
BEGIN
  IF NEW.role_id IS NULL THEN
    SELECT id INTO _sys FROM public.company_roles WHERE company_id IS NULL AND key = NEW.role::text;
    NEW.role_id := _sys;
  END IF;
  SELECT base_role, company_id INTO _base, _rcompany FROM public.company_roles WHERE id = NEW.role_id;
  IF _rcompany IS NOT NULL AND _rcompany <> NEW.company_id THEN
    RAISE EXCEPTION 'role_wrong_company';
  END IF;
  IF _base IS NOT NULL THEN NEW.role := _base; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_invite_role ON public.employer_invites;
CREATE TRIGGER trg_sync_invite_role BEFORE INSERT OR UPDATE OF role, role_id ON public.employer_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_invite_role();

-- ── 6. Permission resolver ──────────────────────────────────
-- Effective permissions = role permissions + member extras - member revocations.
-- Locked (owner) roles hold every permission and cannot be reduced.
CREATE OR REPLACE FUNCTION public.member_permissions(_user_id uuid, _company_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN r.is_locked THEN (SELECT array_agg(key) FROM public.permission_catalog)
      ELSE (
        SELECT COALESCE(array_agg(DISTINCT k), '{}')
        FROM (
          SELECT permission_key AS k FROM public.company_role_permissions WHERE role_id = r.id
          UNION
          SELECT unnest(m.extra_permissions)
        ) s
        WHERE k <> ALL (m.revoked_permissions)
      )
    END
    FROM public.employer_members m
    JOIN public.company_roles r ON r.id = m.role_id
    WHERE m.user_id = _user_id AND m.company_id = _company_id AND m.status = 'active'
  ), '{}');
$$;

CREATE OR REPLACE FUNCTION public.has_company_permission(_user_id uuid, _company_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _perm = ANY (public.member_permissions(_user_id, _company_id));
$$;

CREATE OR REPLACE FUNCTION public.my_permissions(_company_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.member_permissions(auth.uid(), _company_id);
$$;

-- ── 7. Plan gating for custom roles ─────────────────────────
-- plans.limits.custom_roles_enabled = true on paid plans. Basic / no plan => false.
CREATE OR REPLACE FUNCTION public.company_has_custom_roles(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT (p.limits ->> 'custom_roles_enabled')::boolean
    FROM public.company_plans cp
    JOIN public.plans p ON p.id = cp.plan_id
    WHERE cp.company_id = _company_id AND cp.status = 'active'
      AND (cp.ends_at IS NULL OR cp.ends_at > now())
    LIMIT 1
  ), false);
$$;

UPDATE public.plans
   SET limits = limits || '{"custom_roles_enabled": true}'::jsonb
 WHERE is_custom = false AND price_inr > 0
   AND NOT (limits ? 'custom_roles_enabled');

-- ── 8. Helpers ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_company_owner(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employer_members m
    JOIN public.company_roles r ON r.id = m.role_id
    WHERE m.user_id = _user_id AND m.company_id = _company_id AND m.status = 'active' AND r.is_locked
  );
$$;

CREATE OR REPLACE FUNCTION public.active_owner_count(_company_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.employer_members m
  JOIN public.company_roles r ON r.id = m.role_id
  WHERE m.company_id = _company_id AND m.status = 'active' AND r.is_locked;
$$;

-- Escalation guard: every key in _perms must be held by the caller (owners hold all).
CREATE OR REPLACE FUNCTION public.assert_can_grant(_caller uuid, _company_id uuid, _perms text[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _mine text[]; _bad text[]; _unknown text[];
BEGIN
  SELECT array_agg(p) INTO _unknown
    FROM unnest(_perms) p WHERE NOT EXISTS (SELECT 1 FROM public.permission_catalog c WHERE c.key = p);
  IF _unknown IS NOT NULL THEN RAISE EXCEPTION 'unknown_permission: %', _unknown[1]; END IF;
  IF public.is_company_owner(_caller, _company_id) THEN RETURN; END IF;
  _mine := public.member_permissions(_caller, _company_id);
  SELECT array_agg(p) INTO _bad FROM unnest(_perms) p WHERE p <> ALL (_mine);
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'cannot_escalate'; END IF;
END $$;

-- Hierarchy cycle check helper.
CREATE OR REPLACE FUNCTION public.is_in_subtree(_company_id uuid, _manager uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE sub(uid, depth) AS (
    SELECT m.user_id, 1 FROM public.employer_members m
     WHERE m.company_id = _company_id AND m.reports_to = _manager AND m.status = 'active'
    UNION
    SELECT m.user_id, s.depth + 1 FROM public.employer_members m
     JOIN sub s ON m.reports_to = s.uid
     WHERE m.company_id = _company_id AND m.status = 'active' AND s.depth < 12
  )
  SELECT EXISTS (SELECT 1 FROM sub WHERE uid = _user);
$$;

-- ── 9. Custom role RPCs ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_company_role(
  _company_id uuid, _name text, _description text, _permissions text[], _scope text DEFAULT 'own',
  _copy_from uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _key text; _perms text[] := COALESCE(_permissions, '{}'); _n int;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'roles.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF NOT public.company_has_custom_roles(_company_id) THEN
    RAISE EXCEPTION 'plan_requires_upgrade';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 60 THEN
    RAISE EXCEPTION 'invalid_role_name';
  END IF;
  IF _scope NOT IN ('own', 'team', 'all') THEN RAISE EXCEPTION 'invalid_scope'; END IF;

  IF _copy_from IS NOT NULL THEN
    SELECT COALESCE(array_agg(permission_key), '{}') INTO _perms
      FROM public.company_role_permissions rp
      JOIN public.company_roles r ON r.id = rp.role_id
      WHERE rp.role_id = _copy_from AND (r.company_id IS NULL OR r.company_id = _company_id);
    _perms := _perms || COALESCE(_permissions, '{}');
  END IF;
  -- Owner-level (locked) permissions cannot be stamped into a custom role by non-owners (escalation guard).
  PERFORM public.assert_can_grant(auth.uid(), _company_id, _perms);

  _key := regexp_replace(lower(btrim(_name)), '[^a-z0-9]+', '_', 'g');
  _key := trim(both '_' from _key);
  IF _key = '' THEN RAISE EXCEPTION 'invalid_role_name'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_roles WHERE company_id IS NULL AND key = _key) THEN
    _key := 'custom_' || _key;
  END IF;
  SELECT count(*) INTO _n FROM public.company_roles WHERE company_id = _company_id;
  IF _n >= 25 THEN RAISE EXCEPTION 'role_limit_reached'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_roles WHERE company_id = _company_id AND key = _key) THEN
    RAISE EXCEPTION 'role_name_taken';
  END IF;

  INSERT INTO public.company_roles (company_id, key, name, description, is_system, is_locked, base_role, scope, created_by)
    VALUES (_company_id, _key, btrim(_name), COALESCE(_description, ''), false, false, 'recruiter', _scope, auth.uid())
    RETURNING id INTO _id;

  INSERT INTO public.company_role_permissions (role_id, permission_key)
    SELECT _id, p FROM (SELECT DISTINCT unnest(_perms) AS p) s;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_created', 'Custom role created',
    'Role "' || btrim(_name) || '" was created', '/employer/team',
    jsonb_build_object('role_id', _id, 'permissions', _perms, 'scope', _scope)
  );
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.update_company_role(
  _company_id uuid, _role_id uuid, _name text, _description text, _permissions text[], _scope text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.company_roles%ROWTYPE; _old text[]; _new text[] := COALESCE(_permissions, '{}');
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'roles.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT * INTO _r FROM public.company_roles WHERE id = _role_id FOR UPDATE;
  IF NOT FOUND OR _r.company_id IS DISTINCT FROM _company_id THEN RAISE EXCEPTION 'role_not_found'; END IF;
  IF _r.is_system OR _r.is_locked THEN RAISE EXCEPTION 'role_locked'; END IF;
  IF _scope NOT IN ('own', 'team', 'all') THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  IF _name IS NULL OR length(btrim(_name)) < 2 OR length(_name) > 60 THEN RAISE EXCEPTION 'invalid_role_name'; END IF;

  SELECT COALESCE(array_agg(permission_key), '{}') INTO _old FROM public.company_role_permissions WHERE role_id = _role_id;
  -- Caller only has to hold permissions being newly added; keeping existing ones is always allowed.
  PERFORM public.assert_can_grant(auth.uid(), _company_id,
    ARRAY(SELECT p FROM unnest(_new) p WHERE p <> ALL (_old)));

  UPDATE public.company_roles
     SET name = btrim(_name), description = COALESCE(_description, ''), scope = _scope
   WHERE id = _role_id;
  DELETE FROM public.company_role_permissions WHERE role_id = _role_id;
  INSERT INTO public.company_role_permissions (role_id, permission_key)
    SELECT _role_id, p FROM (SELECT DISTINCT unnest(_new) AS p) s;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_updated', 'Custom role updated',
    'Role "' || btrim(_name) || '" permissions changed', '/employer/team',
    jsonb_build_object('role_id', _role_id, 'before', _old, 'after', _new, 'scope', _scope)
  );
END $$;

CREATE OR REPLACE FUNCTION public.delete_company_role(_company_id uuid, _role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.company_roles%ROWTYPE;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'roles.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT * INTO _r FROM public.company_roles WHERE id = _role_id FOR UPDATE;
  IF NOT FOUND OR _r.company_id IS DISTINCT FROM _company_id THEN RAISE EXCEPTION 'role_not_found'; END IF;
  IF _r.is_system THEN RAISE EXCEPTION 'role_locked'; END IF;
  IF EXISTS (SELECT 1 FROM public.employer_members WHERE role_id = _role_id AND status = 'active')
     OR EXISTS (SELECT 1 FROM public.employer_invites WHERE role_id = _role_id AND accepted_at IS NULL) THEN
    RAISE EXCEPTION 'role_in_use';
  END IF;
  -- Revoked members keep history: move them to the Recruiter template before deleting.
  UPDATE public.employer_members
     SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter')
   WHERE role_id = _role_id;
  UPDATE public.employer_invites
     SET role_id = (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = 'recruiter')
   WHERE role_id = _role_id;
  DELETE FROM public.company_roles WHERE id = _role_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_deleted', 'Custom role deleted',
    'Role "' || _r.name || '" was deleted', '/employer/team',
    jsonb_build_object('role_id', _role_id)
  );
END $$;

-- Assign a role (system template or this company's custom role) to a member.
CREATE OR REPLACE FUNCTION public.set_member_role(_company_id uuid, _user_id uuid, _role_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.company_roles%ROWTYPE; _cur public.company_roles%ROWTYPE; _perms text[];
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.manage_roles') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT * INTO _r FROM public.company_roles WHERE id = _role_id;
  IF NOT FOUND OR (_r.company_id IS NOT NULL AND _r.company_id <> _company_id) THEN
    RAISE EXCEPTION 'role_not_found';
  END IF;
  IF _r.company_id IS NOT NULL AND NOT public.company_has_custom_roles(_company_id) THEN
    RAISE EXCEPTION 'plan_requires_upgrade';
  END IF;

  SELECT r.* INTO _cur FROM public.employer_members m JOIN public.company_roles r ON r.id = m.role_id
   WHERE m.user_id = _user_id AND m.company_id = _company_id AND m.status = 'active' FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found'; END IF;

  -- Only owners can create or remove owners.
  IF (_r.is_locked OR _cur.is_locked) AND NOT public.is_company_owner(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'cannot_escalate';
  END IF;
  IF _cur.is_locked AND NOT _r.is_locked AND public.active_owner_count(_company_id) <= 1 THEN
    RAISE EXCEPTION 'last_super_admin';
  END IF;
  -- Non-owners may not hand out a role holding permissions they lack.
  SELECT COALESCE(array_agg(permission_key), '{}') INTO _perms FROM public.company_role_permissions WHERE role_id = _role_id;
  PERFORM public.assert_can_grant(auth.uid(), _company_id, _perms);

  UPDATE public.employer_members SET role_id = _role_id
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_changed', 'Role updated',
    'Member role set to ' || _r.name, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role_id', _role_id, 'role', _r.key)
  );
END $$;

-- Per-member permission add-ons / revocations (Greenhouse-style).
CREATE OR REPLACE FUNCTION public.set_member_permissions(
  _company_id uuid, _user_id uuid, _extra text[], _revoked text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cur public.company_roles%ROWTYPE;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.manage_roles') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF NOT public.company_has_custom_roles(_company_id) THEN
    RAISE EXCEPTION 'plan_requires_upgrade';
  END IF;
  SELECT r.* INTO _cur FROM public.employer_members m JOIN public.company_roles r ON r.id = m.role_id
   WHERE m.user_id = _user_id AND m.company_id = _company_id AND m.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found'; END IF;
  IF _cur.is_locked THEN RAISE EXCEPTION 'role_locked'; END IF;
  PERFORM public.assert_can_grant(auth.uid(), _company_id, COALESCE(_extra, '{}'));
  PERFORM public.assert_can_grant(auth.uid(), _company_id, COALESCE(_revoked, '{}'));
  UPDATE public.employer_members
     SET extra_permissions = COALESCE(_extra, '{}'), revoked_permissions = COALESCE(_revoked, '{}')
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.permissions_changed', 'Member permissions updated',
    'Per-member permissions changed', '/employer/team',
    jsonb_build_object('user_id', _user_id, 'extra', _extra, 'revoked', _revoked)
  );
END $$;

-- Reporting line (manager hierarchy).
CREATE OR REPLACE FUNCTION public.set_member_manager(_company_id uuid, _user_id uuid, _manager_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.manage_roles') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _manager_id IS NOT NULL THEN
    IF _manager_id = _user_id THEN RAISE EXCEPTION 'hierarchy_cycle'; END IF;
    IF NOT public.has_company_membership(_manager_id, _company_id) THEN RAISE EXCEPTION 'manager_not_member'; END IF;
    IF public.is_in_subtree(_company_id, _user_id, _manager_id) THEN RAISE EXCEPTION 'hierarchy_cycle'; END IF;
  END IF;
  UPDATE public.employer_members SET reports_to = _manager_id
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found'; END IF;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.manager_changed', 'Reporting line updated',
    'Member reporting line changed', '/employer/team',
    jsonb_build_object('user_id', _user_id, 'reports_to', _manager_id)
  );
END $$;

-- ── 10. Existing team RPCs re-expressed on permissions ──────
-- update_member_role(enum) stays for older callers; it now maps to the system template.
CREATE OR REPLACE FUNCTION public.update_member_role(_company_id uuid, _user_id uuid, _role public.employer_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.set_member_role(
    _company_id, _user_id,
    (SELECT id FROM public.company_roles WHERE company_id IS NULL AND key = _role::text)
  );
END $$;

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
  UPDATE public.employer_members
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found or already revoked'; END IF;
  -- Direct reports move up to the removed member's own manager.
  UPDATE public.employer_members
     SET reports_to = (SELECT reports_to FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id)
   WHERE company_id = _company_id AND reports_to = _user_id;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.revoked', 'Team member access revoked',
    COALESCE(_name, 'A teammate') || '''s access was revoked', '/employer/team',
    jsonb_build_object('user_id', _user_id, 'revoked_by', auth.uid())
  );
END $$;

CREATE OR REPLACE FUNCTION public.reactivate_member(_company_id uuid, _user_id uuid, _role public.employer_role DEFAULT 'recruiter')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text; _rid uuid;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.remove') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _role = 'super_admin' AND NOT public.is_company_owner(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'cannot_escalate';
  END IF;
  SELECT id INTO _rid FROM public.company_roles WHERE company_id IS NULL AND key = _role::text;
  UPDATE public.employer_members
     SET status = 'active', revoked_at = NULL, revoked_by = NULL, role = _role, role_id = _rid,
         reports_to = NULL, extra_permissions = '{}', revoked_permissions = '{}'
   WHERE user_id = _user_id AND company_id = _company_id AND status = 'revoked';
  IF NOT FOUND THEN RAISE EXCEPTION 'No revoked member found to reactivate'; END IF;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.reactivated', 'Team member access restored',
    COALESCE(_name, 'A teammate') || ' was reactivated as ' || _role::text, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role', _role)
  );
END $$;

-- accept_invite: honour the invite's role_id (custom roles) and keep the existing audit shape.
CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv public.employer_invites%ROWTYPE;
  _uid uuid := auth.uid();
  _name text;
  _accepting_email text;
  _existing_status text;
  _rname text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.employer_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;

  SELECT status INTO _existing_status FROM public.employer_members
    WHERE user_id = _uid AND company_id = _inv.company_id;

  IF _existing_status = 'revoked' THEN
    UPDATE public.employer_members
      SET status = 'active', role = _inv.role, role_id = _inv.role_id, revoked_at = NULL, revoked_by = NULL,
          reports_to = NULL, extra_permissions = '{}', revoked_permissions = '{}'
      WHERE user_id = _uid AND company_id = _inv.company_id;
  ELSE
    INSERT INTO public.employer_members (user_id, company_id, role, role_id)
      VALUES (_uid, _inv.company_id, _inv.role, _inv.role_id)
      ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id, status = 'active';
  END IF;

  UPDATE public.employer_invites SET accepted_at = now(), accepted_by = _uid WHERE id = _inv.id;

  SELECT name INTO _rname FROM public.company_roles WHERE id = _inv.role_id;
  SELECT full_name, email INTO _name, _accepting_email FROM public.profiles WHERE id = _uid;
  PERFORM public.log_employer_activity(
    _inv.company_id, _uid, 'team.joined', 'Teammate joined',
    COALESCE(_name, 'A teammate') || ' joined as ' || COALESCE(_rname, _inv.role::text),
    '/employer/team',
    jsonb_build_object(
      'user_id', _uid, 'role', _inv.role, 'role_id', _inv.role_id, 'invite_id', _inv.id,
      'invited_email', _inv.email, 'accepting_email', _accepting_email,
      'identity_mismatch', lower(coalesce(_accepting_email, '')) <> lower(_inv.email)
    )
  );
  RETURN _inv.company_id;
END; $$;

-- Invite RPCs: permission based.
CREATE OR REPLACE FUNCTION public.cancel_employer_invite(_company_id uuid, _invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.employer_invites%ROWTYPE;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.invite') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT * INTO _inv FROM public.employer_invites WHERE id = _invite_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Cannot cancel an invite that has already been accepted'; END IF;
  DELETE FROM public.employer_invites WHERE id = _invite_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invite_cancelled', 'Invitation cancelled',
    'Invitation for ' || _inv.email || ' was cancelled', '/employer/team',
    jsonb_build_object('invite_id', _invite_id, 'email', _inv.email)
  );
END $$;

CREATE OR REPLACE FUNCTION public.resend_employer_invite(_company_id uuid, _invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.employer_invites%ROWTYPE; _new_token text; _new_expiry timestamptz;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.invite') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  SELECT * INTO _inv FROM public.employer_invites WHERE id = _invite_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Cannot resend an invite that has already been accepted'; END IF;
  _new_token := replace(gen_random_uuid()::text, '-', '');
  _new_expiry := now() + interval '7 days';
  UPDATE public.employer_invites SET token = _new_token, expires_at = _new_expiry WHERE id = _invite_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invite_resent', 'Invitation resent',
    'Invitation for ' || _inv.email || ' was refreshed', '/employer/team',
    jsonb_build_object('invite_id', _invite_id, 'email', _inv.email)
  );
  RETURN jsonb_build_object('id', _invite_id, 'email', _inv.email, 'token', _new_token, 'expires_at', _new_expiry);
END $$;

-- Create an invite with escalation + plan checks (replaces the raw client INSERT).
CREATE OR REPLACE FUNCTION public.create_employer_invite(_company_id uuid, _email text, _role_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.company_roles%ROWTYPE; _perms text[]; _inv public.employer_invites%ROWTYPE; _mail text := lower(btrim(_email));
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.invite') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _mail IS NULL OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  SELECT * INTO _r FROM public.company_roles WHERE id = _role_id;
  IF NOT FOUND OR (_r.company_id IS NOT NULL AND _r.company_id <> _company_id) THEN RAISE EXCEPTION 'role_not_found'; END IF;
  IF _r.company_id IS NOT NULL AND NOT public.company_has_custom_roles(_company_id) THEN
    RAISE EXCEPTION 'plan_requires_upgrade';
  END IF;
  IF _r.is_locked AND NOT public.is_company_owner(auth.uid(), _company_id) THEN RAISE EXCEPTION 'cannot_escalate'; END IF;
  SELECT COALESCE(array_agg(permission_key), '{}') INTO _perms FROM public.company_role_permissions WHERE role_id = _role_id;
  PERFORM public.assert_can_grant(auth.uid(), _company_id, _perms);
  IF EXISTS (SELECT 1 FROM public.employer_invites WHERE company_id = _company_id AND lower(email) = _mail AND accepted_at IS NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'invite_already_pending';
  END IF;

  INSERT INTO public.employer_invites (company_id, email, role, role_id, invited_by)
    VALUES (_company_id, _mail, _r.base_role, _role_id, auth.uid())
    RETURNING * INTO _inv;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invited', 'Teammate invited',
    _mail || ' was invited as ' || _r.name, '/employer/team',
    jsonb_build_object('invite_id', _inv.id, 'email', _mail, 'role_id', _role_id)
  );
  RETURN jsonb_build_object('id', _inv.id, 'email', _inv.email, 'token', _inv.token, 'expires_at', _inv.expires_at);
END $$;

-- ── 11. RLS ─────────────────────────────────────────────────
ALTER TABLE public.company_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles read" ON public.company_roles;
CREATE POLICY "roles read" ON public.company_roles FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "role perms read" ON public.company_role_permissions;
CREATE POLICY "role perms read" ON public.company_role_permissions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.company_roles r
    WHERE r.id = role_id AND (r.company_id IS NULL OR public.has_company_membership(auth.uid(), r.company_id))
  ));

GRANT SELECT ON public.company_roles, public.company_role_permissions TO authenticated;
GRANT ALL ON public.company_roles, public.company_role_permissions TO service_role;

-- Direct client writes to members/invites are replaced by RPCs. Members stay readable;
-- invites are created via create_employer_invite().
DROP POLICY IF EXISTS "invites insert" ON public.employer_invites;
DO $$
DECLARE _p record;
BEGIN
  FOR _p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'employer_invites' AND cmd = 'INSERT' LOOP
    EXECUTE format('DROP POLICY %I ON public.employer_invites', _p.policyname);
  END LOOP;
END $$;

-- ── 12. Privileges ──────────────────────────────────────────
REVOKE ALL ON FUNCTION public.member_permissions(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_company_permission(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_can_grant(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_company_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.active_owner_count(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_in_subtree(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_has_custom_roles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_permissions(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_company_permission(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.active_owner_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_in_subtree(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_has_custom_roles(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_can_grant(uuid, uuid, text[]) TO service_role;

REVOKE ALL ON FUNCTION public.my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated;

DO $$
DECLARE _sig text;
BEGIN
  FOREACH _sig IN ARRAY ARRAY[
    'public.create_company_role(uuid, text, text, text[], text, uuid)',
    'public.update_company_role(uuid, uuid, text, text, text[], text)',
    'public.delete_company_role(uuid, uuid)',
    'public.set_member_role(uuid, uuid, uuid)',
    'public.set_member_permissions(uuid, uuid, text[], text[])',
    'public.set_member_manager(uuid, uuid, uuid)',
    'public.create_employer_invite(uuid, text, uuid)',
    'public.update_member_role(uuid, uuid, public.employer_role)',
    'public.remove_member(uuid, uuid)',
    'public.reactivate_member(uuid, uuid, public.employer_role)',
    'public.cancel_employer_invite(uuid, uuid)',
    'public.resend_employer_invite(uuid, uuid)',
    'public.accept_invite(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _sig);
  END LOOP;
END $$;

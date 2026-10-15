-- ============================================================================
-- Team module, remaining items: job scope + sharing, low-balance alerts,
-- recurring credit top-ups, seat limits, job reassignment, usage export
-- (prompt structure/team-management.md sections 4-6, 12 "Not built yet")
-- ============================================================================
-- Access modes (opt-in per company, like credit_mode):
--   'open'   (default) today's behaviour: everyone with applicants.view sees every applicant.
--   'scoped' a role's `scope` applies: own = jobs you posted or that are shared with you,
--            team = also your reports' jobs, all = every job.
-- Scope is enforced where candidate personal data lives: applications (and, through
-- their RLS-filtered subqueries, applicant profiles, documents, notes and messages)
-- plus editing/closing jobs. Re-runnable.
-- ============================================================================

-- ── 1. Access mode + job sharing ────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'open' CHECK (access_mode IN ('open', 'scoped')),
  ADD COLUMN IF NOT EXISTS low_credit_threshold int NOT NULL DEFAULT 3 CHECK (low_credit_threshold >= 0);

CREATE TABLE IF NOT EXISTS public.job_members (
  job_id     uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access     text NOT NULL DEFAULT 'editor' CHECK (access IN ('viewer', 'editor', 'owner')),
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_job_members_user ON public.job_members (user_id);

-- need: 'read'   see the job's applicants
--       'work'   act on applicants (status, notes, messages)
--       'manage' edit / close the job itself
CREATE OR REPLACE FUNCTION public.employer_job_access(_user_id uuid, _job_id uuid, _need text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid; _posted_by uuid; _mode text; _scope text; _locked boolean; _jm text;
BEGIN
  SELECT j.company_id, j.posted_by, c.access_mode INTO _company, _posted_by, _mode
    FROM public.jobs j JOIN public.companies c ON c.id = j.company_id WHERE j.id = _job_id;
  IF _company IS NULL THEN RETURN false; END IF;

  SELECT r.scope, r.is_locked INTO _scope, _locked
    FROM public.employer_members m JOIN public.company_roles r ON r.id = m.role_id
   WHERE m.user_id = _user_id AND m.company_id = _company AND m.status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;

  IF _locked OR _scope = 'all' THEN RETURN true; END IF;
  IF _posted_by = _user_id THEN RETURN true; END IF;

  -- Open mode keeps today's rules: read/work on anything, manage only own jobs (or 'all' scope, handled above).
  IF _mode = 'open' AND _need IN ('read', 'work') THEN RETURN true; END IF;

  SELECT access INTO _jm FROM public.job_members WHERE job_id = _job_id AND user_id = _user_id;
  IF _jm IS NOT NULL THEN
    IF _need = 'read' THEN RETURN true; END IF;
    RETURN _jm IN ('editor', 'owner');
  END IF;

  IF _scope = 'team' AND _posted_by IS NOT NULL AND public.is_in_subtree(_company, _user_id, _posted_by) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.employer_job_access(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employer_job_access(uuid, uuid, text) TO authenticated, service_role;

-- Applications: permission + scope for employers; candidates keep their own rows.
DROP POLICY IF EXISTS "View applications" ON public.applications;
CREATE POLICY "View applications" ON public.applications FOR SELECT TO authenticated USING (
  auth.uid() = candidate_id
  OR (public.has_company_permission(auth.uid(), company_id, 'applicants.view')
      AND public.employer_job_access(auth.uid(), job_id, 'read'))
);

DROP POLICY IF EXISTS "Update applications" ON public.applications;
CREATE POLICY "Update applications" ON public.applications FOR UPDATE TO authenticated USING (
  auth.uid() = candidate_id
  OR (public.has_company_permission(auth.uid(), company_id, 'applicants.manage')
      AND public.employer_job_access(auth.uid(), job_id, 'work'))
);

-- Jobs: editing/closing needs the permission AND access to that job; drafts stay with their author.
DROP POLICY IF EXISTS "Authorized members can update jobs" ON public.jobs;
CREATE POLICY "Authorized members can update jobs" ON public.jobs FOR UPDATE TO authenticated
USING (
  public.has_platform_role(auth.uid(), 'super_admin')
  OR (public.has_company_permission(auth.uid(), company_id, 'jobs.edit')
      AND public.employer_job_access(auth.uid(), id, 'manage'))
  OR (posted_by = auth.uid() AND public.has_company_permission(auth.uid(), company_id, 'jobs.create'))
)
WITH CHECK (
  public.has_platform_role(auth.uid(), 'super_admin')
  OR (public.has_company_permission(auth.uid(), company_id, 'jobs.edit')
      AND public.employer_job_access(auth.uid(), id, 'manage'))
  OR (posted_by = auth.uid() AND public.has_company_permission(auth.uid(), company_id, 'jobs.create'))
);

DROP POLICY IF EXISTS "Authorized members can delete jobs" ON public.jobs;
CREATE POLICY "Authorized members can delete jobs" ON public.jobs FOR DELETE TO authenticated USING (
  public.has_platform_role(auth.uid(), 'super_admin')
  OR (public.has_company_permission(auth.uid(), company_id, 'jobs.close')
      AND public.employer_job_access(auth.uid(), id, 'manage'))
  OR (posted_by = auth.uid() AND status = 'draft'
      AND public.has_company_permission(auth.uid(), company_id, 'jobs.create'))
);

ALTER TABLE public.job_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job members visible" ON public.job_members;
CREATE POLICY "job members visible" ON public.job_members FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND public.employer_job_access(auth.uid(), j.id, 'read')
             AND public.has_company_membership(auth.uid(), j.company_id))
);
REVOKE ALL ON public.job_members FROM anon, authenticated;
GRANT SELECT ON public.job_members TO authenticated;
GRANT ALL ON public.job_members TO service_role;

CREATE OR REPLACE FUNCTION public.set_access_mode(_company_id uuid, _mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'roles.manage') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _mode NOT IN ('open', 'scoped') THEN RAISE EXCEPTION 'invalid_mode'; END IF;
  UPDATE public.companies SET access_mode = _mode WHERE id = _company_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.access_mode_changed', 'Job visibility changed',
    CASE _mode WHEN 'scoped' THEN 'Members now see only the jobs their role allows' ELSE 'Everyone can see every job''s applicants again' END,
    '/employer/team', jsonb_build_object('mode', _mode)
  );
END $$;

CREATE OR REPLACE FUNCTION public.share_job(_job_id uuid, _user_id uuid, _access text DEFAULT 'editor')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.jobs WHERE id = _job_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF _access NOT IN ('viewer', 'editor', 'owner') THEN RAISE EXCEPTION 'invalid_access'; END IF;
  -- Sharers must be able to manage the job themselves (owner / HR / editor of the job).
  IF NOT (public.has_company_permission(auth.uid(), _company, 'jobs.edit')
          AND public.employer_job_access(auth.uid(), _job_id, 'manage')) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF NOT public.has_company_membership(_user_id, _company) THEN RAISE EXCEPTION 'target_not_member'; END IF;
  INSERT INTO public.job_members (job_id, user_id, access, added_by) VALUES (_job_id, _user_id, _access, auth.uid())
    ON CONFLICT (job_id, user_id) DO UPDATE SET access = EXCLUDED.access;
  PERFORM public.log_employer_activity(
    _company, auth.uid(), 'job.shared', 'Job shared', 'A job was shared with a teammate', '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'user_id', _user_id, 'access', _access)
  );
END $$;

CREATE OR REPLACE FUNCTION public.unshare_job(_job_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.jobs WHERE id = _job_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT (public.has_company_permission(auth.uid(), _company, 'jobs.edit')
          AND public.employer_job_access(auth.uid(), _job_id, 'manage')) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  DELETE FROM public.job_members WHERE job_id = _job_id AND user_id = _user_id;
  PERFORM public.log_employer_activity(
    _company, auth.uid(), 'job.unshared', 'Job access removed', 'A teammate lost access to a job', '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'user_id', _user_id)
  );
END $$;

-- Offboarding: hand a leaver's jobs to someone else before (or after) revoking them.
CREATE OR REPLACE FUNCTION public.reassign_member_jobs(_company_id uuid, _from_user uuid, _to_user uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'team.remove') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _from_user = _to_user THEN RAISE EXCEPTION 'invalid_transfer'; END IF;
  IF NOT public.has_company_membership(_to_user, _company_id)
     OR NOT public.has_company_permission(_to_user, _company_id, 'jobs.create') THEN
    RAISE EXCEPTION 'target_cannot_own_jobs';
  END IF;
  UPDATE public.jobs SET posted_by = _to_user WHERE company_id = _company_id AND posted_by = _from_user;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM public.log_employer_activity(
      _company_id, auth.uid(), 'team.jobs_reassigned', 'Jobs reassigned',
      _n || ' job(s) moved to another teammate', '/employer/team',
      jsonb_build_object('from_user', _from_user, 'to_user', _to_user, 'count', _n)
    );
  END IF;
  RETURN _n;
END $$;

-- ── 2. Low-balance alerts (in-app notification to the member and their manager) ──
CREATE OR REPLACE FUNCTION public.tg_low_member_credits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _threshold int; _mgr uuid; _label text; _recent boolean; _target uuid;
BEGIN
  IF NEW.balance >= OLD.balance THEN RETURN NEW; END IF;
  SELECT low_credit_threshold INTO _threshold FROM public.companies WHERE id = NEW.company_id;
  IF _threshold IS NULL OR NEW.balance > _threshold OR OLD.balance <= _threshold THEN RETURN NEW; END IF;

  _label := CASE NEW.benefit_type WHEN 'job_post' THEN 'job post' WHEN 'contact' THEN 'contact unlock' ELSE 'boost' END;
  SELECT reports_to INTO _mgr FROM public.employer_members
   WHERE company_id = NEW.company_id AND user_id = NEW.user_id AND status = 'active';

  FOREACH _target IN ARRAY ARRAY[NEW.user_id, _mgr] LOOP
    CONTINUE WHEN _target IS NULL;
    SELECT EXISTS (
      SELECT 1 FROM public.notifications
       WHERE user_id = _target AND type = 'credits.low.' || NEW.benefit_type::text
         AND link = '/employer/team?tab=credits&u=' || NEW.user_id::text
         AND created_at > now() - interval '12 hours'
    ) INTO _recent;
    CONTINUE WHEN _recent;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _target, 'credits.low.' || NEW.benefit_type::text,
      CASE WHEN _target = NEW.user_id THEN 'You are running low on ' || _label || ' credits'
           ELSE 'A teammate is running low on ' || _label || ' credits' END,
      CASE WHEN _target = NEW.user_id THEN NEW.balance || ' left. Request more from your manager or an admin.'
           ELSE 'They have ' || NEW.balance || ' left. Top them up or approve their request.' END,
      '/employer/team?tab=credits&u=' || NEW.user_id::text
    );
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_low_member_credits ON public.member_credit_allocations;
CREATE TRIGGER trg_low_member_credits AFTER UPDATE OF balance ON public.member_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_low_member_credits();

CREATE OR REPLACE FUNCTION public.set_low_credit_threshold(_company_id uuid, _threshold int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.allocate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _threshold IS NULL OR _threshold < 0 OR _threshold > 1000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  UPDATE public.companies SET low_credit_threshold = _threshold WHERE id = _company_id;
END $$;

-- ── 3. Recurring top-up rules ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_topup_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  benefit_type   public.benefit_type NOT NULL,
  target_balance int NOT NULL CHECK (target_balance BETWEEN 1 AND 100000),
  cadence        text NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  next_run_at    timestamptz NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, benefit_type)
);
ALTER TABLE public.credit_topup_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topup rules visible" ON public.credit_topup_rules;
CREATE POLICY "topup rules visible" ON public.credit_topup_rules FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR public.has_company_permission(auth.uid(), company_id, 'credits.view_all')
);
REVOKE ALL ON public.credit_topup_rules FROM anon, authenticated;
GRANT SELECT ON public.credit_topup_rules TO authenticated;
GRANT ALL ON public.credit_topup_rules TO service_role;

CREATE OR REPLACE FUNCTION public.set_topup_rule(
  _company_id uuid, _user_id uuid, _benefit public.benefit_type, _target int, _cadence text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.has_company_permission(auth.uid(), _company_id, 'credits.allocate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _cadence NOT IN ('weekly', 'monthly') THEN RAISE EXCEPTION 'invalid_cadence'; END IF;
  IF NOT public.has_company_membership(_user_id, _company_id) THEN RAISE EXCEPTION 'target_not_member'; END IF;
  IF NOT public.has_company_permission(_user_id, _company_id, public.benefit_spend_permission(_benefit)) THEN
    RAISE EXCEPTION 'target_cannot_spend';
  END IF;
  INSERT INTO public.credit_topup_rules (company_id, user_id, benefit_type, target_balance, cadence, next_run_at, created_by)
    VALUES (_company_id, _user_id, _benefit, _target, _cadence, now(), auth.uid())
    ON CONFLICT (company_id, user_id, benefit_type)
    DO UPDATE SET target_balance = EXCLUDED.target_balance, cadence = EXCLUDED.cadence, active = true,
                  next_run_at = LEAST(public.credit_topup_rules.next_run_at, now()), created_by = auth.uid()
    RETURNING id INTO _id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.topup_rule_set', 'Top-up rule saved',
    'Keep a teammate at ' || _target || ' ' || _benefit::text || ' credits, ' || _cadence, '/employer/team',
    jsonb_build_object('rule_id', _id, 'user_id', _user_id, 'benefit', _benefit, 'target', _target, 'cadence', _cadence)
  );
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_topup_rule(_rule_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.credit_topup_rules%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.credit_topup_rules WHERE id = _rule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'rule_not_found'; END IF;
  IF NOT public.has_company_permission(auth.uid(), _r.company_id, 'credits.allocate') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  DELETE FROM public.credit_topup_rules WHERE id = _rule_id;
END $$;

-- Scheduler entry point: tops each due member up to their target from the pool (partial when the pool is short).
CREATE OR REPLACE FUNCTION public.run_credit_topups()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _have int; _short int; _give int; _pool int; _done int := 0; _period text;
BEGIN
  FOR _r IN
    SELECT t.* FROM public.credit_topup_rules t
      JOIN public.companies c ON c.id = t.company_id
     WHERE t.active AND t.next_run_at <= now() AND c.credit_mode = 'allocated'
     ORDER BY t.next_run_at
     FOR UPDATE OF t SKIP LOCKED
  LOOP
    _period := to_char(_r.next_run_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');  -- the exact schedule slot, so overlapping runs cannot double-pay one slot
    IF public.has_company_membership(_r.user_id, _r.company_id)
       AND public.has_company_permission(_r.user_id, _r.company_id, public.benefit_spend_permission(_r.benefit_type)) THEN
      SELECT COALESCE(balance, 0) INTO _have FROM public.member_credit_allocations
       WHERE company_id = _r.company_id AND user_id = _r.user_id AND benefit_type = _r.benefit_type;
      _have := COALESCE(_have, 0);
      _short := _r.target_balance - _have;
      IF _short > 0 THEN
        _pool := public.pool_available(_r.company_id, _r.benefit_type);
        _give := LEAST(_short, _pool);
        IF _give > 0 THEN
          PERFORM public.move_member_credits(_r.company_id, NULL, _r.user_id, _r.benefit_type, _give, 'allocate',
            _r.created_by, 'topup:' || _r.id::text || ':' || _period, jsonb_build_object('rule_id', _r.id));
          PERFORM public.log_employer_activity(
            _r.company_id, _r.created_by, 'credits.topped_up', 'Credits topped up automatically',
            _give || ' ' || _r.benefit_type::text || ' credits added by a recurring rule', '/employer/team',
            jsonb_build_object('rule_id', _r.id, 'user_id', _r.user_id, 'qty', _give));
          _done := _done + 1;
        END IF;
      END IF;
    END IF;
    UPDATE public.credit_topup_rules
       SET next_run_at = CASE cadence WHEN 'weekly' THEN next_run_at + interval '7 days' ELSE next_run_at + interval '1 month' END
     WHERE id = _r.id;
    -- never leave a rule in the past after downtime: catch up to the next future slot
    UPDATE public.credit_topup_rules
       SET next_run_at = now() + CASE cadence WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END
     WHERE id = _r.id AND next_run_at <= now();
  END LOOP;
  RETURN _done;
END $$;
REVOKE ALL ON FUNCTION public.run_credit_topups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_credit_topups() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'credit-topups';
    PERFORM cron.schedule('credit-topups', '10 * * * *', 'SELECT public.run_credit_topups();');
  END IF;
END $$;

-- ── 4. Usage export ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_credit_movements(_company_id uuid, _days int DEFAULT 90)
RETURNS TABLE (
  created_at timestamptz, event text, benefit_type public.benefit_type, qty int,
  from_name text, to_name text, actor_name text, reference jsonb
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.can_view_company_credits(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  RETURN QUERY
  SELECT l.created_at, l.event, l.benefit_type, l.qty,
         COALESCE(pf.full_name, pf.email, CASE WHEN l.from_user IS NULL THEN 'Company pool' ELSE 'Former member' END),
         COALESCE(pt.full_name, pt.email, CASE WHEN l.to_user IS NULL THEN 'Company pool / used' ELSE 'Former member' END),
         COALESCE(pa.full_name, pa.email, 'System'),
         l.reference
    FROM public.member_credit_ledger l
    LEFT JOIN public.profiles pf ON pf.id = l.from_user
    LEFT JOIN public.profiles pt ON pt.id = l.to_user
    LEFT JOIN public.profiles pa ON pa.id = l.actor
   WHERE l.company_id = _company_id AND l.created_at > now() - make_interval(days => LEAST(GREATEST(_days, 1), 730))
   ORDER BY l.created_at DESC
   LIMIT 20000;
END $$;

-- ── 5. Seat limits ──────────────────────────────────────────
-- plans.limits.team_seats_max: -1 or missing = unlimited. Values below are starting points; edit in the plans admin.
UPDATE public.plans SET limits = limits || '{"team_seats_max": 5}'::jsonb
 WHERE name = 'Basic' AND is_custom = false AND NOT (limits ? 'team_seats_max');
UPDATE public.plans SET limits = limits || '{"team_seats_max": 25}'::jsonb
 WHERE name = 'Regular' AND is_custom = false AND NOT (limits ? 'team_seats_max');
UPDATE public.plans SET limits = limits || '{"team_seats_max": -1}'::jsonb
 WHERE name = 'Unlimited' AND is_custom = false AND NOT (limits ? 'team_seats_max');

CREATE OR REPLACE FUNCTION public.company_seat_limit(_company_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (p.limits ->> 'team_seats_max')::int
       FROM public.company_plans cp JOIN public.plans p ON p.id = cp.plan_id
      WHERE cp.company_id = _company_id AND cp.status = 'active' AND (cp.ends_at IS NULL OR cp.ends_at > now())
      LIMIT 1),
    (SELECT (p.limits ->> 'team_seats_max')::int FROM public.plans p WHERE p.name = 'Basic' AND p.is_custom = false ORDER BY p.created_at LIMIT 1),
    -1);
$$;

CREATE OR REPLACE FUNCTION public.team_seat_status(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _used int; _pending int;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  SELECT count(*) INTO _used FROM public.employer_members WHERE company_id = _company_id AND status = 'active';
  SELECT count(*) INTO _pending FROM public.employer_invites WHERE company_id = _company_id AND accepted_at IS NULL AND expires_at > now();
  RETURN jsonb_build_object('used', _used, 'pending', _pending, 'max', public.company_seat_limit(_company_id));
END $$;

CREATE OR REPLACE FUNCTION public.assert_seat_available(_company_id uuid, _count_pending boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _max int; _used int;
BEGIN
  _max := public.company_seat_limit(_company_id);
  IF _max IS NULL OR _max < 0 THEN RETURN; END IF;
  SELECT count(*) INTO _used FROM public.employer_members WHERE company_id = _company_id AND status = 'active';
  IF _count_pending THEN
    _used := _used + (SELECT count(*) FROM public.employer_invites
                       WHERE company_id = _company_id AND accepted_at IS NULL AND expires_at > now());
  END IF;
  IF _used >= _max THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_seat_available(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_seat_available(uuid, boolean) TO service_role;


-- ── 6. Seat limits enforced where members are added ─────────
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
  PERFORM public.assert_seat_available(_company_id, true);

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

  IF COALESCE(_existing_status, '') <> 'active' THEN
    PERFORM public.assert_seat_available(_inv.company_id, false);
  END IF;

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
  PERFORM public.assert_seat_available(_company_id, false);
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

-- ── 7. Privileges ───────────────────────────────────────────
DO $$
DECLARE _sig text;
BEGIN
  FOREACH _sig IN ARRAY ARRAY[
    'public.set_access_mode(uuid, text)',
    'public.share_job(uuid, uuid, text)',
    'public.unshare_job(uuid, uuid)',
    'public.reassign_member_jobs(uuid, uuid, uuid)',
    'public.set_low_credit_threshold(uuid, int)',
    'public.set_topup_rule(uuid, uuid, public.benefit_type, int, text)',
    'public.delete_topup_rule(uuid)',
    'public.member_credit_movements(uuid, int)',
    'public.team_seat_status(uuid)',
    'public.create_employer_invite(uuid, text, uuid)',
    'public.accept_invite(text)',
    'public.reactivate_member(uuid, uuid, public.employer_role)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _sig);
  END LOOP;
END $$;

-- ── 8. Team settings for the UI ─────────────────────────────
-- `companies` is protected by column-level grants, so the new settings columns are exposed through
-- a membership-gated function rather than widening the table grant.
CREATE OR REPLACE FUNCTION public.company_team_settings(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
  SELECT jsonb_build_object(
           'name', c.name, 'access_mode', c.access_mode,
           'credit_mode', c.credit_mode, 'low_credit_threshold', c.low_credit_threshold)
    INTO _r FROM public.companies c WHERE c.id = _company_id;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.company_team_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_team_settings(uuid) TO authenticated;

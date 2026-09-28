-- ============================================================
-- Phase 1: Multi-User Recruiter System Edge Cases & Data Ownership
-- ============================================================
-- 
-- Changes:
--   1. Soft-delete for employer_members (status, revoked_at, revoked_by)
--   2. Update helper functions to check status = 'active'
--   3. Replace remove_member() with soft-revoke + audit log
--   4. Add reactivate_member() RPC for Super Admins
--   5. Update accept_invite() to reactivate previously revoked members
--   6. Add tg_members_revoked trigger for audit logging on soft-delete
--   7. Add actor attribution index on employer_activity
-- ============================================================

-- ── 1. Add soft-delete columns to employer_members ──────────
ALTER TABLE public.employer_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for fast active-member lookups (the hot path)
CREATE INDEX IF NOT EXISTS idx_employer_members_active
  ON public.employer_members(company_id, user_id)
  WHERE status = 'active';

-- ── 2. Update helper functions to respect status = 'active' ──
CREATE OR REPLACE FUNCTION public.has_company_membership(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(_user_id uuid, _company_id uuid, _role public.employer_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id AND role = _role AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_companies(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.employer_members
  WHERE user_id = _user_id AND status = 'active';
$$;

-- ── 3. Replace remove_member() — hard DELETE → soft revoke ──
CREATE OR REPLACE FUNCTION public.remove_member(_company_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admins int; _is_admin boolean; _name text;
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can revoke members';
  END IF;
  -- Check if this member is a super_admin (only active super_admins count)
  SELECT (role = 'super_admin') INTO _is_admin FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF _is_admin THEN
    SELECT count(*) INTO _admins FROM public.employer_members
      WHERE company_id = _company_id AND role = 'super_admin' AND status = 'active';
    IF _admins <= 1 THEN
      RAISE EXCEPTION 'Cannot revoke the last super admin';
    END IF;
  END IF;
  -- Soft revoke instead of hard delete
  UPDATE public.employer_members
    SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found or already revoked';
  END IF;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.revoked', 'Team member access revoked',
    COALESCE(_name, 'A teammate') || '''s access was revoked', '/employer/team',
    jsonb_build_object('user_id', _user_id, 'revoked_by', auth.uid())
  );
END $$;

-- ── 4. New: reactivate_member() — Super Admin restores a revoked member ──
CREATE OR REPLACE FUNCTION public.reactivate_member(_company_id uuid, _user_id uuid, _role public.employer_role DEFAULT 'recruiter')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can reactivate members';
  END IF;
  UPDATE public.employer_members
    SET status = 'active', revoked_at = NULL, revoked_by = NULL, role = _role
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'revoked';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No revoked member found to reactivate';
  END IF;
  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.reactivated', 'Team member access restored',
    COALESCE(_name, 'A teammate') || ' was reactivated as ' || _role::text, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role', _role)
  );
END $$;

REVOKE ALL ON FUNCTION public.reactivate_member(uuid, uuid, public.employer_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_member(uuid, uuid, public.employer_role) TO authenticated;

-- ── 5. Update accept_invite() to handle previously revoked members ──
CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv public.employer_invites%ROWTYPE;
  _uid uuid := auth.uid();
  _name text;
  _existing_status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.employer_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;

  -- Check if user has an existing (possibly revoked) membership
  SELECT status INTO _existing_status FROM public.employer_members
    WHERE user_id = _uid AND company_id = _inv.company_id;

  IF _existing_status = 'revoked' THEN
    -- Reactivate revoked membership with new role from invite
    UPDATE public.employer_members
      SET status = 'active', role = _inv.role, revoked_at = NULL, revoked_by = NULL
      WHERE user_id = _uid AND company_id = _inv.company_id;
  ELSE
    -- Insert new membership (or update role if already active — shouldn't happen normally)
    INSERT INTO public.employer_members (user_id, company_id, role)
      VALUES (_uid, _inv.company_id, _inv.role)
      ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';
  END IF;

  UPDATE public.employer_invites SET accepted_at = now(), accepted_by = _uid WHERE id = _inv.id;

  SELECT full_name INTO _name FROM public.profiles WHERE id = _uid;
  PERFORM public.log_employer_activity(
    _inv.company_id, _uid, 'team.joined',
    'Teammate joined',
    COALESCE(_name, 'A teammate') || ' joined as ' || _inv.role::text,
    '/employer/team',
    jsonb_build_object('user_id', _uid, 'role', _inv.role, 'invite_id', _inv.id)
  );

  RETURN _inv.company_id;
END; $$;

-- ── 6. Update update_member_role() to guard against revoked members ──
CREATE OR REPLACE FUNCTION public.update_member_role(_company_id uuid, _user_id uuid, _role public.employer_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _is_admin boolean; _admins int;
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change roles';
  END IF;
  SELECT (role = 'super_admin') INTO _is_admin FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF _is_admin AND _role <> 'super_admin' THEN
    SELECT count(*) INTO _admins FROM public.employer_members
      WHERE company_id = _company_id AND role = 'super_admin' AND status = 'active';
    IF _admins <= 1 THEN RAISE EXCEPTION 'Cannot demote the last super admin'; END IF;
  END IF;
  UPDATE public.employer_members SET role = _role
    WHERE user_id = _user_id AND company_id = _company_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active member not found';
  END IF;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_changed',
    'Role updated', 'Member role set to ' || _role::text, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role', _role)
  );
END $$;

-- ── 7. Update the members_joined trigger to only fire on new active inserts
--       (not on reactivation updates — those are handled by accept_invite)
DROP TRIGGER IF EXISTS members_joined ON public.employer_members;
CREATE OR REPLACE FUNCTION public.tg_members_joined()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  -- Only log for fresh inserts of active members; reactivations log their own event
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    SELECT full_name INTO _name FROM public.profiles WHERE id = NEW.user_id;
    PERFORM public.log_employer_activity(
      NEW.company_id, NEW.user_id, 'team.joined',
      'Teammate joined', COALESCE(_name,'A teammate') || ' joined as ' || NEW.role::text,
      '/employer/team',
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role)
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER members_joined AFTER INSERT ON public.employer_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_members_joined();

-- ── 8. Grant execute on updated functions ──
GRANT EXECUTE ON FUNCTION public.has_company_membership(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.employer_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_companies(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_role(uuid, uuid, public.employer_role) TO authenticated;

-- ── 9. ActivityFeed: add actor_name denormalised for performance ──
-- The UI joins profiles.full_name via actor_id on the fly, so no schema
-- change is needed here — the SELECT in activity.tsx will be updated.
-- Add a partial index to help join performance.
CREATE INDEX IF NOT EXISTS idx_employer_activity_actor
  ON public.employer_activity(actor_id)
  WHERE actor_id IS NOT NULL;

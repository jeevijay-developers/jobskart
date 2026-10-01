-- accept_invite() lets any authenticated user accept any valid, unexpired,
-- unaccepted invite token — there's no hard check that the accepting
-- identity matches the invited email (mobile-OTP accounts have no inherent
-- link to an email address, so hard-blocking would break legitimate cases).
-- This keeps that permissive behavior but logs the invited email alongside
-- the accepting profile's email in the activity entry, so a mismatch is
-- visible in the audit trail (employer_activity) instead of silently invisible.
CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _inv public.employer_invites%ROWTYPE;
  _uid uuid := auth.uid();
  _name text;
  _accepting_email text;
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

  SELECT full_name, email INTO _name, _accepting_email FROM public.profiles WHERE id = _uid;
  PERFORM public.log_employer_activity(
    _inv.company_id, _uid, 'team.joined',
    'Teammate joined',
    COALESCE(_name, 'A teammate') || ' joined as ' || _inv.role::text,
    '/employer/team',
    jsonb_build_object(
      'user_id', _uid, 'role', _inv.role, 'invite_id', _inv.id,
      'invited_email', _inv.email,
      'accepting_email', _accepting_email,
      'identity_mismatch', lower(coalesce(_accepting_email, '')) <> lower(_inv.email)
    )
  );

  RETURN _inv.company_id;
END; $$;

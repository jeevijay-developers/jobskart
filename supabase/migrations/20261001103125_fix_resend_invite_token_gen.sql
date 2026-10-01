-- resend_employer_invite() generated its rotated token with
-- encode(gen_random_bytes(24), 'hex') — a pgcrypto function. pgcrypto is
-- never CREATE EXTENSION'd anywhere in this project's migrations, and even
-- if it were, Supabase installs extensions into the `extensions` schema
-- while this function's SET search_path = public wouldn't see it there.
-- Result: every "Resend invite" click raised
-- 'function gen_random_bytes(integer) does not exist'.
--
-- The original invite's token (employer_invites.token column default) is
-- generated with replace(gen_random_uuid()::text, '-', '') — gen_random_uuid()
-- is a Postgres core builtin (PG13+), no extension required. Reuse that same
-- approach here so resend doesn't depend on an extension that was never set up.
CREATE OR REPLACE FUNCTION public.resend_employer_invite(_company_id uuid, _invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _is_authorized boolean;
  _inv public.employer_invites%ROWTYPE;
  _new_token text;
  _new_expiry timestamptz;
BEGIN
  _is_authorized := public.has_company_role(auth.uid(), _company_id, 'super_admin')
                 OR public.has_company_role(auth.uid(), _company_id, 'hr_admin');
  IF NOT _is_authorized THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT * INTO _inv FROM public.employer_invites
    WHERE id = _invite_id AND company_id = _company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF _inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot resend an invite that has already been accepted';
  END IF;

  _new_token := replace(gen_random_uuid()::text, '-', '');
  _new_expiry := now() + interval '7 days';

  UPDATE public.employer_invites
    SET token = _new_token, expires_at = _new_expiry
    WHERE id = _invite_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.invite_resent',
    'Invitation resent',
    'Invitation for ' || _inv.email || ' was refreshed',
    '/employer/team',
    jsonb_build_object('invite_id', _invite_id, 'email', _inv.email)
  );

  RETURN jsonb_build_object(
    'id', _invite_id,
    'email', _inv.email,
    'token', _new_token,
    'expires_at', _new_expiry
  );
END;
$$;

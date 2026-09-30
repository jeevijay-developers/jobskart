-- Recover a company whose only member was accidentally soft-revoked by the
-- previous direct client-side update path. Normal restores remain restricted
-- to an active super admin; this exception is only for the same revoked
-- super-admin row when the company has no active memberships at all.
CREATE OR REPLACE FUNCTION public.reactivate_member(
  _company_id uuid,
  _user_id uuid,
  _role public.employer_role DEFAULT 'recruiter'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _existing_role public.employer_role;
  _has_active_members boolean;
BEGIN
  SELECT role
    INTO _existing_role
    FROM public.employer_members
   WHERE user_id = _user_id
     AND company_id = _company_id
     AND status = 'revoked'
   FOR UPDATE;

  IF _existing_role IS NULL THEN
    RAISE EXCEPTION 'No revoked member found to reactivate';
  END IF;

  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.employer_members
       WHERE company_id = _company_id
         AND status = 'active'
    )
      INTO _has_active_members;

    IF auth.uid() IS DISTINCT FROM _user_id
       OR _existing_role <> 'super_admin'
       OR _has_active_members THEN
      RAISE EXCEPTION 'Only super admins can reactivate members';
    END IF;
  END IF;

  UPDATE public.employer_members
     SET status = 'active',
         revoked_at = NULL,
         revoked_by = NULL
   WHERE user_id = _user_id
     AND company_id = _company_id
     AND status = 'revoked';

  SELECT full_name INTO _name FROM public.profiles WHERE id = _user_id;
  PERFORM public.log_employer_activity(
    _company_id,
    auth.uid(),
    'team.reactivated',
    'Team member access restored',
    COALESCE(_name, 'A teammate') || ' was reactivated as ' || _existing_role::text,
    '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role', _existing_role)
  );
END;
$$;

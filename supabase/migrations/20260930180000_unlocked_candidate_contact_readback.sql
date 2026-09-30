-- CallLogDrawer's "unlocked lead, no job context" path (source = 'unlock' with
-- no jobId) has never worked: it queried candidate_unlocks for a "mobile"
-- column that doesn't exist, using a "candidate_id" column that doesn't exist
-- either (the real column is candidate_user_id) — and even fixed, profiles
-- RLS has no policy letting an employer read a non-applicant candidate's row.
--
-- This is a pure read-back of contact info the company has ALREADY paid to
-- unlock (rule 3: masked-column RPC, never a direct client join). It never
-- charges anything — reusing unlock_candidate() here would be wrong, since
-- it re-validates the *job*'s active status before its "already unlocked"
-- short-circuit, and legacy/closed-job unlocks would then fail outright.
CREATE OR REPLACE FUNCTION public.get_unlocked_candidate_contact(
  _company_id uuid,
  _candidate_user_id uuid
) RETURNS TABLE (mobile text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_unlocks
    WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.mobile, p.email FROM public.profiles p WHERE p.id = _candidate_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unlocked_candidate_contact(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unlocked_candidate_contact(uuid, uuid) TO authenticated;

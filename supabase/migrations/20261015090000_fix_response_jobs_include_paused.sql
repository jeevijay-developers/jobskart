-- Fix: Employer Responses page showed "Inbox N" / status chip counts
-- correctly, but the candidate cards area was empty whenever those
-- applications sat on a job with status = 'paused' (or 'draft').
--
-- Root cause: get_employer_response_jobs() (20261011140000_responses_
-- grouped_by_job.sql) only ever returned jobs with status = 'active' (or
-- 'closed' when _include_closed is explicitly true, which the frontend
-- never passes) — so a paused job's applications never appeared as a card,
-- even though get_employer_response_status_counts() counts applications
-- across every job status with no such restriction, producing a visible
-- contradiction: a nonzero Inbox count with zero cards rendered.
--
-- Fix: also include jobs with status = 'paused' by default — pausing a job
-- is a normal, frequent action that does not delete or hide its existing
-- applications, so its responses must stay visible. 'draft' jobs are still
-- excluded (a draft is unpublished and should never have real applications
-- in practice), and the _include_closed behavior is unchanged.
--
-- Only this one WHERE clause changes; no other logic in the function is
-- touched. Function signature is unchanged, so CREATE OR REPLACE is enough
-- (no DROP FUNCTION needed, unlike the original migration which was
-- replacing a different signature).

CREATE OR REPLACE FUNCTION public.get_employer_response_jobs(
  _company_id uuid,
  _status text DEFAULT NULL,
  _query text DEFAULT NULL,
  _include_closed boolean DEFAULT false
) RETURNS TABLE (
  job_id uuid,
  job_title text,
  job_status text,
  job_created_at timestamptz,
  applicant_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _term text := NULLIF(btrim(_query), '');
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  RETURN QUERY
  SELECT
    j.id,
    j.title,
    j.status,
    j.created_at,
    count(a.id)
  FROM public.jobs j
  LEFT JOIN public.applications a
    ON a.job_id = j.id
    AND (_status IS NULL OR a.status = _status::public.application_status)
    AND (
      _term IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = a.candidate_id AND p.full_name ILIKE ('%' || _term || '%')
      )
    )
  WHERE j.company_id = _company_id
    AND (
      j.status IN ('active', 'paused')
      OR (_include_closed AND j.status = 'closed')
    )
  GROUP BY j.id, j.title, j.status, j.created_at
  HAVING count(a.id) > 0 OR _term IS NULL
  ORDER BY j.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_response_jobs(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_response_jobs(uuid, text, text, boolean) TO authenticated;

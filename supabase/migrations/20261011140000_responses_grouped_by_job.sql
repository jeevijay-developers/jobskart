-- Point 22: Employer Responses page overhaul. The Inbox tab moves from one
-- flat cross-job table to per-job cards (job dropdown + search + status all
-- combine, server-side). Two RPCs replace the old client-built
-- applications/jobs!inner query:
--
--   1. get_employer_response_jobs(): one row per job (title, status,
--      created_at, matching-applicant count) for the job dropdown AND the
--      per-job card headers, already filtered by the same name/status
--      filters as the applicant rows so counts stay in sync.
--   2. get_employer_job_responses(): one page of applications for exactly
--      one job (used both for a card's first page and its "Show more").
--
-- Splitting into two keeps each query simple (no per-job LIMIT/OFFSET window
-- function needed) while still avoiding N+1: one call loads every card's
-- header + count, and each visible card's row page is its own fast,
-- job_id-indexed query (idx_apps_job already covers it).

-- pg_trgm: ILIKE name search on profiles.full_name is currently a sequential
-- scan. Candidate counts are still small enough that this is optional for
-- correctness, but the trigram index keeps search snappy as data grows and
-- is required for the GIN index below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);

-- Composite covering the new per-job, per-status browse pattern. idx_apps_job
-- (job_id, created_at DESC) already exists and still serves the "All status"
-- case; this one additionally helps when a status chip is selected.
CREATE INDEX IF NOT EXISTS idx_apps_job_status_created
  ON public.applications(job_id, status, created_at DESC);

DROP FUNCTION IF EXISTS public.get_employer_response_jobs(uuid, text, text, boolean);

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
      j.status = 'active'
      OR (_include_closed AND j.status = 'closed')
    )
  GROUP BY j.id, j.title, j.status, j.created_at
  HAVING count(a.id) > 0 OR _term IS NULL
  ORDER BY j.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_response_jobs(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_response_jobs(uuid, text, text, boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.get_employer_job_responses(uuid, uuid, text, text, int, int);

CREATE OR REPLACE FUNCTION public.get_employer_job_responses(
  _company_id uuid,
  _job_id uuid,
  _status text DEFAULT NULL,
  _query text DEFAULT NULL,
  _limit int DEFAULT 10,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  status text,
  created_at timestamptz,
  candidate_id uuid,
  cover_note text,
  expected_salary integer,
  available_from date,
  job_title text,
  full_name text,
  email text,
  city text,
  avatar_url text,
  mobile text,
  total_count bigint
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
    a.id, a.status::text, a.created_at, a.candidate_id,
    a.cover_note, a.expected_salary, a.available_from,
    j.title, p.full_name, p.email, p.city, p.avatar_url, p.mobile,
    count(*) OVER()
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  JOIN public.profiles p ON p.id = a.candidate_id
  WHERE a.job_id = _job_id
    AND j.company_id = _company_id
    AND (_status IS NULL OR a.status = _status::public.application_status)
    AND (_term IS NULL OR p.full_name ILIKE ('%' || _term || '%'))
  ORDER BY a.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_job_responses(uuid, uuid, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_job_responses(uuid, uuid, text, text, int, int) TO authenticated;

-- 3. get_employer_response_status_counts(): the status chip bar needs every
-- status's count at once (not just the currently-selected one), scoped to
-- the selected job (or all jobs) and the current search term.
DROP FUNCTION IF EXISTS public.get_employer_response_status_counts(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.get_employer_response_status_counts(
  _company_id uuid,
  _job_id uuid DEFAULT NULL,
  _query text DEFAULT NULL
) RETURNS TABLE (
  status text,
  n bigint
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
  SELECT a.status::text, count(*)
  FROM public.applications a
  JOIN public.jobs j ON j.id = a.job_id
  WHERE j.company_id = _company_id
    AND (_job_id IS NULL OR a.job_id = _job_id)
    AND (
      _term IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = a.candidate_id AND p.full_name ILIKE ('%' || _term || '%')
      )
    )
  GROUP BY a.status;
END;
$$;

REVOKE ALL ON FUNCTION public.get_employer_response_status_counts(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employer_response_status_counts(uuid, uuid, text) TO authenticated;

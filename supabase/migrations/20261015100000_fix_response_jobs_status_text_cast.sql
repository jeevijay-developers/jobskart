-- Fix: calling get_employer_response_jobs() failed with
-- "structure of query does not match function result type" — confirmed via
-- the live function's own error at call time, after 20261015090000 (the
-- paused-job fix) was applied through the Supabase SQL Editor.
--
-- Root cause (distinct from, and pre-existing before, the paused-job fix):
-- jobs.status is the Postgres enum type public.job_status
-- ('draft','active','paused','closed','expired' —
-- 20260617111751_...sql:7,37), but the function's RETURNS TABLE declares
-- `job_status text`. The RETURN QUERY SELECT list selected `j.status`
-- directly (the bare enum value) with no cast to text, so its structural
-- type didn't match the declared return column type — Postgres checks this
-- at RETURN QUERY execution time, not at CREATE FUNCTION time, so the
-- original 20261011140000 migration applied without error but had always
-- been broken for this column; the paused-job fix (20261015090000)
-- preserved that pre-existing defect untouched, it did not introduce it.
--
-- The two sibling functions in the same original migration already cast
-- their own status column this same way — get_employer_job_responses casts
-- `a.status::text` (line 128) and get_employer_response_status_counts
-- casts `a.status::text` (line 172) — this fix makes
-- get_employer_response_jobs consistent with both.
--
-- Only `j.status` in the SELECT list changes, to `j.status::text`.
-- GROUP BY j.status is left on the un-cast enum column (GROUP BY has no
-- return-type constraint; only the final SELECT list's types must match
-- RETURNS TABLE), so grouping behavior is unaffected. No other line
-- changes: authorization check, SECURITY DEFINER, search_path, the
-- paused-job WHERE clause, and the REVOKE/GRANT are all unchanged.

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
    j.status::text,
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

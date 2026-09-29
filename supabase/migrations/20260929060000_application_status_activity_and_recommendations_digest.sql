-- ============================================================
-- Closes two remaining gaps from
-- recruiter_system_and_recommendations_plan.md:
--
--   1. Phase 1.2 audit trail gap: application status changes made
--      by recruiters (shortlist/interview/reject/hire) never wrote
--      to employer_activity — only to the candidate-facing
--      application_status_history. Add a trigger that logs
--      'application.status_changed' when the actor is a company
--      member.
--   2. Phase 2.4 "Active Hiring Intelligence" dashboard summary:
--      get_recommended_candidates_digest() aggregates recommended
--      (non-applied, non-dismissed) candidates across a company's
--      active jobs so the employer dashboard can show a single
--      "N candidates matched today" widget without N per-job calls.
-- ============================================================

-- ── 1. application.status_changed → employer_activity ───────
CREATE OR REPLACE FUNCTION public.tg_applications_status_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _candidate_name text;
  _job_title text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND public.has_company_membership(auth.uid(), NEW.company_id) THEN
    SELECT full_name INTO _candidate_name FROM public.profiles WHERE id = NEW.candidate_id;
    SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
    PERFORM public.log_employer_activity(
      NEW.company_id, auth.uid(), 'application.status_changed',
      'Application status updated',
      COALESCE(_candidate_name, 'A candidate') || ' moved to ' || NEW.status
        || ' for "' || COALESCE(_job_title, 'a job') || '"',
      '/employer/jobs/' || NEW.job_id::text || '/applicants',
      jsonb_build_object(
        'application_id', NEW.id, 'candidate_id', NEW.candidate_id, 'job_id', NEW.job_id,
        'from_status', OLD.status, 'to_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS applications_status_activity ON public.applications;
CREATE TRIGGER applications_status_activity AFTER UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_applications_status_activity();

-- ── 2. get_recommended_candidates_digest() — dashboard summary ──
CREATE OR REPLACE FUNCTION public.get_recommended_candidates_digest(_company_id uuid)
RETURNS TABLE (
  total_matches   int,
  hot_count       int,
  nearby_count    int,
  active_count    int,
  top_job_id      uuid,
  top_job_title   text,
  top_job_matches int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  RETURN QUERY
  WITH active_jobs AS (
    SELECT j.id, j.title
    FROM public.jobs j
    WHERE j.company_id = _company_id AND j.status = 'active'
    ORDER BY j.created_at DESC
    LIMIT 8
  ),
  scored AS (
    SELECT
      aj.id AS job_id,
      aj.title AS job_title,
      cp.user_id,
      public.compute_candidate_match(cp.user_id, aj.id, true) AS result
    FROM active_jobs aj
    JOIN public.candidate_profiles cp ON cp.onboarding_completed = true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = aj.id AND a.candidate_id = cp.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.job_candidate_dismissals d
      WHERE d.job_id = aj.id AND d.candidate_user_id = cp.user_id
    )
  ),
  filtered AS (
    SELECT s.*, (s.result->>'score')::int AS score, s.result->'tags' AS tags
    FROM scored s
    WHERE (s.result->>'score')::int >= 40
  ),
  per_job AS (
    SELECT job_id, job_title, count(*) AS matches
    FROM filtered
    GROUP BY job_id, job_title
    ORDER BY matches DESC
    LIMIT 1
  )
  SELECT
    (SELECT count(DISTINCT user_id) FROM filtered)::int,
    (SELECT count(DISTINCT user_id) FROM filtered WHERE tags ? 'Hot Profile')::int,
    (SELECT count(DISTINCT user_id) FROM filtered WHERE tags ? 'Nearby Candidate')::int,
    (SELECT count(DISTINCT user_id) FROM filtered WHERE tags ? 'Recently Active')::int,
    per_job.job_id,
    per_job.job_title,
    per_job.matches::int
  FROM (SELECT 1) AS _one
  LEFT JOIN per_job ON true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recommended_candidates_digest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recommended_candidates_digest(uuid) TO authenticated;

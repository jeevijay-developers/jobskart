-- ============================================================
-- job-discovery-hiring-notification-implementation-plan.md — P0 backlog:
--
--   1. update_application_status() — guarded, membership-checked RPC
--      replacing direct browser `.update({status})` writes on
--      `applications`, enforcing the existing application_status enum
--      as a state machine (no transitions out of hired/rejected).
--   2. mark_application_viewed() — "HR viewed" as a first-view EVENT
--      (not a competing status), reusing the already-existing but
--      unused `applications.viewed_by_employer_at` column. Sends one
--      candidate notification on first view only.
--   3. feed_jobs_for_candidate() — the "Recommended for you" sort now
--      blends in compute_candidate_match() (skills/location/experience/
--      salary + activity/intent/proximity bonuses, all computed against
--      the CANDIDATE's own profile — same engine already used for the
--      candidate's own match badge and the employer-side recommendation
--      feature) instead of ranking purely by boost/freshness/quality.
--      Paid placement (boost) is capped so it can only act as a modest
--      tiebreaker, never override relevance. Other sorts (newest/oldest/
--      salary_*) are unaffected — match_score/matched_skills are simply
--      additional columns for the UI to explain "why this job".
-- ============================================================

-- ── 1. update_application_status() ───────────────────────────
CREATE OR REPLACE FUNCTION public.update_application_status(
  _application_ids uuid[],
  _status public.application_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bad_count int;
BEGIN
  IF _status NOT IN ('applied', 'shortlisted', 'interview', 'hired', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF _application_ids IS NULL OR array_length(_application_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Every targeted application must (a) belong to a company the caller is an
  -- active member of, and (b) not already be in a terminal state unless the
  -- requested status is a no-op — a single bad row fails the whole batch so
  -- a bulk action can never partially apply across a mix of permitted and
  -- forbidden rows.
  SELECT count(*) INTO _bad_count
  FROM public.applications a
  WHERE a.id = ANY(_application_ids)
    AND (
      NOT public.has_company_membership(auth.uid(), a.company_id)
      OR (a.status IN ('hired', 'rejected') AND a.status <> _status)
    );
  IF _bad_count > 0 THEN
    RAISE EXCEPTION 'insufficient_permissions_or_invalid_transition';
  END IF;

  IF (SELECT count(*) FROM public.applications WHERE id = ANY(_application_ids)) <> array_length(_application_ids, 1) THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- The existing applications_after_update / applications_status_activity
  -- triggers already write application_status_history and employer_activity
  -- on this UPDATE — no need to duplicate that logging here.
  UPDATE public.applications SET status = _status WHERE id = ANY(_application_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.update_application_status(uuid[], public.application_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_application_status(uuid[], public.application_status) TO authenticated;

-- ── 2. mark_application_viewed() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_application_viewed(_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id   uuid;
  _candidate_id uuid;
  _job_title    text;
  _already      boolean;
BEGIN
  SELECT a.company_id, a.candidate_id, (a.viewed_by_employer_at IS NOT NULL), j.title
    INTO _company_id, _candidate_id, _already, _job_title
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = _application_id;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _already THEN
    RETURN; -- idempotent: only the first view is recorded/notified
  END IF;

  UPDATE public.applications SET viewed_by_employer_at = now() WHERE id = _application_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _candidate_id, 'application.viewed', 'Your application was viewed',
    'An employer viewed your application for "' || COALESCE(_job_title, 'a job') || '".',
    '/candidate/applications'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_application_viewed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_application_viewed(uuid) TO authenticated;

-- ── 3. Personalized feed_jobs_for_candidate() ────────────────
DROP FUNCTION IF EXISTS public.feed_jobs_for_candidate(
  text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, text, int, int
);

CREATE FUNCTION public.feed_jobs_for_candidate(
  _q text DEFAULT NULL,
  _city text DEFAULT NULL,
  _category text DEFAULT NULL,
  _job_type text DEFAULT NULL,
  _work_mode text DEFAULT NULL,
  _min_salary int DEFAULT NULL,
  _max_salary int DEFAULT NULL,
  _min_exp int DEFAULT NULL,
  _max_exp int DEFAULT NULL,
  _posted_after timestamptz DEFAULT NULL,
  _education text DEFAULT NULL,
  _shift text DEFAULT NULL,
  _english_level text DEFAULT NULL,
  _company text DEFAULT NULL,
  _vehicle boolean DEFAULT false,
  _verified_only boolean DEFAULT false,
  _sort text DEFAULT 'recommended',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  company_id uuid,
  title text,
  city text,
  state text,
  locality text,
  min_salary integer,
  max_salary integer,
  salary_period text,
  job_type text,
  work_mode text,
  min_experience_years integer,
  max_experience_years integer,
  education text,
  skills text[],
  created_at timestamptz,
  pay_type text,
  avg_incentive_monthly integer,
  company_name text,
  company_is_verified boolean,
  boosted boolean,
  score numeric,
  match_score int,
  matched_skills int,
  total_required_skills int,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  WITH s AS (SELECT * FROM public.boost_settings bs WHERE bs.id = 1),
  cand AS (SELECT skills FROM public.candidate_profiles WHERE user_id = _uid),
  scored AS (
    SELECT
      j.id, j.company_id, j.title, j.city, j.state, j.locality,
      j.min_salary, j.max_salary, j.salary_period, j.job_type::text AS job_type, j.work_mode::text AS work_mode,
      j.min_experience_years, j.max_experience_years, j.education, j.skills AS job_skills,
      j.created_at, j.pay_type, j.avg_incentive_monthly,
      c.name AS company_name, c.is_verified AS company_is_verified,
      lb.ends_at AS boost_ends_at,
      (
        CASE WHEN lb.ends_at IS NOT NULL AND lb.ends_at > now()
          THEN s.boost_weight * (
            extract(epoch FROM (lb.ends_at - now()))
            / GREATEST(extract(epoch FROM (lb.ends_at - lb.starts_at)), 1)
          )
          ELSE 0 END
        + s.freshness_weight * GREATEST(0, 1 - (extract(epoch FROM (now() - j.created_at)) / 86400.0) / 7)
        + s.quality_weight * (COALESCE(j.quality_score, 0) / 100.0)
        + s.trending_weight * (CASE WHEN j.tier = 'trending' THEN 1 ELSE 0 END)
      ) AS job_score,
      public.compute_candidate_match(_uid, j.id, true) AS match_result
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (_q IS NULL OR j.title ILIKE '%' || _q || '%')
      AND (_city IS NULL OR j.city ILIKE '%' || _city || '%')
      AND (_category IS NULL OR j.category = _category)
      AND (_job_type IS NULL OR j.job_type::text = _job_type)
      AND (_work_mode IS NULL OR j.work_mode::text = _work_mode)
      AND (_min_salary IS NULL OR j.min_salary >= _min_salary)
      AND (_max_salary IS NULL OR j.max_salary <= _max_salary)
      AND (_max_exp IS NULL OR j.min_experience_years <= _max_exp)
      AND (_min_exp IS NULL OR j.max_experience_years >= _min_exp OR j.max_experience_years IS NULL)
      AND (_posted_after IS NULL OR j.created_at >= _posted_after)
      AND (_education IS NULL OR j.education = _education)
      AND (_shift IS NULL OR j.shift::text = _shift)
      AND (_english_level IS NULL OR j.english_level = _english_level)
      AND (_company IS NULL OR c.name ILIKE '%' || _company || '%')
      AND (_vehicle IS NOT TRUE OR j.required_assets @> ARRAY['Two-wheeler'])
      AND (_verified_only IS NOT TRUE OR c.is_verified = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.job_id = j.id AND a.candidate_id = _uid
      )
  )
  SELECT
    scored.id, scored.company_id, scored.title, scored.city, scored.state, scored.locality,
    scored.min_salary, scored.max_salary, scored.salary_period,
    scored.job_type, scored.work_mode, scored.min_experience_years, scored.max_experience_years,
    scored.education, scored.job_skills, scored.created_at, scored.pay_type, scored.avg_incentive_monthly,
    scored.company_name, scored.company_is_verified,
    (scored.boost_ends_at IS NOT NULL) AS boosted,
    -- Relevance-first: the candidate's own match score is the base; boost/
    -- freshness/quality (job_score, typically 0–~30) is capped at 15 so it
    -- can only nudge ordering among similarly-relevant jobs, never replace
    -- relevance as the dominant signal.
    (COALESCE((scored.match_result->>'score')::numeric, 0) + LEAST(scored.job_score, 15)) AS score,
    (scored.match_result->>'score')::int AS match_score,
    (
      SELECT count(*) FROM unnest(COALESCE(scored.job_skills, ARRAY[]::text[])) js
      WHERE EXISTS (
        SELECT 1 FROM unnest(COALESCE((SELECT skills FROM cand), ARRAY[]::text[])) cs
        WHERE lower(cs) = lower(js)
      )
    )::int AS matched_skills,
    COALESCE(array_length(scored.job_skills, 1), 0) AS total_required_skills,
    count(*) OVER() AS total_count
  FROM scored
  ORDER BY
    CASE WHEN _sort = 'newest' THEN scored.created_at END DESC,
    CASE WHEN _sort = 'oldest' THEN scored.created_at END ASC,
    CASE WHEN _sort = 'salary_high' THEN scored.max_salary END DESC NULLS LAST,
    CASE WHEN _sort = 'salary_low' THEN scored.min_salary END ASC NULLS LAST,
    CASE WHEN _sort NOT IN ('newest', 'oldest', 'salary_high', 'salary_low')
      THEN COALESCE((scored.match_result->>'score')::numeric, 0) + LEAST(scored.job_score, 15)
    END DESC,
    scored.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.feed_jobs_for_candidate(
  text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, text, int, int
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_jobs_for_candidate(
  text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, text, int, int
) TO authenticated;

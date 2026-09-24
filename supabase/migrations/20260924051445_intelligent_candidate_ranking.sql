-- Server-side candidate<->job match scoring for recruiter candidate
-- discovery and applicant ranking, per prompt structure/matching.md §1
-- (base relevancy) and §3 (recruiter bonuses).
--
-- compute_candidate_match() is the single scoring implementation, shared by
-- the extended search_candidates_for_company() (candidate DB search) and the
-- new get_ranked_job_applicants() (per-job applicant ranking) — so the
-- formula only ever lives in one place.
--
-- Known, documented simplifications vs. the doc (not silent gaps):
--   - Skill matching is case/whitespace-normalised only, not skills_master-
--     synonym-normalised (e.g. "MS Office" vs "Microsoft Office" are not
--     unified yet).
--   - "Proximity" uses city/state tiers (jobs.state, public.cities.state),
--     not km-based geocoding — no lat/lng is stored on either side.
--   - "Recently Active" / activity bonus uses auth.users.last_sign_in_at as
--     the last-active signal (real data already tracked by Supabase Auth),
--     since candidate_profiles has no last_active_at column and adding one
--     would need new instrumentation across the candidate app — out of
--     scope here.
--   - The "Fast Responder" tag from matching.md §5 is intentionally not
--     implemented — no employer-contact response-time data exists, and
--     inventing the tag would violate the doc's own "never invent a tag"
--     rule.

CREATE OR REPLACE FUNCTION public.compute_candidate_match(
  _candidate_user_id uuid,
  _job_id uuid,
  _with_bonuses boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cand RECORD;
  job RECORD;
  cand_state text;
  skills_score int := 0;
  location_score int := 0;
  experience_score int := 0;
  salary_score int := 0;
  activity_bonus int := 0;
  intent_bonus int := 0;
  proximity_bonus int := 0;
  total int;
  matched_skills int := 0;
  required_skills int := 0;
  recent_apps int := 0;
  last_active timestamptz;
  tags text[] := ARRAY[]::text[];
BEGIN
  SELECT cp.skills, cp.years_experience, cp.preferred_cities, cp.profile_strength,
         cp.expected_salary, p.city
  INTO cand
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.user_id = _candidate_user_id;

  SELECT j.skills, j.min_experience_years, j.max_experience_years, j.experience_bucket,
         j.city, j.state, j.pan_india_ok, j.max_salary
  INTO job
  FROM public.jobs j
  WHERE j.id = _job_id;

  IF cand IS NULL OR job IS NULL THEN
    RETURN jsonb_build_object('score', 0, 'breakdown', '{}'::jsonb, 'tags', ARRAY[]::text[]);
  END IF;

  -- Skills (60): case/whitespace-normalised overlap.
  required_skills := COALESCE(cardinality(job.skills), 0);
  IF required_skills > 0 THEN
    SELECT count(*) INTO matched_skills
    FROM unnest(job.skills) js
    WHERE EXISTS (
      SELECT 1 FROM unnest(cand.skills) cs
      WHERE lower(btrim(cs)) = lower(btrim(js))
    );
    skills_score := round((matched_skills::numeric / required_skills) * 60);
  ELSE
    skills_score := 60; -- job asked for nothing specific — don't penalise
  END IF;

  -- Location (20): exact city 20 / preferred-city list 20 / same state 10 /
  -- pan-India job 12 / else 0.
  SELECT state INTO cand_state FROM public.cities WHERE lower(name) = lower(COALESCE(cand.city, '')) LIMIT 1;
  IF job.city IS NOT NULL AND lower(job.city) = lower(COALESCE(cand.city, '')) THEN
    location_score := 20;
  ELSIF job.city IS NOT NULL AND cand.preferred_cities IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest(cand.preferred_cities) pc WHERE lower(pc) = lower(job.city)) THEN
    location_score := 20;
  ELSIF cand_state IS NOT NULL AND job.state IS NOT NULL AND lower(cand_state) = lower(job.state) THEN
    location_score := 10;
  ELSIF job.pan_india_ok THEN
    location_score := 12;
  ELSE
    location_score := 0;
  END IF;

  -- Experience (15): inside band 15 / within 1yr 8 / else 0. 'any' bucket -> full 15.
  IF job.experience_bucket = 'any' OR job.experience_bucket IS NULL THEN
    experience_score := 15;
  ELSIF cand.years_experience >= COALESCE(job.min_experience_years, 0)
        AND cand.years_experience <= COALESCE(job.max_experience_years, 999) THEN
    experience_score := 15;
  ELSIF cand.years_experience >= COALESCE(job.min_experience_years, 0) - 1
        AND cand.years_experience <= COALESCE(job.max_experience_years, 999) + 1 THEN
    experience_score := 8;
  ELSE
    experience_score := 0;
  END IF;

  -- Salary (5): expected <= max 5 / within 20% 3 / else 0. No expectation or
  -- no job max on record -> neutral 3 (can't penalise a signal that isn't there).
  IF cand.expected_salary IS NULL OR job.max_salary IS NULL THEN
    salary_score := 3;
  ELSIF cand.expected_salary <= job.max_salary THEN
    salary_score := 5;
  ELSIF cand.expected_salary <= job.max_salary * 1.2 THEN
    salary_score := 3;
  ELSE
    salary_score := 0;
  END IF;

  total := skills_score + location_score + experience_score + salary_score;

  IF _with_bonuses THEN
    SELECT last_sign_in_at INTO last_active FROM auth.users WHERE id = _candidate_user_id;
    activity_bonus := CASE
      WHEN last_active IS NULL THEN 0
      WHEN last_active > now() - interval '24 hours' THEN 15
      WHEN last_active > now() - interval '72 hours' THEN 10
      WHEN last_active > now() - interval '7 days' THEN 5
      ELSE 0
    END;

    SELECT count(*) INTO recent_apps
    FROM public.applications a
    WHERE a.candidate_id = _candidate_user_id AND a.created_at > now() - interval '7 days';
    intent_bonus := CASE
      WHEN recent_apps >= 6 THEN 10
      WHEN recent_apps >= 3 THEN 7
      WHEN recent_apps >= 1 THEN 4
      ELSE 0
    END;

    proximity_bonus := CASE
      WHEN job.city IS NOT NULL AND lower(job.city) = lower(COALESCE(cand.city, '')) THEN 10
      WHEN job.city IS NOT NULL AND cand.preferred_cities IS NOT NULL
           AND EXISTS (SELECT 1 FROM unnest(cand.preferred_cities) pc WHERE lower(pc) = lower(job.city)) THEN 6
      WHEN cand_state IS NOT NULL AND job.state IS NOT NULL AND lower(cand_state) = lower(job.state) THEN 3
      ELSE 0
    END;

    total := total + activity_bonus + intent_bonus + proximity_bonus;

    IF total >= 75 THEN tags := array_append(tags, 'Recommended'); END IF;
    IF recent_apps >= 3 AND COALESCE(cand.profile_strength, 0) >= 80 THEN tags := array_append(tags, 'Hot Profile'); END IF;
    IF last_active IS NOT NULL AND last_active > now() - interval '72 hours' THEN tags := array_append(tags, 'Recently Active'); END IF;
    IF proximity_bonus >= 6 THEN tags := array_append(tags, 'Nearby Candidate'); END IF;
  END IF;

  RETURN jsonb_build_object(
    'score', LEAST(100, GREATEST(0, total)),
    'breakdown', jsonb_build_object(
      'skills', skills_score, 'location', location_score,
      'experience', experience_score, 'salary', salary_score,
      'activity', activity_bonus, 'intent', intent_bonus, 'proximity', proximity_bonus
    ),
    'tags', tags
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_candidate_match(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_candidate_match(uuid, uuid, boolean) TO authenticated;

-- Extend search_candidates_for_company(): optional _job_id ranks results
-- against that job (match_score/match_breakdown/tags), optional _sort_by
-- picks the ordering. Return shape changes (three new columns), so the
-- prior signature is dropped and recreated, matching the pattern already
-- used by supabase/migrations/20260917054645_add_candidate_search_pagination.sql.
DROP FUNCTION IF EXISTS public.search_candidates_for_company(uuid, text, text[], int, int, int);

CREATE OR REPLACE FUNCTION public.search_candidates_for_company(
  _company_id uuid,
  _query text DEFAULT NULL,
  _cities text[] DEFAULT NULL,
  _min_experience int DEFAULT NULL,
  _limit int DEFAULT 40,
  _offset int DEFAULT 0,
  _job_id uuid DEFAULT NULL,
  _sort_by text DEFAULT 'relevance'
) RETURNS TABLE (
  user_id uuid,
  profile_slug text,
  headline text,
  last_role text,
  years_experience int,
  skills text[],
  preferred_cities text[],
  preferred_work_mode text,
  full_name text,
  avatar_url text,
  city text,
  total_count bigint,
  match_score int,
  match_breakdown jsonb,
  tags text[]
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

  IF _job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = _job_id AND j.company_id = _company_id AND j.status = 'active'
  ) THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.company_id = _company_id AND j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'no_active_job';
  END IF;

  PERFORM public.log_employer_activity(_company_id, auth.uid(), 'candidate_db_search', 'Ran a candidate database search',
    NULL, NULL, jsonb_build_object('job_id', _job_id, 'query', _term));

  RETURN QUERY
  SELECT
    cp.user_id, cp.profile_slug, cp.headline, cp.last_role, cp.years_experience,
    cp.skills, cp.preferred_cities, cp.preferred_work_mode,
    p.full_name, p.avatar_url, p.city,
    count(*) OVER() AS total_count,
    (m.result->>'score')::int AS match_score,
    m.result->'breakdown' AS match_breakdown,
    ARRAY(SELECT jsonb_array_elements_text(m.result->'tags')) AS tags
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  LEFT JOIN LATERAL (
    SELECT public.compute_candidate_match(cp.user_id, _job_id, true) AS result
    WHERE _job_id IS NOT NULL
  ) m ON true
  WHERE cp.onboarding_completed = true
    AND (_min_experience IS NULL OR cp.years_experience >= _min_experience)
    AND (
      _cities IS NULL OR cardinality(_cities) = 0
      OR cp.preferred_cities && _cities
      OR p.city = ANY(_cities)
    )
    AND (
      _term IS NULL
      OR cp.headline ILIKE ('%' || _term || '%')
      OR cp.last_role ILIKE ('%' || _term || '%')
      OR EXISTS (SELECT 1 FROM unnest(cp.skills) s WHERE s ILIKE ('%' || _term || '%'))
    )
  ORDER BY
    CASE WHEN _job_id IS NOT NULL AND _sort_by = 'match' THEN (m.result->>'score')::int END DESC NULLS LAST,
    CASE WHEN _sort_by = 'experience' THEN cp.years_experience END DESC NULLS LAST,
    cp.profile_strength DESC, cp.years_experience DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int, int, int, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int, int, int, uuid, text) TO authenticated;

-- New: per-job applicant ranking (Applicants page "Sort by Match Score").
CREATE OR REPLACE FUNCTION public.get_ranked_job_applicants(
  _job_id uuid,
  _status text DEFAULT NULL,
  _sort_by text DEFAULT 'match'
) RETURNS TABLE (
  application_id uuid,
  candidate_id uuid,
  status text,
  created_at timestamptz,
  full_name text,
  city text,
  headline text,
  last_role text,
  years_experience int,
  skills text[],
  match_score int,
  match_breakdown jsonb,
  tags text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _company_id uuid;
BEGIN
  SELECT company_id INTO _company_id FROM public.jobs WHERE id = _job_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.candidate_id, a.status::text, a.created_at,
    p.full_name, p.city, cp.headline, cp.last_role, cp.years_experience, cp.skills,
    (m.result->>'score')::int,
    m.result->'breakdown',
    ARRAY(SELECT jsonb_array_elements_text(m.result->'tags'))
  FROM public.applications a
  JOIN public.profiles p ON p.id = a.candidate_id
  LEFT JOIN public.candidate_profiles cp ON cp.user_id = a.candidate_id
  CROSS JOIN LATERAL (SELECT public.compute_candidate_match(a.candidate_id, _job_id, true) AS result) m
  WHERE a.job_id = _job_id
    AND (_status IS NULL OR a.status::text = _status)
  ORDER BY
    CASE WHEN _sort_by = 'match' THEN (m.result->>'score')::int END DESC NULLS LAST,
    a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ranked_job_applicants(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ranked_job_applicants(uuid, text, text) TO authenticated;

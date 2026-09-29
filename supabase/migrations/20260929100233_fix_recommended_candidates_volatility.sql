-- ============================================================
-- Fix: get_recommended_candidates_for_job() was declared STABLE
-- but internally calls log_employer_activity(), which performs
-- an INSERT. PostgREST opens a read-only transaction for STABLE
-- functions, so every call failed with:
--   "cannot execute INSERT in a read-only transaction"
--
-- Fix: mark the function VOLATILE (the default) since it writes
-- to employer_activity on every call.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_recommended_candidates_for_job(
  _job_id     uuid,
  _limit      int  DEFAULT 30,
  _offset     int  DEFAULT 0,
  _min_score  int  DEFAULT 40,
  _filter     text DEFAULT NULL   -- 'hot' | 'nearby' | 'active' | NULL (all)
)
RETURNS TABLE (
  user_id             uuid,
  profile_slug        text,
  headline            text,
  last_role           text,
  years_experience    int,
  skills              text[],
  preferred_cities    text[],
  preferred_work_mode text,
  city                text,
  match_score         int,
  match_breakdown     jsonb,
  tags                text[],
  is_unlocked         boolean,
  -- Masked unless unlocked:
  full_name           text,   -- "A••• K•••" until unlocked
  avatar_url          text,
  total_count         bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
BEGIN
  -- Resolve company_id and verify the job is active
  SELECT j.company_id INTO _company_id
    FROM public.jobs j
    WHERE j.id = _job_id AND j.status = 'active';

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'db_recommendations_viewed',
    'Viewed AI recommended candidates',
    NULL, '/employer/jobs/' || _job_id::text || '/applicants',
    jsonb_build_object('job_id', _job_id, 'filter', _filter)
  );

  RETURN QUERY
  WITH scored AS (
    SELECT
      cp.user_id,
      cp.profile_slug,
      cp.headline,
      cp.last_role,
      cp.years_experience,
      cp.skills,
      cp.preferred_cities,
      cp.preferred_work_mode,
      p.full_name   AS raw_full_name,
      p.avatar_url  AS raw_avatar_url,
      p.city,
      public.compute_candidate_match(cp.user_id, _job_id, true) AS result
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.user_id
    WHERE
      cp.onboarding_completed = true
      -- Exclude candidates who already applied to this job
      AND NOT EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.job_id = _job_id AND a.candidate_id = cp.user_id
      )
      -- Exclude dismissed candidates
      AND NOT EXISTS (
        SELECT 1 FROM public.job_candidate_dismissals d
        WHERE d.job_id = _job_id AND d.candidate_user_id = cp.user_id
      )
  ),
  filtered AS (
    SELECT
      s.*,
      (s.result->>'score')::int                                   AS score,
      s.result->'breakdown'                                        AS breakdown,
      ARRAY(SELECT jsonb_array_elements_text(s.result->'tags'))   AS tag_arr,
      EXISTS(
        SELECT 1 FROM public.candidate_unlocks cu
        WHERE cu.company_id = _company_id AND cu.candidate_user_id = s.user_id
      )                                                            AS unlocked
    FROM scored s
    WHERE (s.result->>'score')::int >= _min_score
      AND (
        _filter IS NULL
        OR (_filter = 'hot'    AND s.result->'tags' ? 'Hot Profile')
        OR (_filter = 'nearby' AND s.result->'tags' ? 'Nearby Candidate')
        OR (_filter = 'active' AND s.result->'tags' ? 'Recently Active')
      )
  )
  SELECT
    f.user_id,
    f.profile_slug,
    f.headline,
    f.last_role,
    f.years_experience,
    f.skills,
    f.preferred_cities,
    f.preferred_work_mode,
    f.city,
    f.score,
    f.breakdown,
    f.tag_arr,
    f.unlocked,
    -- Mask name if not unlocked
    CASE WHEN f.unlocked THEN f.raw_full_name
         ELSE (
           SELECT string_agg(
             CASE WHEN length(part) > 0 THEN substring(part, 1, 1) || repeat('•', LEAST(3, length(part) - 1)) ELSE '' END,
             ' '
           )
           FROM unnest(string_to_array(COALESCE(f.raw_full_name, 'Candidate'), ' ')) AS part
         )
    END,
    -- Mask avatar if not unlocked
    CASE WHEN f.unlocked THEN f.raw_avatar_url ELSE NULL END,
    count(*) OVER ()
  FROM filtered f
  ORDER BY f.score DESC, f.unlocked DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recommended_candidates_for_job(uuid, int, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recommended_candidates_for_job(uuid, int, int, int, text) TO authenticated;

-- ============================================================
-- compute_candidate_match(): add a semantic similarity component so recruiter-side candidate ranking
-- (candidate DB search, applicant sort) benefits from pgvector the same way the candidate-side
-- "Recommended for you" feed already does. Before this, pgvector was fully built (6 embedding columns,
-- HNSW indexes, 100% coverage) but consumed by exactly one function; this employer-facing formula had
-- zero semantic component, so recruiters searching the candidate DB had the identical "only literal
-- text matches" problem candidates had in Browse search (see 20261012130000) -- and it directly
-- addresses this function's own documented gap (see header of 20260924052105_intelligent_candidate_ranking.sql):
-- "Skill matching is case/whitespace-normalised only, not skills_master-synonym-normalised (e.g.
-- 'MS Office' vs 'Microsoft Office' are not unified yet)." Semantic similarity on skills_embedding
-- catches exactly that case, as a complement to the existing exact-string skills_score, not a replacement.
--
-- Weight split (owner-approved): skill 60->55, location 20->17, semantic +8, experience 15 and salary 5
-- unchanged. Base total stays 100, so the existing >=75 "Recommended" tag threshold and the LEAST(100, ...)
-- bonus cap are both unaffected -- this changes HOW the 100 points are earned, not the scale itself.
--
-- Uses skills_embedding on both sides (not the whole-profile/description embedding): most precisely
-- targeted at the documented gap above, and distinct from the exact-string skills_score it sits beside.
-- Neutral (half credit, 4 of 8) when either side's embedding is missing, same convention
-- recommend_jobs_for_candidate's facets use (20261009130307) -- never penalise a candidate or job for
-- not having an embedding yet.
--
-- search_candidates_for_company() and get_ranked_job_applicants() both call compute_candidate_match()
-- and only ever read '->>score' / '->breakdown' generically, so neither needs a change: the new
-- 'semantic' breakdown key and the different score it produces reach them automatically.
-- ============================================================

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
  semantic_score int := 0;
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
         cp.expected_salary, p.city, cp.skills_embedding
  INTO cand
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.user_id = _candidate_user_id;

  SELECT j.skills, j.min_experience_years, j.max_experience_years, j.experience_bucket,
         j.city, j.state, j.pan_india_ok, j.max_salary, j.skills_embedding
  INTO job
  FROM public.jobs j
  WHERE j.id = _job_id;

  IF cand IS NULL OR job IS NULL THEN
    RETURN jsonb_build_object('score', 0, 'breakdown', '{}'::jsonb, 'tags', ARRAY[]::text[]);
  END IF;

  -- Skills (55): case/whitespace-normalised overlap.
  required_skills := COALESCE(cardinality(job.skills), 0);
  IF required_skills > 0 THEN
    SELECT count(*) INTO matched_skills
    FROM unnest(job.skills) js
    WHERE EXISTS (
      SELECT 1 FROM unnest(cand.skills) cs
      WHERE lower(btrim(cs)) = lower(btrim(js))
    );
    skills_score := round((matched_skills::numeric / required_skills) * 55);
  ELSE
    skills_score := 55; -- job asked for nothing specific — don't penalise
  END IF;

  -- Semantic skills similarity (8): catches a skill meant the same way but phrased differently
  -- (e.g. "MS Office" vs "Microsoft Office") that the exact-string skills_score above cannot.
  -- Neutral half-credit (4) when either side has no embedding yet — never a penalty for that.
  IF cand.skills_embedding IS NOT NULL AND job.skills_embedding IS NOT NULL THEN
    semantic_score := round(8 * GREATEST(0::numeric, LEAST(1::numeric,
      1 - (cand.skills_embedding <=> job.skills_embedding))));
  ELSE
    semantic_score := 4;
  END IF;

  -- Location (17): exact city 17 / preferred-city list 17 / same state 9 / pan-India job 10 / else 0.
  SELECT state INTO cand_state FROM public.cities WHERE lower(name) = lower(COALESCE(cand.city, '')) LIMIT 1;
  IF job.city IS NOT NULL AND lower(job.city) = lower(COALESCE(cand.city, '')) THEN
    location_score := 17;
  ELSIF job.city IS NOT NULL AND cand.preferred_cities IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest(cand.preferred_cities) pc WHERE lower(pc) = lower(job.city)) THEN
    location_score := 17;
  ELSIF cand_state IS NOT NULL AND job.state IS NOT NULL AND lower(cand_state) = lower(job.state) THEN
    location_score := 9;
  ELSIF job.pan_india_ok THEN
    location_score := 10;
  ELSE
    location_score := 0;
  END IF;

  -- Experience (15): inside band 15 / within 1yr 8 / else 0. 'any' bucket -> full 15. Unchanged.
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

  -- Salary (5): expected <= max 5 / within 20% 3 / else 0. Unchanged.
  IF cand.expected_salary IS NULL OR job.max_salary IS NULL THEN
    salary_score := 3;
  ELSIF cand.expected_salary <= job.max_salary THEN
    salary_score := 5;
  ELSIF cand.expected_salary <= job.max_salary * 1.2 THEN
    salary_score := 3;
  ELSE
    salary_score := 0;
  END IF;

  total := skills_score + location_score + experience_score + salary_score + semantic_score;

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
      'experience', experience_score, 'salary', salary_score, 'semantic', semantic_score,
      'activity', activity_bonus, 'intent', intent_bonus, 'proximity', proximity_bonus
    ),
    'tags', tags
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_candidate_match(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_candidate_match(uuid, uuid, boolean) TO authenticated;

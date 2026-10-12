-- ============================================================
-- Role-based skill quiz (candidate-facing, free, admin-authored).
--
-- Not the same feature as certifications (20260930130000/20260930150000):
-- certifications are paid, course-linked, and the candidate's own score/pass
-- result is the product they bought. This quiz is free, keyed off the
-- existing role_category() department taxonomy (not a specific course), and
-- its only externally visible effect is a pass/fail "Skill Verified" tag on
-- compute_candidate_match() -- never a raw score, matching how every
-- competitor researched (LinkedIn/Indeed/Naukri) abstracts this signal away
-- from recruiters. See prompt structure/matching.md conventions.
--
-- The exam-delivery/grading shape (answer key stripped on read, score graded
-- entirely server-side, advisory-locked submit) deliberately mirrors
-- get_certification_exam()/submit_certification_exam() in
-- 20260930150000_learning_purchase_gating.sql -- same proven pattern, new
-- table, because the two features have different owners/consumers (learning
-- page vs. employer applicant view) and different retake rules (cooldown,
-- not a hard attempt cap).
-- ============================================================

-- 1) Question banks -- one row per department, admin-authored and edited via
-- src/routes/admin/quizzes.tsx. questions shape: [{id, text, options[], correct}],
-- correct is an index into options; never sent to the browser (see
-- get_skill_quiz below).
CREATE TABLE IF NOT EXISTS public.skill_quiz_question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL UNIQUE, -- one of role_category()'s department strings
  pass_mark integer NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 1 AND 100),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (id, category, pass_mark, is_active) ON public.skill_quiz_question_sets TO authenticated;
GRANT ALL ON public.skill_quiz_question_sets TO service_role;
ALTER TABLE public.skill_quiz_question_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads active quiz metadata" ON public.skill_quiz_question_sets;
CREATE POLICY "anyone reads active quiz metadata" ON public.skill_quiz_question_sets
  FOR SELECT TO authenticated USING (is_active);
DROP POLICY IF EXISTS "admin manages quiz sets" ON public.skill_quiz_question_sets;
CREATE POLICY "admin manages quiz sets" ON public.skill_quiz_question_sets
  FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
-- `questions` (the answer key) is never granted to authenticated directly —
-- only readable via get_skill_quiz()/the admin RLS policy's row access,
-- which is fine since that policy only lets admins through, not candidates.

DROP TRIGGER IF EXISTS tg_skill_quiz_question_sets_updated_at ON public.skill_quiz_question_sets;
CREATE TRIGGER tg_skill_quiz_question_sets_updated_at
  BEFORE UPDATE ON public.skill_quiz_question_sets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) Attempts. score is stored for admin analytics only -- never returned to
-- a recruiter and only returned to the candidate themselves (their own
-- result), per the "badge, not score" decision.
CREATE TABLE IF NOT EXISTS public.candidate_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  question_set_id uuid NOT NULL REFERENCES public.skill_quiz_question_sets(id) ON DELETE CASCADE,
  answers jsonb NOT NULL,
  score integer NOT NULL,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_quiz_attempts_user_category
  ON public.candidate_quiz_attempts(user_id, category, created_at DESC);
GRANT SELECT ON public.candidate_quiz_attempts TO authenticated;
GRANT ALL ON public.candidate_quiz_attempts TO service_role;
ALTER TABLE public.candidate_quiz_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads own attempts" ON public.candidate_quiz_attempts;
CREATE POLICY "owner reads own attempts" ON public.candidate_quiz_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "admin reads all attempts" ON public.candidate_quiz_attempts;
CREATE POLICY "admin reads all attempts" ON public.candidate_quiz_attempts
  FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));
-- No INSERT policy for authenticated: all writes go through submit_skill_quiz()
-- (SECURITY DEFINER below), which grades server-side and cannot be bypassed
-- by inserting a pre-decided score/passed row directly.

-- 3) Cooldown + pass-mark config, alongside the other global knobs.
ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS skill_quiz_cooldown_days integer NOT NULL DEFAULT 30;

-- 4) get_skill_quiz(): active question set for a department, answer key
-- stripped, retry-after info if the candidate is on cooldown. Mirrors
-- get_certification_exam()'s shape (questions / passMark / attemptsUsed-ish
-- info) but with a cooldown window instead of a hard attempt cap.
CREATE OR REPLACE FUNCTION public.get_skill_quiz(_category text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _set record;
  _cooldown_days int;
  _last_attempt timestamptz;
  _retry_after timestamptz;
  _questions jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT id, pass_mark, questions INTO _set
    FROM public.skill_quiz_question_sets
   WHERE category = _category AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_unavailable'; END IF;

  SELECT skill_quiz_cooldown_days INTO _cooldown_days FROM public.plan_settings WHERE id = 1;
  _cooldown_days := COALESCE(_cooldown_days, 30);

  SELECT created_at INTO _last_attempt FROM public.candidate_quiz_attempts
   WHERE user_id = _uid AND category = _category
   ORDER BY created_at DESC LIMIT 1;

  IF _last_attempt IS NOT NULL THEN
    _retry_after := _last_attempt + (_cooldown_days || ' days')::interval;
    IF _retry_after > now() THEN
      RAISE EXCEPTION 'on_cooldown:%', _retry_after;
    END IF;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('id', q->>'id', 'text', q->>'text', 'options', q->'options'))
    INTO _questions
    FROM jsonb_array_elements(coalesce(_set.questions, '[]'::jsonb)) q;

  RETURN jsonb_build_object(
    'questions', coalesce(_questions, '[]'::jsonb),
    'passMark', _set.pass_mark
  );
END $$;
REVOKE ALL ON FUNCTION public.get_skill_quiz(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_skill_quiz(text) TO authenticated;

-- 5) submit_skill_quiz(): grades server-side against the real answer key
-- (client never receives it), advisory-locked per (user, category) so a
-- double-submit from two tabs can't create two attempts in the same window.
CREATE OR REPLACE FUNCTION public.submit_skill_quiz(_category text, _answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _set record;
  _cooldown_days int;
  _last_attempt timestamptz;
  _total int := 0;
  _correct_count int := 0;
  _q jsonb;
  _given int;
  _score int;
  _passed boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF jsonb_typeof(_answers) <> 'object' THEN RAISE EXCEPTION 'invalid_answers'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':quiz:' || _category, 0));

  SELECT id, pass_mark, questions INTO _set
    FROM public.skill_quiz_question_sets
   WHERE category = _category AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'quiz_unavailable'; END IF;

  SELECT skill_quiz_cooldown_days INTO _cooldown_days FROM public.plan_settings WHERE id = 1;
  _cooldown_days := COALESCE(_cooldown_days, 30);

  SELECT created_at INTO _last_attempt FROM public.candidate_quiz_attempts
   WHERE user_id = _uid AND category = _category
   ORDER BY created_at DESC LIMIT 1;
  IF _last_attempt IS NOT NULL AND _last_attempt + (_cooldown_days || ' days')::interval > now() THEN
    RAISE EXCEPTION 'on_cooldown:%', _last_attempt + (_cooldown_days || ' days')::interval;
  END IF;

  FOR _q IN SELECT * FROM jsonb_array_elements(coalesce(_set.questions, '[]'::jsonb))
  LOOP
    _total := _total + 1;
    BEGIN
      _given := (_answers ->> (_q ->> 'id'))::int;
    EXCEPTION WHEN OTHERS THEN
      _given := NULL;
    END;
    IF _given IS NOT NULL AND _given = (_q ->> 'correct')::int THEN
      _correct_count := _correct_count + 1;
    END IF;
  END LOOP;

  _score := CASE WHEN _total = 0 THEN 0 ELSE round((_correct_count::numeric / _total) * 100) END;
  _passed := _score >= _set.pass_mark;

  INSERT INTO public.candidate_quiz_attempts (user_id, category, question_set_id, answers, score, passed)
  VALUES (_uid, _category, _set.id, _answers, _score, _passed);

  RETURN jsonb_build_object(
    'score', _score, 'passed', _passed, 'correctCount', _correct_count, 'total', _total
  );
END $$;
REVOKE ALL ON FUNCTION public.submit_skill_quiz(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_skill_quiz(text, jsonb) TO authenticated;

-- 6) Admin authoring RPC (upsert a department's question set) -- the admin
-- editor goes through this rather than a direct table write so "correct"
-- indices are validated against each question's own options length before
-- being saved (an admin typo here would otherwise silently un-gradeable a
-- question for every candidate who takes it).
CREATE OR REPLACE FUNCTION public.admin_upsert_skill_quiz(
  _category text, _pass_mark integer, _questions jsonb, _is_active boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q jsonb;
  _id uuid;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _pass_mark < 1 OR _pass_mark > 100 THEN RAISE EXCEPTION 'invalid_pass_mark'; END IF;

  FOR _q IN SELECT * FROM jsonb_array_elements(coalesce(_questions, '[]'::jsonb))
  LOOP
    IF NULLIF(trim(_q ->> 'text'), '') IS NULL THEN RAISE EXCEPTION 'question_text_required'; END IF;
    IF jsonb_typeof(_q -> 'options') IS DISTINCT FROM 'array' OR jsonb_array_length(_q -> 'options') < 2 THEN
      RAISE EXCEPTION 'question_needs_options';
    END IF;
    IF (_q ->> 'correct')::int NOT BETWEEN 0 AND jsonb_array_length(_q -> 'options') - 1 THEN
      RAISE EXCEPTION 'invalid_correct_index';
    END IF;
  END LOOP;

  INSERT INTO public.skill_quiz_question_sets (category, pass_mark, questions, is_active, created_by)
  VALUES (_category, _pass_mark, _questions, _is_active, auth.uid())
  ON CONFLICT (category) DO UPDATE SET
    pass_mark = _pass_mark, questions = _questions, is_active = _is_active, updated_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.admin_upsert_skill_quiz(text, integer, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_skill_quiz(text, integer, jsonb, boolean) TO authenticated;
-- Note: EXECUTE is granted to `authenticated` (not revoked) because the
-- permission check is done inside the function via has_platform_role() --
-- same pattern as admin_set_verification()/admin_launch_state() elsewhere.

-- 7) Recruiter-facing tag. compute_candidate_match() already selects job.*
-- columns and builds `tags` only inside the _with_bonuses branch (existing
-- Hot Profile / Recently Active / Nearby Candidate tags) -- this adds one
-- more read-only, informational tag there. Not added to the 100-point score:
-- there's no pass-rate data yet to justify weighting an unvalidated signal,
-- and ground rule 4's existing weights (skill 55/location 17/experience
-- 15/salary 5/semantic 8) are unchanged by this migration.
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
  job_category text;
  skill_verified boolean;
BEGIN
  SELECT cp.skills, cp.years_experience, cp.preferred_cities, cp.profile_strength,
         cp.expected_salary, p.city, cp.skills_embedding
  INTO cand
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.user_id = _candidate_user_id;

  SELECT j.skills, j.min_experience_years, j.max_experience_years, j.experience_bucket,
         j.city, j.state, j.pan_india_ok, j.max_salary, j.skills_embedding, j.category
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

    job_category := job.category;
    IF job_category IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.candidate_quiz_attempts qa
         WHERE qa.user_id = _candidate_user_id AND qa.category = job_category AND qa.passed
      ) INTO skill_verified;
      IF skill_verified THEN
        tags := array_append(tags, 'Skill Verified: ' || job_category);
      END IF;
    END IF;
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

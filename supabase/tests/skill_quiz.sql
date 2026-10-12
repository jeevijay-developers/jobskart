-- Role-based skill quiz: delivery of questions w/o answer key, server-side
-- grading, cooldown enforcement, and the compute_candidate_match() tag.
-- LOCAL DB only. Needs supabase/tests/fixtures/seed_local.sql. Rolls back.
BEGIN;

DO $$
DECLARE
  _cand uuid := '00000000-0000-4000-8000-00000000c001';
  _job uuid;
  _quiz jsonb;
  _questions jsonb;
  _q jsonb;
  _correct_in_payload boolean := false;
  _answers jsonb := '{}'::jsonb;
  _result jsonb;
  _tags text[];
  _raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cand::text, 'role', 'authenticated')::text, true);
  ASSERT auth.uid() = _cand, 'setup: auth.uid() must be the fixture candidate';

  DELETE FROM public.candidate_quiz_attempts WHERE user_id = _cand AND category = 'Sales';

  -- 1) get_skill_quiz(): answer key must never leave the server.
  _quiz := public.get_skill_quiz('Sales');
  _questions := _quiz -> 'questions';
  ASSERT jsonb_array_length(_questions) = 5, 'expected 5 questions for Sales';
  FOR _q IN SELECT * FROM jsonb_array_elements(_questions) LOOP
    IF _q ? 'correct' THEN _correct_in_payload := true; END IF;
  END LOOP;
  ASSERT NOT _correct_in_payload, 'answer key (correct) must not be present in get_skill_quiz() output';

  -- 2) submit_skill_quiz(): all-correct answers using the real (admin-side) key.
  SELECT jsonb_object_agg(q->>'id', q->>'correct')
    INTO _answers
    FROM jsonb_array_elements(
      (SELECT questions FROM public.skill_quiz_question_sets WHERE category = 'Sales')
    ) q;
  -- jsonb_object_agg above produced text values; submit_skill_quiz casts via ->>::int internally,
  -- but _answers must be passed as a jsonb object of number-like values for the (... ->> id)::int cast.
  _result := public.submit_skill_quiz('Sales', _answers);
  ASSERT (_result->>'passed')::boolean, format('expected a pass with all-correct answers, got %s', _result);
  ASSERT (_result->>'score')::int = 100, format('expected score 100, got %s', _result->>'score');

  -- 3) Cooldown: a second attempt the same day must be refused.
  BEGIN
    PERFORM public.submit_skill_quiz('Sales', _answers);
  EXCEPTION WHEN OTHERS THEN
    _raised := SQLERRM LIKE 'on_cooldown:%';
  END;
  ASSERT _raised, 'second attempt within the cooldown window must raise on_cooldown';

  _raised := false;
  BEGIN
    PERFORM public.get_skill_quiz('Sales');
  EXCEPTION WHEN OTHERS THEN
    _raised := SQLERRM LIKE 'on_cooldown:%';
  END;
  ASSERT _raised, 'get_skill_quiz() must also report on_cooldown while on cooldown';

  -- 4) compute_candidate_match(): the pass must surface as a tag, never a score,
  -- on any active Sales-category job.
  SELECT id INTO _job FROM public.jobs WHERE category = 'Sales' AND status = 'active' LIMIT 1;
  IF _job IS NOT NULL THEN
    SELECT array_agg(t) INTO _tags
      FROM jsonb_array_elements_text(public.compute_candidate_match(_cand, _job, true) -> 'tags') t;
    ASSERT EXISTS (SELECT 1 FROM unnest(_tags) t WHERE t = 'Skill Verified: Sales'),
      format('expected Skill Verified: Sales tag, got %s', _tags);
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- 5) admin_upsert_skill_quiz(): rejects an out-of-range correct index instead
-- of silently saving an un-gradeable question.
DO $$
DECLARE
  _admin uuid := '00000000-0000-4000-8000-00000000a001';
  _raised boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_upsert_skill_quiz(
      'Sales', 70,
      '[{"id":"q1","text":"Bad question","options":["A","B"],"correct":5}]'::jsonb,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    _raised := (SQLERRM = 'invalid_correct_index');
  END;
  ASSERT _raised, 'out-of-range correct index must be rejected';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

ROLLBACK;

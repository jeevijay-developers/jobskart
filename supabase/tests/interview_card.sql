-- interview_card.sql -- tests for 20261014100000_interview_card.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql (candidates, employers e001/e002, applications).
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/interview_card.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK.

BEGIN;

-- ids used throughout: an application of company d001 (employer e001 is a member), a stranger
-- employer (e002, other company) and a stranger candidate.
CREATE TEMP TABLE t AS
SELECT a.id AS app_id, a.candidate_id AS cand, a.company_id AS co, a.job_id AS job,
       '00000000-0000-4000-8000-00000000e001'::uuid AS emp,
       '00000000-0000-4000-8000-00000000e002'::uuid AS emp_other,
       (SELECT u.id FROM auth.users u
         WHERE u.email LIKE '%@fixture.local' AND u.id <> a.candidate_id
           AND u.id NOT IN (SELECT candidate_id FROM public.applications) LIMIT 1) AS stranger
  FROM public.applications a
 WHERE a.company_id = '00000000-0000-4000-8000-00000000d001'
 ORDER BY a.id LIMIT 1;
GRANT SELECT ON t TO authenticated;

-- a. privilege lockdown (catalog level)
DO $t$
BEGIN
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_items','INSERT'), 'a: no INSERT on items';
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_items','UPDATE'), 'a: no UPDATE on items';
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_items','DELETE'), 'a: no DELETE on items';
  ASSERT NOT has_table_privilege('authenticated','public.interview_cards','INSERT'), 'a: no INSERT on cards';
  ASSERT NOT has_table_privilege('authenticated','public.interview_cards','UPDATE'), 'a: no UPDATE on cards';
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_shares','INSERT'), 'a: no INSERT on shares';
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_shares','UPDATE'), 'a: no UPDATE on shares';
  ASSERT NOT has_table_privilege('authenticated','public.interview_card_views','SELECT'), 'a: views not readable directly';
  ASSERT NOT has_table_privilege('anon','public.interview_cards','SELECT'), 'a: anon no SELECT on cards';
  ASSERT NOT has_table_privilege('anon','public.interview_card_items','SELECT'), 'a: anon no SELECT on items';
  ASSERT NOT has_function_privilege('anon','public.get_applicant_interview_card(uuid)','EXECUTE'), 'a: anon cannot call employer RPC';
  ASSERT (SELECT public FROM storage.buckets WHERE id='interview-cards') = false, 'a: bucket must be private';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                      AND (qual ILIKE '%interview-cards%' OR with_check ILIKE '%interview-cards%')),
    'a: no storage policy may expose the interview-cards bucket';
END $t$;

-- b. candidate: consent gate, deterministic question set, direct writes denied
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT cand FROM t),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE _cid uuid; _n int; _sid uuid;
BEGIN
  BEGIN
    PERFORM public.start_interview_card('Delivery Executive', 'en');
    ASSERT false, 'b: start without consent must fail';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%consent_required%', 'b: expected consent_required, got ' || SQLERRM;
  END;

  INSERT INTO public.interview_card_consent (candidate_id, version) VALUES (auth.uid(), 1);
  _cid := public.start_interview_card('Delivery Executive', 'en');
  SELECT count(*) INTO _n FROM public.interview_card_items WHERE card_id = _cid;
  ASSERT _n BETWEEN 3 AND 5, format('b: expected 3-5 questions, got %s', _n);

  BEGIN
    PERFORM public.start_interview_card('Delivery Executive', 'en');
    ASSERT false, 'b: a second card must be refused (one per candidate)';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%card_exists%', 'b: expected card_exists, got ' || SQLERRM;
  END;

  -- candidate cannot forge transcript/feedback/audio from the browser
  BEGIN
    UPDATE public.interview_card_items SET transcript = 'forged', feedback = '{}'::jsonb;
    ASSERT false, 'b: candidate UPDATE of items must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.interview_cards SET status = 'published', summary_band = 'strong';
    ASSERT false, 'b: candidate UPDATE of card must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.interview_card_shares (application_id, candidate_id, card_id)
    VALUES ((SELECT app_id FROM t), auth.uid(), _cid);
    ASSERT false, 'b: candidate direct INSERT of share must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- cannot publish with no answered questions
  BEGIN
    PERFORM public.publish_interview_card();
    ASSERT false, 'b: publish with nothing answered must fail';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%min_included%', 'b: expected min_included, got ' || SQLERRM;
  END;
  -- cannot share an unpublished card
  BEGIN
    PERFORM public.set_application_card_share((SELECT app_id FROM t), true);
    ASSERT false, 'b: sharing an unpublished card must fail';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%card_not_published%', 'b: expected card_not_published, got ' || SQLERRM;
  END;
END $t$;

-- c. server answers (service role / table owner), then candidate publishes
RESET ROLE;
UPDATE public.interview_card_items i
   SET state = 'answered', takes = 1, answered_at = now(), duration_sec = 40,
       audio_path = i.candidate_id || '/' || i.card_id || '/q' || i.position || '.webm',
       transcript = 'I deliver parcels on time and I check every address twice.',
       feedback = jsonb_build_object(
         'criteria', jsonb_build_array(
            jsonb_build_object('key','relevance','band','strong','evidence','Direct answer','tip','SECRET-TIP'),
            jsonb_build_object('key','structure','band','developing','evidence','Some order','tip','SECRET-TIP')),
         'strengths', jsonb_build_array('Clear'),
         'improvements', jsonb_build_array('Add a number'),
         'outline', jsonb_build_array('SECRET-OUTLINE')),
       feedback_source = 'fallback', feedback_language = 'en'
 WHERE i.candidate_id = (SELECT cand FROM t);

SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT cand FROM t),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $t$
DECLARE _band text; _first uuid; _all int;
BEGIN
  SELECT count(*) INTO _all FROM public.interview_card_items;
  -- exclude all but two -> cannot publish
  FOR _first IN SELECT id FROM public.interview_card_items ORDER BY position OFFSET 2 LOOP
    PERFORM public.set_card_item_included(_first, false);
  END LOOP;
  BEGIN
    PERFORM public.publish_interview_card();
    ASSERT false, 'c: publish with <3 included must fail';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%min_included%', 'c: expected min_included, got ' || SQLERRM;
  END;
  -- include three again
  FOR _first IN SELECT id FROM public.interview_card_items ORDER BY position LIMIT 3 LOOP
    PERFORM public.set_card_item_included(_first, true);
  END LOOP;
  _band := public.publish_interview_card();
  -- every answer scores (2+1)/2 = 1.5, which is >= 1.4
  ASSERT _band = 'strong', format('c: expected strong, got %s', _band);

  -- once published, dropping below 3 included answers is refused (and rolled back)
  BEGIN
    PERFORM public.set_card_item_included((SELECT id FROM public.interview_card_items WHERE include ORDER BY position LIMIT 1), false);
    ASSERT false, 'c: dropping below 3 included on a published card must fail';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%min_included%', 'c: expected min_included, got ' || SQLERRM;
  END;
END $t$;

-- d. a stranger candidate cannot share someone else's application
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT stranger FROM t),'role','authenticated')::text, true);
DO $t$
BEGIN
  BEGIN
    PERFORM public.set_application_card_share((SELECT app_id FROM t), true);
    ASSERT false, 'd: stranger must not share another candidates application';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%application_not_found%', 'd: expected application_not_found, got ' || SQLERRM;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_cards), 'd: stranger must not see other cards';
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_card_items), 'd: stranger must not see other items';
END $t$;

-- e. employer sees nothing before the candidate shares
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT emp FROM t),'role','authenticated')::text, true);
DO $t$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_cards), 'e: employer has no table access to cards';
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_card_items), 'e: employer has no table access to items';
  ASSERT (SELECT count(*) FROM public.get_job_interview_card_badges((SELECT job FROM t))) = 0, 'e: no badge before share';
  BEGIN
    PERFORM public.get_applicant_interview_card((SELECT app_id FROM t));
    ASSERT false, 'e: unshared card must not be readable';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%not_shared%', 'e: expected not_shared, got ' || SQLERRM;
  END;
END $t$;

-- f. candidate shares; employer can now read exactly the included answers
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT cand FROM t),'role','authenticated')::text, true);
SELECT public.set_application_card_share((SELECT app_id FROM t), true);

SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT emp FROM t),'role','authenticated')::text, true);
DO $t$
DECLARE _card jsonb; _before int; _after int;
BEGIN
  ASSERT (SELECT count(*) FROM public.get_job_interview_card_badges((SELECT job FROM t))) = 1, 'f: badge after share';
  _card := public.get_applicant_interview_card((SELECT app_id FROM t));
  ASSERT jsonb_array_length(_card->'items') = 3, 'f: only the 3 included answers';
  ASSERT _card->>'summary_band' = 'strong', 'f: summary band';
  ASSERT position('SECRET-TIP' in _card::text) = 0, 'f: coaching tips must not reach the employer';
  ASSERT position('SECRET-OUTLINE' in _card::text) = 0, 'f: suggested outline must not reach the employer';
  ASSERT position('improvements' in _card::text) = 0, 'f: improvements (coaching) must not reach the employer';
  ASSERT (_card->'items'->0->>'audio_path') IS NOT NULL, 'f: audio path for server-side signing';

  -- viewing is logged once per hour
  SELECT count(*) INTO _before FROM public.employer_activity WHERE kind = 'interview_card_viewed';
  PERFORM public.get_applicant_interview_card((SELECT app_id FROM t));
  SELECT count(*) INTO _after FROM public.employer_activity WHERE kind = 'interview_card_viewed';
  ASSERT _before = _after, 'f: repeat view within the hour must not log again';
END $t$;
RESET ROLE;
DO $t$
BEGIN
  ASSERT (SELECT count(*) FROM public.employer_activity WHERE kind = 'interview_card_viewed') = 1, 'f: first view logged to employer_activity';
  ASSERT (SELECT count(*) FROM public.interview_card_views) = 1, 'f: view recorded for the candidate';
END $t$;

-- g. an employer from another company is refused
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT emp_other FROM t),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $t$
BEGIN
  BEGIN
    PERFORM public.get_applicant_interview_card((SELECT app_id FROM t));
    ASSERT false, 'g: other-company employer must be refused';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%insufficient_permissions%', 'g: expected insufficient_permissions, got ' || SQLERRM;
  END;
  BEGIN
    PERFORM public.get_job_interview_card_badges((SELECT job FROM t));
    ASSERT false, 'g: other-company badges must be refused';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%insufficient_permissions%', 'g: expected insufficient_permissions, got ' || SQLERRM;
  END;
END $t$;

-- h. candidate sees who viewed, then revokes; employer immediately loses access
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT cand FROM t),'role','authenticated')::text, true);
DO $t$
BEGIN
  ASSERT (SELECT count(*) FROM public.get_my_interview_card_views()) = 1, 'h: candidate sees the company that viewed';
  PERFORM public.set_application_card_share((SELECT app_id FROM t), false);
END $t$;

SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT emp FROM t),'role','authenticated')::text, true);
DO $t$
BEGIN
  ASSERT (SELECT count(*) FROM public.get_job_interview_card_badges((SELECT job FROM t))) = 0, 'h: badge gone after revoke';
  BEGIN
    PERFORM public.get_applicant_interview_card((SELECT app_id FROM t));
    ASSERT false, 'h: revoked card must not be readable';
  EXCEPTION WHEN OTHERS THEN ASSERT SQLERRM LIKE '%not_shared%', 'h: expected not_shared, got ' || SQLERRM;
  END;
END $t$;

-- i. delete returns the audio paths to purge and cascades everything
SELECT set_config('request.jwt.claims',
  json_build_object('sub',(SELECT cand FROM t),'role','authenticated')::text, true);
DO $t$
DECLARE _paths text[];
BEGIN
  _paths := public.delete_my_interview_card();
  ASSERT array_length(_paths, 1) >= 3, 'i: audio paths returned for storage purge';
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_cards), 'i: card deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_card_items), 'i: items deleted';
END $t$;
RESET ROLE;
DO $t$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_card_shares), 'i: shares cascaded';
  ASSERT NOT EXISTS (SELECT 1 FROM public.interview_card_views), 'i: views cascaded';
END $t$;

ROLLBACK;
SELECT 'interview_card.sql OK' AS result;

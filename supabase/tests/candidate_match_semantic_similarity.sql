-- candidate_match_semantic_similarity.sql -- tests for 20261012140000_candidate_match_semantic_similarity.sql.
-- LOCAL ONLY. Requires supabase/tests/fixtures/seed_local.sql to be loaded.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/candidate_match_semantic_similarity.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

SELECT md5((
    (SELECT string_agg(to_jsonb(cp)::text, '' ORDER BY cp.user_id) FROM public.candidate_profiles cp),
    (SELECT string_agg(to_jsonb(j)::text, '' ORDER BY j.id) FROM public.jobs j)
)::text) AS before_fp \gset

BEGIN;

CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN _uid IS NULL THEN '{}' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true);
END $f$;

DO $t$
DECLARE
  _cand constant uuid := '00000000-0000-4000-8000-00000000c001';
  _job uuid;
  _employer constant uuid := '00000000-0000-4000-8000-00000000e001';
  -- _v1 all-ones, _v2 alternating +1/-1: same magnitude, different DIRECTION (cosine ~0 between them).
  -- array_fill alone is wrong here — two array_fill vectors differ only in magnitude, and cosine
  -- similarity is magnitude-invariant, so they'd score as identical (caught by this test failing first).
  _v1 vector(1536) := array_fill(1::float4, ARRAY[1536])::vector(1536);
  _v2 vector(1536);
  _result jsonb;
  _breakdown jsonb;
  _no_emb_result jsonb;
  _identical_result jsonb;
  _opposite_result jsonb;
BEGIN
  SELECT id INTO _job FROM public.jobs WHERE company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;
  ASSERT _job IS NOT NULL, 'precondition: need a job owned by d001';

  SELECT array_agg(CASE WHEN i % 2 = 0 THEN 1 ELSE -1 END)::vector(1536)
  INTO _v2 FROM generate_series(1, 1536) i;

  -- 1. Weights still sum to 100 at the base (skill 55 + location 17 + experience 15 + salary 5 + semantic 8).
  UPDATE public.candidate_profiles SET skills_embedding = NULL WHERE user_id = _cand;
  UPDATE public.jobs SET skills_embedding = NULL WHERE id = _job;
  _result := public.compute_candidate_match(_cand, _job, false);
  _breakdown := _result->'breakdown';
  ASSERT (_breakdown->>'skills')::int + (_breakdown->>'location')::int + (_breakdown->>'experience')::int
       + (_breakdown->>'salary')::int + (_breakdown->>'semantic')::int = (_result->>'score')::int,
    format('1: base components must sum to the total score, got %s', _result);

  -- 2. Neither side has an embedding -> neutral half-credit (4 of 8), never a penalty.
  ASSERT (_breakdown->>'semantic')::int = 4,
    format('2: missing-both-embeddings should give neutral semantic=4, got %s', _breakdown->>'semantic');
  _no_emb_result := _result;

  -- 3. Only the candidate has an embedding (job does not) -> still neutral 4, not treated as a mismatch.
  UPDATE public.candidate_profiles SET skills_embedding = _v1 WHERE user_id = _cand;
  _result := public.compute_candidate_match(_cand, _job, false);
  ASSERT (_result->'breakdown'->>'semantic')::int = 4,
    format('3: one-sided embedding should still give neutral semantic=4, got %s', _result->'breakdown'->>'semantic');

  -- 4. Identical embeddings on both sides -> full 8 points.
  UPDATE public.jobs SET skills_embedding = _v1 WHERE id = _job;
  _identical_result := public.compute_candidate_match(_cand, _job, false);
  ASSERT (_identical_result->'breakdown'->>'semantic')::int = 8,
    format('4: identical embeddings should score full semantic=8, got %s', _identical_result->'breakdown'->>'semantic');

  -- 5. A clearly different embedding scores semantic below the identical case (direction is right).
  UPDATE public.jobs SET skills_embedding = _v2 WHERE id = _job;
  _opposite_result := public.compute_candidate_match(_cand, _job, false);
  ASSERT (_opposite_result->'breakdown'->>'semantic')::int < (_identical_result->'breakdown'->>'semantic')::int,
    format('5: a less similar embedding must score lower semantic than an identical one: %s vs %s',
           _opposite_result->'breakdown'->>'semantic', _identical_result->'breakdown'->>'semantic');

  -- 6. The total score is still clamped to [0, 100].
  UPDATE public.jobs SET skills_embedding = _v1 WHERE id = _job;
  _result := public.compute_candidate_match(_cand, _job, true);
  ASSERT (_result->>'score')::int BETWEEN 0 AND 100, format('6: score out of [0,100]: %s', _result->>'score');

  -- 7. Bonuses (activity/intent/proximity) and tags are untouched by this change.
  ASSERT (_result->'breakdown') ? 'activity' AND (_result->'breakdown') ? 'intent'
     AND (_result->'breakdown') ? 'proximity', format('7: bonus keys missing from breakdown: %s', _result->'breakdown');

  -- 8. Caller functions still run without error and surface the new breakdown key end to end.
  PERFORM pg_temp.act_as(_employer);
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.search_candidates_for_company(
    _company_id => '00000000-0000-4000-8000-00000000d001'::uuid, _job_id => _job,
    _limit => 10, _offset => 0, _sort_by => 'match'
  ) WHERE match_breakdown ? 'semantic' LIMIT 1;
  ASSERT FOUND, '8: search_candidates_for_company must surface the new semantic breakdown key';
  RESET ROLE;
END $t$;

ROLLBACK;

SELECT md5((
    (SELECT string_agg(to_jsonb(cp)::text, '' ORDER BY cp.user_id) FROM public.candidate_profiles cp),
    (SELECT string_agg(to_jsonb(j)::text, '' ORDER BY j.id) FROM public.jobs j)
)::text) = :'before_fp' AS untouched \gset
\if :untouched
\echo 'candidate_match_semantic_similarity: all assertions passed, fixtures unchanged (rolled back cleanly)'
\else
DO $$ BEGIN RAISE EXCEPTION 'candidate_match_semantic_similarity: fixture fingerprint CHANGED - the test left residue'; END $$;
\endif

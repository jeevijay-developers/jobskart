-- recommendation_routed.sql -- tests for 20261008100534_recommendation_logging_and_router.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql to be loaded.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/recommendation_routed.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

BEGIN;

-- ---------------------------------------------------------------------------
-- a. schema
-- ---------------------------------------------------------------------------
DO $t$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'job_impressions'
     AND column_name IN ('request_id','variant','score','rank_score','recommendation_stage',
                         'sort','relevant_only','reason_codes','features','feature_version');
  ASSERT _n = 10, format('a: expected 10 new job_impressions columns, got %s', _n);

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('recommend_jobs_routed','recommendation_fetch_v1','log_job_view');
  ASSERT _n = 3, format('a: expected 3 new functions, got %s', _n);

  -- exact attribute order of job_feed_row
  ASSERT (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
           WHERE a.attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.job_feed_row'::regtype)
             AND a.attnum > 0 AND NOT a.attisdropped)
       = ARRAY['id','company_id','title','city','state','locality','min_salary','max_salary','salary_period',
               'job_type','work_mode','min_experience_years','max_experience_years','education','skills',
               'created_at','pay_type','avg_incentive_monthly','company_name','company_is_verified',
               'boosted','score','score_breakdown','recommendation_stage','total_count',
               'request_id','variant','rank_score','reason_codes','features'],
     'a: job_feed_row must have exactly these 30 attributes in this order';

  -- first 25 attributes == V1 RETURNS TABLE columns (names + types, in order)
  ASSERT (SELECT array_agg(n::text || ':' || t::text ORDER BY ord)
            FROM (SELECT p.proargnames[i] AS n, (p.proallargtypes::oid[])[i]::regtype AS t,
                         row_number() OVER (ORDER BY i) AS ord
                    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace,
                         generate_series(1, array_length(p.proargnames, 1)) i
                   WHERE ns.nspname = 'public' AND p.proname = 'recommend_jobs_for_candidate' AND p.pronargs = 20
                     AND p.proargmodes[i] = 't') s)
       = (SELECT array_agg(a.attname::text || ':' || a.atttypid::regtype::text ORDER BY a.attnum)
            FROM pg_attribute a
           WHERE a.attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.job_feed_row'::regtype)
             AND a.attnum BETWEEN 1 AND 25),
     'a: first 25 job_feed_row attributes must match V1 output columns 1:1';

  -- V1 and router signatures: 20 and 21 params, fetch helper 23
  ASSERT (SELECT pronargs FROM pg_proc WHERE proname = 'recommend_jobs_routed') = 21, 'a: router must have 21 params';
  ASSERT (SELECT pronargs FROM pg_proc WHERE proname = 'recommendation_fetch_v1') = 23, 'a: fetch_v1 must have 23 params';
  ASSERT (SELECT count(*) FROM pg_proc WHERE proname = 'recommend_jobs_for_candidate') = 1, 'a: exactly one V1 overload';

  -- all three are SECURITY DEFINER with fixed search_path
  ASSERT (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public'])
            FROM pg_proc WHERE proname IN ('recommend_jobs_routed','recommendation_fetch_v1','log_job_view')),
     'a: new functions must be SECURITY DEFINER with search_path=public';
END
$t$;

-- ---------------------------------------------------------------------------
-- b. identical ordering (and full rows) vs V1
--
-- V1's final ORDER BY ends in `created_at DESC` with no unique tiebreaker, so rows that tie on the
-- sort key (the fixtures share created_at values) can come back in a different order from one call
-- to the next -- including V1 vs V1, because plpgsql switches to a generic plan after a few executions.
-- The router adds no ordering of its own, so the comparison is:
--   * exact (full row JSON, same order) whenever V1 and the router agree, which is the normal case;
--   * otherwise (tie-permutation only) the SORT-KEY SEQUENCE must be identical, ids must be unique,
--     and every routed row must equal V1's row of the same id (taken from V1's full list).
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _uid uuid; _routed jsonb; _v1 jsonb; _full jsonb; _checks int := 0; _exact int := 0; _relaxed int := 0; _nrows int;
  _keyf text;
  _cands uuid[] := ARRAY[
    '00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c003',
    '00000000-0000-4000-8000-00000000c010','00000000-0000-4000-8000-00000000c013',
    '00000000-0000-4000-8000-00000000c005','00000000-0000-4000-8000-00000000c002']::uuid[];
  _combo record;
BEGIN
  FOREACH _uid IN ARRAY _cands LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    ASSERT auth.uid() = _uid, 'b: jwt claim not applied';

    FOR _combo IN
      SELECT * FROM (VALUES
        ('recommended', false, 30, 0), ('newest', false, 30, 0), ('oldest', false, 30, 0),
        ('salary_high', false, 30, 0), ('salary_low', false, 30, 0),
        ('recommended', true, 30, 0), ('newest', true, 30, 0),
        ('recommended', false, 14, 14), ('recommended', false, 14, 0), ('newest', false, 14, 14)
      ) v(s, ro, lim, off)
    LOOP
      _keyf := CASE _combo.s WHEN 'recommended' THEN 'score' WHEN 'salary_high' THEN 'max_salary'
                             WHEN 'salary_low' THEN 'min_salary' ELSE 'created_at' END;

      SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'ord' - 'request_id' - 'variant' - 'rank_score' - 'reason_codes' - 'features' ORDER BY ord), '[]')
        INTO _routed
        FROM public.recommend_jobs_routed(_limit => _combo.lim, _offset => _combo.off, _sort => _combo.s,
                                          _relevant_only => _combo.ro, _surface => 'dashboard') WITH ORDINALITY AS r(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, request_id, variant, rank_score, reason_codes, features, ord);
      SELECT COALESCE(jsonb_agg(to_jsonb(v) - 'ord' ORDER BY ord), '[]')
        INTO _v1
        FROM public.recommend_jobs_for_candidate(_limit => _combo.lim, _offset => _combo.off, _sort => _combo.s,
                                                 _relevant_only => _combo.ro) WITH ORDINALITY AS v(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, ord);

      IF _routed = _v1 THEN
        _exact := _exact + 1;
      ELSE
        -- tie permutation only: same length, same key sequence, unique ids, rows identical to V1's rows
        SELECT COALESCE(jsonb_agg(to_jsonb(f) - 'ord'), '[]') INTO _full
          FROM public.recommend_jobs_for_candidate(_limit => 1000, _offset => 0, _sort => _combo.s,
                                                   _relevant_only => _combo.ro) AS f;
        ASSERT jsonb_array_length(_routed) = jsonb_array_length(_v1),
          format('b: length differs for %s sort=%s ro=%s', _uid, _combo.s, _combo.ro);
        ASSERT (SELECT jsonb_agg(e->>_keyf) FROM jsonb_array_elements(_routed) e)
               IS NOT DISTINCT FROM (SELECT jsonb_agg(e->>_keyf) FROM jsonb_array_elements(_v1) e),
          format('b: sort-key sequence differs for %s sort=%s ro=%s limit=%s offset=%s', _uid, _combo.s, _combo.ro, _combo.lim, _combo.off);
        ASSERT (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(_routed) e) = jsonb_array_length(_routed),
          'b: duplicate ids in routed result';
        ASSERT NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(_routed) e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_full) f WHERE f = e)),
          format('b: routed row not equal to any V1 row for %s sort=%s ro=%s', _uid, _combo.s, _combo.ro);
        _relaxed := _relaxed + 1;
        RAISE NOTICE 'b: tie-permutation only (V1 unstable tiebreak): % sort=% ro=% limit=% offset=%', _uid, _combo.s, _combo.ro, _combo.lim, _combo.off;
      END IF;
      _checks := _checks + 1;
    END LOOP;

    -- sanity: the default combo returns something, so equality is not vacuous
    SELECT count(*) INTO _nrows FROM public.recommend_jobs_routed(_limit => 30, _offset => 0, _sort => 'recommended', _surface => 'dashboard');
    ASSERT _nrows > 0, format('b: candidate %s got zero rows (vacuous comparison)', _uid);
  END LOOP;
  ASSERT _checks = 60, format('b: expected 60 comparisons, ran %s', _checks);
  ASSERT _exact >= 30, format('b: too few exact matches (%s exact, %s relaxed)', _exact, _relaxed);
  RAISE NOTICE 'b: % comparisons, % exact, % tie-permutation', _checks, _exact, _relaxed;
END
$t$;

-- ---------------------------------------------------------------------------
-- c. logging
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _ret uuid[]; _scores numeric[]; _n int; _req uuid; _before int;
BEGIN
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  -- c1. dashboard surface, offset 5
  SELECT array_agg(id ORDER BY ord), array_agg(round(score, 4) ORDER BY ord) INTO _ret, _scores
    FROM public.recommend_jobs_routed(_limit => 10, _offset => 5, _sort => 'recommended', _relevant_only => true, _surface => 'dashboard')
         WITH ORDINALITY AS r(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, request_id, variant, rank_score, reason_codes, features, ord);
  ASSERT cardinality(_ret) > 0, 'c: router returned no rows';

  SELECT count(*), count(DISTINCT request_id), min(request_id::text)::uuid INTO _n, _before, _req
    FROM public.job_impressions WHERE candidate_user_id = _uid;
  ASSERT _n = cardinality(_ret), format('c: expected %s impression rows, got %s', cardinality(_ret), _n);
  ASSERT _before = 1 AND _req IS NOT NULL, 'c: one request_id for the whole call';
  ASSERT (SELECT array_agg(job_id ORDER BY "position") FROM public.job_impressions WHERE candidate_user_id = _uid) = _ret,
    'c: impression job order must equal returned order';
  ASSERT (SELECT array_agg("position" ORDER BY "position") FROM public.job_impressions WHERE candidate_user_id = _uid)
         = (SELECT array_agg(g) FROM generate_series(5, 5 + cardinality(_ret) - 1) g),
    'c: positions must be contiguous starting at _offset';
  ASSERT (SELECT array_agg(score ORDER BY "position") FROM public.job_impressions WHERE candidate_user_id = _uid) = _scores,
    'c: logged score must equal returned score';
  ASSERT (SELECT bool_and(variant = 'v1' AND source = 'recommended' AND sort = 'recommended'
                          AND relevant_only IS TRUE AND feature_version = 1 AND features IS NOT NULL
                          AND recommendation_stage IS NOT NULL)
            FROM public.job_impressions WHERE candidate_user_id = _uid),
    'c: variant/source/sort/relevant_only/stage/features recorded';
  ASSERT (SELECT (features ? 'skill') FROM public.job_impressions WHERE candidate_user_id = _uid LIMIT 1),
    'c: features should carry the score breakdown components';

  -- c2. identical repeat within 10 s adds ZERO rows
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _offset => 5, _sort => 'recommended', _relevant_only => true, _surface => 'dashboard');
  SELECT count(*) INTO _n FROM public.job_impressions WHERE candidate_user_id = _uid;
  ASSERT _n = cardinality(_ret), format('c: repeat call must add 0 rows, table has %s (expected %s)', _n, cardinality(_ret));

  -- c3. different _sort DOES add rows (and records that sort)
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _offset => 5, _sort => 'newest', _relevant_only => true, _surface => 'dashboard');
  SELECT count(*) INTO _n FROM public.job_impressions WHERE candidate_user_id = _uid AND sort = 'newest';
  ASSERT _n > 0, 'c: different sort must log rows';

  -- c4. after the burst window the identical call logs again
  UPDATE public.job_impressions SET shown_at = now() - interval '11 seconds' WHERE candidate_user_id = _uid;
  SELECT count(*) INTO _before FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _offset => 5, _sort => 'recommended', _relevant_only => true, _surface => 'dashboard');
  SELECT count(*) INTO _n FROM public.job_impressions WHERE candidate_user_id = _uid;
  ASSERT _n = _before + cardinality(_ret), 'c: identical call after 11 s must log again';

  -- c4b. burst guard is per (job, sort, source, relevant_only): other surfaces/tabs are not suppressed
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 10, _sort => 'recommended', _relevant_only => true, _surface => 'dashboard');
  ASSERT _n > 0, 'c4b: baseline call returned nothing';
  SELECT count(*) INTO _before FROM public.job_impressions WHERE candidate_user_id = _uid;
  ASSERT _before = _n, 'c4b: baseline logged all rows';
  -- identical repeat => 0 new rows
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _sort => 'recommended', _relevant_only => true, _surface => 'dashboard');
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid) = _before, 'c4b: identical repeat must add 0 rows';
  -- same sort + surface, different _relevant_only => rows ARE added (all of them)
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 10, _sort => 'recommended', _relevant_only => false, _surface => 'dashboard');
  ASSERT _n > 0, 'c4b: relevant_only=false returned nothing';
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid AND relevant_only IS FALSE) = _n,
    'c4b: different _relevant_only must log all of its rows';
  -- repeat of the relevant_only=false call is deduped
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _sort => 'recommended', _relevant_only => false, _surface => 'dashboard');
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid AND relevant_only IS FALSE) = _n,
    'c4b: repeat of relevant_only=false must add 0 rows';
  -- same sort + relevant_only, different surface => different source => rows added
  SELECT count(*) INTO _before FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 10, _sort => 'recommended', _relevant_only => true, _surface => 'browse');
  ASSERT _n > 0, 'c4b: browse call returned nothing';
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid AND source = 'browse') = _n,
    'c4b: different source (surface) must log all of its rows';
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid) = _before + _n, 'c4b: only the browse rows were added';
  -- search source (query typed) is also distinct from browse
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _q => 'driver', _sort => 'recommended', _relevant_only => true, _surface => 'browse');
  ASSERT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND source = 'search'), 'c4b: search source logged';

  -- c5. source mapping
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _sort => 'recommended', _surface => 'browse');
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid AND source = 'browse') = 5,
    'c: surface=browse without _q must log source=browse';
  -- (a whitespace-only _q is not tested: V1 itself returns zero rows for it, so nothing is logged)
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _q => 'driver', _surface => 'browse');
  ASSERT (SELECT count(*) FROM public.job_impressions WHERE candidate_user_id = _uid) > 0,
    'c: query "driver" should return and log rows (fixture dependent)';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND source <> 'search'),
    'c: surface=browse with _q must log source=search';
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _q => 'driver', _surface => 'dashboard');
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND source <> 'recommended')
         AND EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid),
    'c: surface=dashboard always logs source=recommended';

  -- c6. every logged source satisfies the CHECK constraint ("top" bug); unknown surface behaves as browse
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _surface => 'nonsense');
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND source <> 'browse'),
    'c: unknown surface falls back to browse';

  -- c7. invalid _sort normalised in the log as well
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5, _sort => 'bogus');
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND sort <> 'recommended')
         AND EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid),
    'c: invalid sort logged as recommended';

  -- c8. empty result (impossible filter) -> no rows, no log, no error
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 5, _city => 'no-such-city-xyz');
  ASSERT _n = 0, 'c: impossible city filter should return nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid), 'c: empty result logs nothing';
END
$t$;

-- ---------------------------------------------------------------------------
-- d. employer / non-candidate / unauthenticated
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _emp constant uuid := '00000000-0000-4000-8000-00000000e001';
  _n int; _raised boolean := false;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.candidate_profiles WHERE user_id = _emp), 'd: fixture e001 must not be a candidate';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _emp, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 10, _surface => 'browse');
  ASSERT _n > 0, 'd: employer should still get feed rows';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _emp),
    'd: employer must have ZERO impressions logged';

  -- unauthenticated
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  ASSERT auth.uid() IS NULL, 'd: auth.uid() should be null';
  BEGIN
    PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 5);
  EXCEPTION WHEN OTHERS THEN
    _raised := true;
    ASSERT SQLERRM = 'not_authenticated', format('d: wrong error: %s', SQLERRM);
  END;
  ASSERT _raised, 'd: unauthenticated call must raise not_authenticated';
END
$t$;

-- ---------------------------------------------------------------------------
-- e. privileges (roles)
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _job constant uuid := '00000000-0000-4000-8000-00000000b001';
  _n int; _denied boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  -- authenticated: router + log_job_view callable, fetch helper NOT
  SET LOCAL ROLE authenticated;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 3, _surface => 'browse');
  PERFORM public.log_job_view(_job);
  _denied := false;
  BEGIN
    PERFORM count(*) FROM public.recommendation_fetch_v1('v1', gen_random_uuid(), NULL::text[], 3, 0, NULL, NULL, NULL, NULL, NULL,
                                                         NULL::int, NULL::int, NULL::int, NULL::int, NULL::timestamptz,
                                                         NULL, NULL, NULL, NULL, false, false, false, 'recommended');
  EXCEPTION WHEN insufficient_privilege THEN _denied := true;
  END;
  RESET ROLE;
  ASSERT _denied, 'e: authenticated must NOT be able to call recommendation_fetch_v1';


  -- anon: both public functions denied
  SET LOCAL ROLE anon;
  _denied := false;
  BEGIN
    PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 3);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true;
  END;
  RESET ROLE;
  ASSERT _denied, 'e: anon must NOT be able to call recommend_jobs_routed';

  SET LOCAL ROLE anon;
  _denied := false;
  BEGIN
    PERFORM public.log_job_view(_job);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true;
  END;
  RESET ROLE;
  ASSERT _denied, 'e: anon must NOT be able to call log_job_view';

  -- ACL level double-check (no PUBLIC/anon grant on any of the three)
  ASSERT NOT has_function_privilege('anon', 'public.log_job_view(uuid)', 'EXECUTE'), 'e: anon acl log_job_view';
  ASSERT has_function_privilege('authenticated', 'public.log_job_view(uuid)', 'EXECUTE'), 'e: authenticated acl log_job_view';
  ASSERT NOT has_function_privilege('authenticated',
      'public.recommendation_fetch_v1(text,uuid,text[],int,int,text,text,text,text,text,int,int,int,int,timestamptz,text,text,text,text,boolean,boolean,boolean,text)',
      'EXECUTE'), 'e: authenticated acl fetch_v1';
  ASSERT NOT has_function_privilege('anon',
      'public.recommendation_fetch_v1(text,uuid,text[],int,int,text,text,text,text,text,int,int,int,int,timestamptz,text,text,text,text,boolean,boolean,boolean,text)',
      'EXECUTE'), 'e: anon acl fetch_v1';
END
$t$;

-- ---------------------------------------------------------------------------
-- f. logging failure containment
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.__test_boom() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'boom from test trigger'; END $f$;
CREATE TRIGGER __test_boom BEFORE INSERT ON public.job_impressions
  FOR EACH ROW EXECUTE FUNCTION public.__test_boom();

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  -- the next statement must emit a WARNING (visible in psql output) and still return rows
  SELECT count(*) INTO _n FROM public.recommend_jobs_routed(_limit => 8, _surface => 'dashboard');
  ASSERT _n > 0, 'f: feed must still return rows when impression logging fails';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid),
    'f: no impressions may persist from the failed insert';
  -- and the surrounding transaction is still healthy
  PERFORM 1;
END
$t$;

DROP TRIGGER __test_boom ON public.job_impressions;
DROP FUNCTION public.__test_boom();

-- after the trigger is gone logging works again in the same transaction
DO $t$
DECLARE _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 8, _surface => 'dashboard');
  ASSERT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid), 'f: logging recovers after trigger removed';
END
$t$;

-- ---------------------------------------------------------------------------
-- g. log_job_view
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _cand constant uuid := '00000000-0000-4000-8000-00000000c002';
  _emp  constant uuid := '00000000-0000-4000-8000-00000000e001';
  _job  constant uuid := '00000000-0000-4000-8000-00000000b001';
  _n int;
BEGIN
  DELETE FROM public.job_recommendation_feedback WHERE job_id = _job AND action = 'viewed';

  -- unauthenticated: returns silently
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM public.log_job_view(_job);
  ASSERT (SELECT count(*) FROM public.job_recommendation_feedback WHERE job_id = _job AND action = 'viewed') = 0,
    'g: unauthenticated creates nothing';

  -- employer: nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _emp, 'role', 'authenticated')::text, true);
  PERFORM public.log_job_view(_job);
  ASSERT (SELECT count(*) FROM public.job_recommendation_feedback WHERE job_id = _job AND action = 'viewed') = 0,
    'g: employer creates nothing';

  -- candidate: one row, twice -> still one
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _cand, 'role', 'authenticated')::text, true);
  PERFORM public.log_job_view(_job);
  SELECT count(*) INTO _n FROM public.job_recommendation_feedback WHERE candidate_user_id = _cand AND job_id = _job AND action = 'viewed';
  ASSERT _n = 1, format('g: expected exactly 1 viewed row, got %s', _n);
  PERFORM public.log_job_view(_job);
  SELECT count(*) INTO _n FROM public.job_recommendation_feedback WHERE candidate_user_id = _cand AND job_id = _job AND action = 'viewed';
  ASSERT _n = 1, format('g: same-day repeat must stay 1 row, got %s', _n);

  -- a view from before today's IST midnight does not block a new one
  UPDATE public.job_recommendation_feedback SET created_at = now() - interval '2 days'
   WHERE candidate_user_id = _cand AND job_id = _job AND action = 'viewed';
  PERFORM public.log_job_view(_job);
  SELECT count(*) INTO _n FROM public.job_recommendation_feedback WHERE candidate_user_id = _cand AND job_id = _job AND action = 'viewed';
  ASSERT _n = 2, format('g: a new IST day must log a new view, got %s rows', _n);

  -- nonexistent job: no row, no error
  PERFORM public.log_job_view('00000000-0000-4000-8000-0000000fffff');
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_recommendation_feedback WHERE job_id = '00000000-0000-4000-8000-0000000fffff'),
    'g: nonexistent job creates nothing';

  -- NULL job id: no row, no error
  PERFORM public.log_job_view(NULL);
END
$t$;

-- ---------------------------------------------------------------------------
-- h. invalid _sort behaves like 'recommended'
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c003';
  _bogus jsonb; _rec jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SELECT jsonb_agg(to_jsonb(r) - 'request_id') INTO _bogus FROM public.recommend_jobs_routed(_limit => 20, _sort => 'bogus') r;
  SELECT jsonb_agg(to_jsonb(r) - 'request_id') INTO _rec   FROM public.recommend_jobs_routed(_limit => 20, _sort => 'recommended') r;
  ASSERT _bogus IS NOT NULL AND _bogus = _rec, 'h: bogus sort must equal recommended';
END
$t$;

ROLLBACK;

-- Run locally:  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/recommendation_v2.sql
-- Sections 1-4 are pure (no reads/writes): safe on any database.
-- Section 5 writes inside a transaction and ROLLS BACK: run on local/staging only.

-- ── 1. event strength ──────────────────────────────────────
DO $$
BEGIN
    ASSERT public.recommendation_event_strength(1.0, 0) = 1.0, 'age 0 keeps full weight';
    ASSERT abs(public.recommendation_event_strength(1.0, 3.5) - 0.5) < 1e-9, 'one half-life halves it';
    ASSERT abs(public.recommendation_event_strength(1.0, 7) - 0.25) < 1e-9, 'two half-lives quarter it';
    ASSERT public.recommendation_event_strength(0.8, -5) = 0.8, 'negative age clamps to 0';
    ASSERT public.recommendation_event_strength(1.0, 1) > public.recommendation_event_strength(1.0, 2), 'older is weaker';
END $$;

-- ── 2. blend ───────────────────────────────────────────────
DO $$
BEGIN
    ASSERT public.recommendation_blend(0.62, 0, 0, 0, 0, false, 0.85) = 0.62,
        'no intent weight => exactly the V1 score (cold start keeps V1 order)';
    ASSERT public.recommendation_blend(0.5, 1, 0, 0.10, 0.15, false, 0.85) = 0.475,
        'intent 1.0 at weight 0.10 on base 0.5 => 0.75*0.5 + 0.10';
    ASSERT public.recommendation_blend(0.8, 0, 0, 0, 0, true, 0.85) = 0.68,
        'fatigue multiplies the final score';
    ASSERT public.recommendation_blend(0.1, 0, 0, 0.9, 0.9, false, 1) = 0,
        'result is clamped at 0';
    ASSERT public.recommendation_blend(0.5, 0.8, 0, 0.10, 0.15, false, 0.85)
         > public.recommendation_blend(0.5, 0.2, 0, 0.10, 0.15, false, 0.85),
        'more intent => higher score';
    ASSERT public.recommendation_blend(0.5, 0, 0.9, 0.10, 0.15, false, 0.85)
         > public.recommendation_blend(0.5, 0, 0.1, 0.10, 0.15, false, 0.85),
        'more similarity => higher score';
END $$;

-- ── 3. reason codes ────────────────────────────────────────
DO $$
BEGIN
    ASSERT public.recommendation_reason_codes(
        '{"skill":0.8,"role":0.75,"experience":0.5,"location":1,"salary":0.5,"semantic":0.5,"freshness":0.9}'::jsonb,
        0.3, 0.1, false
    ) = ARRAY['SKILL_MATCH','ROLE_MATCH','LOCATION_MATCH','FRESHNESS','RECENT_INTENT'],
        'codes appear in fixed order and only above their thresholds';
    ASSERT public.recommendation_reason_codes(NULL, 0.3, 0, false) = ARRAY['RECENT_INTENT'],
        'NULL breakdown must not raise';
    ASSERT public.recommendation_reason_codes('{}'::jsonb, 0, 0.5, true) = ARRAY['SIMILAR_JOB','REPEAT_EXPOSURE_DEMOTED'],
        'similarity and fatigue codes';
    ASSERT cardinality(public.recommendation_reason_codes('{}'::jsonb, 0, 0, false)) = 0,
        'nothing notable => empty array';
END $$;

-- ── 4. bucket ──────────────────────────────────────────────
DO $$
DECLARE
    u uuid := gen_random_uuid();
    in_range int; low int; differing int;
BEGIN
    ASSERT public.recommendation_bucket(u, 's') = public.recommendation_bucket(u, 's'), 'deterministic';

    SELECT count(*) FILTER (WHERE b BETWEEN 0 AND 99),
           count(*) FILTER (WHERE b < 10)
    INTO in_range, low
    FROM (SELECT public.recommendation_bucket(gen_random_uuid(), 'jk') AS b FROM generate_series(1, 10000)) t;
    ASSERT in_range = 10000, 'always 0..99';
    ASSERT low BETWEEN 700 AND 1300, format('about 10%% fall under 10, got %s', low);

    SELECT count(*) INTO differing
    FROM (SELECT x, public.recommendation_bucket(x, 'a') <> public.recommendation_bucket(x, 'b') AS d
          FROM (SELECT gen_random_uuid() AS x FROM generate_series(1, 1000)) g) t
    WHERE d;
    ASSERT differing >= 900, format('changing the salt reshuffles buckets, got %s differing', differing);
END $$;

-- ── 5. rollout flag logic (WRITES settings inside a transaction, then ROLLS BACK) ──
BEGIN;

UPDATE public.recommendation_settings
SET v2_enabled = false, v2_rollout_pct = 100, v2_allowlist = '{}' WHERE id = 1;
DO $$ BEGIN
    ASSERT NOT public.recommendation_v2_active(gen_random_uuid()), 'kill switch beats a 100% rollout';
END $$;

UPDATE public.recommendation_settings SET v2_enabled = true, v2_rollout_pct = 0 WHERE id = 1;
DO $$ BEGIN
    ASSERT NOT public.recommendation_v2_active(gen_random_uuid()), '0% rollout => nobody';
END $$;

UPDATE public.recommendation_settings SET v2_rollout_pct = 100 WHERE id = 1;
DO $$ BEGIN
    ASSERT public.recommendation_v2_active(gen_random_uuid()), '100% rollout => everyone';
END $$;

UPDATE public.recommendation_settings
SET v2_rollout_pct = 0, v2_allowlist = ARRAY['00000000-0000-0000-0000-000000000001'::uuid] WHERE id = 1;
DO $$ BEGIN
    ASSERT public.recommendation_v2_active('00000000-0000-0000-0000-000000000001'::uuid), 'allowlisted user is in at 0%';
    ASSERT NOT public.recommendation_v2_active('00000000-0000-0000-0000-000000000002'::uuid), 'others are not';
END $$;

UPDATE public.recommendation_settings SET v2_enabled = false WHERE id = 1;
DO $$ BEGIN
    ASSERT NOT public.recommendation_v2_active('00000000-0000-0000-0000-000000000001'::uuid),
        'kill switch also beats the allowlist';
END $$;

ROLLBACK;

-- ── 6. recommendation_rerank: shape + set-preservation + cold-start blend ──
-- Read-only (no writes outside the DO blocks' own set_config session var).
-- Requires fixtures loaded: candidates c001 (has recent applications/saved_jobs),
-- c013 and c014 (no engagement rows) from supabase/tests/fixtures/seed_local.sql.
DO $$
DECLARE
    r1 public.job_feed_row[];
    r2 public.job_feed_row[];
BEGIN
    r1 := public.recommendation_rerank('00000000-0000-4000-8000-00000000c001'::uuid, NULL);
    ASSERT r1 IS NULL, 'NULL _rows must pass through as NULL';
    r2 := public.recommendation_rerank('00000000-0000-4000-8000-00000000c001'::uuid, ARRAY[]::public.job_feed_row[]);
    ASSERT r2 IS NOT NULL AND cardinality(r2) = 0, 'empty-array _rows must pass through as empty array';
END $$;

DO $$
DECLARE
    cand uuid;
    win public.job_feed_row[];
    out public.job_feed_row[];
    n_added int;
    n_removed int;
    n_dup int;
BEGIN
    FOR cand IN SELECT unnest(ARRAY[
        '00000000-0000-4000-8000-00000000c001'::uuid,  -- has engagement
        '00000000-0000-4000-8000-00000000c013'::uuid,  -- cold start
        '00000000-0000-4000-8000-00000000c014'::uuid   -- cold start
    ])
    LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', cand, 'role', 'authenticated')::text, true);
        win := ARRAY(SELECT r FROM public.recommendation_fetch_v1(
            'v1', gen_random_uuid(), NULL::text[], 140, 0, NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false, false, 'recommended'
        ) AS r);
        out := public.recommendation_rerank(cand, win);

        ASSERT cardinality(win) = cardinality(out), format('candidate %s: row count changed', cand);

        SELECT count(*) INTO n_added
        FROM (SELECT (u).id FROM unnest(out) u EXCEPT ALL SELECT (u).id FROM unnest(win) u) x;
        SELECT count(*) INTO n_removed
        FROM (SELECT (u).id FROM unnest(win) u EXCEPT ALL SELECT (u).id FROM unnest(out) u) x;
        SELECT count(*) - count(DISTINCT (u).id) INTO n_dup FROM unnest(out) u;

        ASSERT n_added = 0, format('candidate %s: rerank added ids', cand);
        ASSERT n_removed = 0, format('candidate %s: rerank removed ids', cand);
        ASSERT n_dup = 0, format('candidate %s: rerank duplicated ids', cand);
    END LOOP;
END $$;

-- Cold start (no engagement rows at all): weights are forced to 0, so rank_score
-- must equal score exactly (both rounded to 4dp) and no RECENT_INTENT/SIMILAR_JOB codes.
DO $$
DECLARE
    cand uuid := '00000000-0000-4000-8000-00000000c013'::uuid;
    win public.job_feed_row[];
    out public.job_feed_row[];
    rec record;
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cand, 'role', 'authenticated')::text, true);
    win := ARRAY(SELECT r FROM public.recommendation_fetch_v1(
        'v1', gen_random_uuid(), NULL::text[], 140, 0, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false, false, 'recommended'
    ) AS r);
    out := public.recommendation_rerank(cand, win);

    FOR rec IN SELECT (u).score AS score, (u).rank_score AS rank_score, (u).reason_codes AS reason_codes
               FROM unnest(out) u
    LOOP
        ASSERT abs(rec.score - rec.rank_score) < 1e-4, format('cold start: score %s != rank_score %s', rec.score, rec.rank_score);
        ASSERT NOT (rec.reason_codes IS NOT NULL AND 'RECENT_INTENT' = ANY(rec.reason_codes)),
            'cold start must not surface RECENT_INTENT';
        ASSERT NOT (rec.reason_codes IS NOT NULL AND 'SIMILAR_JOB' = ANY(rec.reason_codes)),
            'cold start must not surface SIMILAR_JOB';
    END LOOP;
END $$;

-- ── 7. Router V2 branch (migration section D). LOCAL ONLY; everything inside BEGIN..ROLLBACK. ──
-- Requires fixtures. Fingerprint the settings row first; it must be byte-identical afterwards.
SELECT md5(t::text) AS fp FROM public.recommendation_settings t WHERE id = 1 \gset before_

BEGIN;

-- test helpers (rolled back with everything else)
CREATE FUNCTION public.__t_r(_l int, _o int, _q text, _city text, _cat text, _sort text, _ro boolean)
RETURNS jsonb LANGUAGE sql VOLATILE AS $f$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'ordinality' - 'request_id' - 'variant' - 'rank_score' - 'reason_codes' - 'features'
                            ORDER BY r.ordinality), '[]'::jsonb)
  FROM public.recommend_jobs_routed(_limit => _l, _offset => _o, _q => _q, _city => _city, _category => _cat,
                                    _sort => _sort, _relevant_only => _ro, _surface => 'browse')
       WITH ORDINALITY AS r
$f$;
CREATE FUNCTION public.__t_v(_l int, _o int, _q text, _city text, _cat text, _sort text, _ro boolean)
RETURNS jsonb LANGUAGE sql VOLATILE AS $f$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'ordinality' ORDER BY r.ordinality), '[]'::jsonb)
  FROM public.recommend_jobs_for_candidate(_limit => _l, _offset => _o, _q => _q, _city => _city, _category => _cat,
                                           _sort => _sort, _relevant_only => _ro)
       WITH ORDINALITY AS r
$f$;
-- V1-equality with tie-permutation tolerance (V1 has no unique tiebreaker): same length, same
-- sort-key sequence, unique ids, every routed row identical to a row of V1's full list.
CREATE FUNCTION public.__t_same(_label text, _a jsonb, _b jsonb, _full jsonb, _keyf text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  IF _a = _b THEN RETURN; END IF;
  ASSERT jsonb_array_length(_a) = jsonb_array_length(_b), format('%s: length differs', _label);
  ASSERT (SELECT jsonb_agg(e->>_keyf) FROM jsonb_array_elements(_a) e)
         IS NOT DISTINCT FROM (SELECT jsonb_agg(e->>_keyf) FROM jsonb_array_elements(_b) e),
    format('%s: sort-key sequence differs', _label);
  ASSERT (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(_a) e) = jsonb_array_length(_a),
    format('%s: duplicate ids', _label);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_a) e
                      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_full) f WHERE f = e)),
    format('%s: routed row differs from V1 row', _label);
END $f$;
-- permutation: same multiset of rows, any order
CREATE FUNCTION public.__t_perm(_label text, _a jsonb, _b jsonb) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  ASSERT jsonb_array_length(_a) = jsonb_array_length(_b), format('%s: length %s vs %s', _label, jsonb_array_length(_a), jsonb_array_length(_b));
  ASSERT (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(_a) e)
         IS NOT DISTINCT FROM (SELECT jsonb_agg(e ORDER BY e->>'id') FROM jsonb_array_elements(_b) e),
    format('%s: not a permutation of V1 rows (ids/scores/total_count differ)', _label);
END $f$;

-- ── 7a. flag OFF == Plan 1 behaviour ─────────────────────────
UPDATE public.recommendation_settings
   SET v2_enabled = false, v2_rollout_pct = 100,
       v2_allowlist = ARRAY['00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c003',
                            '00000000-0000-4000-8000-00000000c010','00000000-0000-4000-8000-00000000c013']::uuid[]
 WHERE id = 1;

DO $t$
DECLARE
  _uid uuid; _n int := 0; _a jsonb; _b jsonb; _full jsonb; _bad int;
  _cands uuid[] := ARRAY['00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c003',
                         '00000000-0000-4000-8000-00000000c010','00000000-0000-4000-8000-00000000c013']::uuid[];
BEGIN
  FOREACH _uid IN ARRAY _cands LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    ASSERT auth.uid() = _uid;
    _full := public.__t_v(1000, 0, NULL, NULL, NULL, 'recommended', false);
    FOR _n IN 0..1 LOOP
      _a := public.__t_r(30, 30 * _n, NULL, NULL, NULL, 'recommended', false);
      _b := public.__t_v(30, 30 * _n, NULL, NULL, NULL, 'recommended', false);
      ASSERT jsonb_array_length(_a) > 0 OR _n = 1, format('7a: %s empty page', _uid);
      PERFORM public.__t_same(format('7a %s page %s', _uid, _n), _a, _b, _full, 'score');
    END LOOP;
    SELECT count(*) INTO _bad FROM public.recommend_jobs_routed(_limit => 30) r
     WHERE r.variant IS DISTINCT FROM 'v1' OR r.rank_score IS NOT NULL OR r.reason_codes IS NOT NULL;
    ASSERT _bad = 0, format('7a: %s flag off but %s rows not plain v1', _uid, _bad);
  END LOOP;
  RAISE NOTICE '7a OK: flag off == V1 for 4 candidates, variant v1';
END $t$;

-- ── 7b. V2 ON for c001 only (allowlist, 0% rollout) ──────────
UPDATE public.recommendation_settings
   SET v2_enabled = true, v2_rollout_pct = 0,
       v2_allowlist = ARRAY['00000000-0000-4000-8000-00000000c001']::uuid[]
 WHERE id = 1;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _full jsonb; _w jsonb; _pg jsonb; _lim int; _differs boolean; _win int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  ASSERT public.recommendation_v2_active(_uid), '7b: c001 must be in the V2 arm';
  SELECT v2_window INTO _win FROM public.recommendation_settings WHERE id = 1;
  _full := public.__t_v(1000, 0, NULL, NULL, NULL, 'recommended', false);
  ASSERT jsonb_array_length(_full) > 20 AND jsonb_array_length(_full) <= _win,
    format('7b: fixture assumption: eligible rows (%s) must fit in the window (%s)', jsonb_array_length(_full), _win);

  -- full window page: permutation of V1's rows (V1 window == all eligible rows here, so tie-proof)
  _w := public.__t_r(_win, 0, NULL, NULL, NULL, 'recommended', false);
  PERFORM public.__t_perm('7b full window', _w, _full);
  _differs := _w <> public.__t_v(_win, 0, NULL, NULL, NULL, 'recommended', false);
  RAISE NOTICE '7b: V2 order differs from V1 for c001: %', _differs;

  -- smaller pages: every row identical to V1's row for that job (score/total_count unchanged)
  FOREACH _lim IN ARRAY ARRAY[10, 14, 20] LOOP
    _pg := public.__t_r(_lim, 0, NULL, NULL, NULL, 'recommended', false);
    ASSERT jsonb_array_length(_pg) = _lim, format('7b: page of %s returned %s', _lim, jsonb_array_length(_pg));
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_pg) e
                        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_full) f WHERE f = e)),
      format('7b: page %s has a row differing from V1 (score/total_count must be unchanged)', _lim);
  END LOOP;
END $t$;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _ids uuid[]; _n int; _sc numeric[];
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT array_agg(id ORDER BY ord), array_agg(score ORDER BY ord) INTO _ids, _sc
    FROM public.recommend_jobs_routed(_limit => 20, _offset => 0, _sort => 'recommended', _surface => 'dashboard')
         WITH ORDINALITY AS r(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, request_id, variant, rank_score, reason_codes, features, ord);
  ASSERT cardinality(_ids) = 20, '7b: logged call returned 20';
  SELECT count(*) INTO _n FROM public.job_impressions
   WHERE candidate_user_id = _uid AND variant = 'v2' AND rank_score IS NOT NULL AND reason_codes IS NOT NULL;
  ASSERT _n = 20, format('7b: 20 v2 impressions with rank_score expected, got %s', _n);
  ASSERT (SELECT array_agg(job_id ORDER BY "position") FROM public.job_impressions WHERE candidate_user_id = _uid) = _ids,
    '7b: impression order == returned order';
  ASSERT (SELECT array_agg(score ORDER BY "position") FROM public.job_impressions WHERE candidate_user_id = _uid) = _sc,
    '7b: logged score == returned (V1) score';
  -- per-job score equality with V1
  ASSERT NOT EXISTS (
      SELECT 1 FROM unnest(_ids) WITH ORDINALITY AS t(id, o)
        JOIN public.recommend_jobs_for_candidate(_limit => 1000) v ON v.id = t.id
       WHERE v.score IS DISTINCT FROM _sc[t.o]),
    '7b: score for a job must equal V1 score';
  RAISE NOTICE '7b OK';
END $t$;

-- ── 7c. pagination continuity across the window edge ─────────
UPDATE public.recommendation_settings SET v2_window = 28 WHERE id = 1;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _lim int; _off int; _ids uuid[]; _page uuid[]; _tcs bigint[]; _pagetc bigint[]; _pages int; _v1 uuid[];
  _dups int; _missing int; _extra int; _w uuid[]; _st uuid[]; _nonv2 int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  _v1 := ARRAY(SELECT id FROM public.recommend_jobs_for_candidate(_limit => 1000));
  ASSERT cardinality(_v1) > 28, format('7c: fixture needs > 28 eligible rows, has %s', cardinality(_v1));

  FOREACH _lim IN ARRAY ARRAY[14, 20, 10] LOOP
    _off := 0; _ids := '{}'; _tcs := '{}'; _pages := 0;
    LOOP
      SELECT COALESCE(array_agg(id), '{}'), COALESCE(array_agg(total_count), '{}'), count(*) FILTER (WHERE variant <> 'v2')
        INTO _page, _pagetc, _nonv2
        FROM public.recommend_jobs_routed(_limit => _lim, _offset => _off, _sort => 'recommended', _surface => 'browse');
      ASSERT _nonv2 = 0, '7c: every row of a V2-arm user is labelled v2 (intention-to-treat)';
      EXIT WHEN cardinality(_page) = 0;
      _ids := _ids || _page; _tcs := _tcs || _pagetc; _off := _off + _lim; _pages := _pages + 1;
      ASSERT _pages < 100, '7c: runaway pagination';
    END LOOP;
    SELECT cardinality(_ids) - count(DISTINCT i) INTO _dups FROM unnest(_ids) i;
    SELECT count(*) INTO _missing FROM (SELECT unnest(_v1) EXCEPT SELECT unnest(_ids)) x;
    SELECT count(*) INTO _extra   FROM (SELECT unnest(_ids) EXCEPT SELECT unnest(_v1)) x;
    RAISE NOTICE '7c: page size % (window 28): % pages, % ids, union % vs V1 set %, duplicates %, missing %, extra %, distinct total_count values %',
      _lim, _pages, cardinality(_ids), (SELECT count(DISTINCT i) FROM unnest(_ids) i), cardinality(_v1), _dups, _missing, _extra,
      (SELECT count(DISTINCT t) FROM unnest(_tcs) t);
    ASSERT _dups = 0, format('7c: page size %s: %s duplicate ids across pages', _lim, _dups);
    ASSERT _missing = 0, format('7c: page size %s: %s V1 ids missing', _lim, _missing);
    ASSERT _extra = 0, format('7c: page size %s: %s ids not in V1', _lim, _extra);
    ASSERT cardinality(_ids) = cardinality(_v1), '7c: total ids must equal V1 set size';
    ASSERT (SELECT count(DISTINCT t) FROM unnest(_tcs) t) = 1 AND _tcs[1] = cardinality(_v1),
      format('7c: total_count must be constant and equal to the V1 total (%s)', cardinality(_v1));
  END LOOP;

  -- explicit straddle page: offset 20, limit 14 (positions 21..34) with window 28
  _w  := ARRAY(SELECT id FROM public.recommend_jobs_routed(_limit => 28, _offset => 0, _sort => 'recommended', _surface => 'browse'));
  _st := ARRAY(SELECT id FROM public.recommend_jobs_routed(_limit => 14, _offset => 20, _sort => 'recommended', _surface => 'browse'));
  ASSERT cardinality(_w) = 28 AND cardinality(_st) = 14, format('7c: straddle sizes %s/%s', cardinality(_w), cardinality(_st));
  ASSERT _st[1:8] <@ _w AND NOT (_st[9:14] && _w), '7c: straddle page = last 8 window rows + 6 rows from beyond the window';
  ASSERT _st[1:8] = _w[21:28], '7c: straddle page continues the reranked window order';
  RAISE NOTICE '7c OK: straddle page offset 20 limit 14 = window[21..28] + 6 tail rows';
END $t$;

-- default window again: short-array / out-of-range slices never error
UPDATE public.recommendation_settings SET v2_window = 140 WHERE id = 1;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _tot int; _o int; _l int; _a int; _b int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  _tot := (SELECT count(*) FROM public.recommend_jobs_for_candidate(_limit => 1000));
  FOREACH _o IN ARRAY ARRAY[0, 10, _tot - 6, _tot - 1, _tot, _tot + 1, 100, 139, 140, 141, 500] LOOP
    FOREACH _l IN ARRAY ARRAY[0, 1, 20, 200] LOOP
      SELECT count(*) INTO _a FROM public.recommend_jobs_routed(_limit => _l, _offset => _o, _sort => 'recommended');
      SELECT count(*) INTO _b FROM public.recommend_jobs_for_candidate(_limit => _l, _offset => _o, _sort => 'recommended');
      ASSERT _a = _b, format('7c: offset %s limit %s: routed %s rows vs V1 %s', _o, _l, _a, _b);
    END LOOP;
  END LOOP;
  -- NULL window array (impossible filter): empty, no error, nothing logged
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT count(*) INTO _a FROM public.recommend_jobs_routed(_limit => 20, _city => 'no-such-city-xyz');
  ASSERT _a = 0, '7c: empty window => empty page';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid), '7c: empty page logs nothing';
  RAISE NOTICE '7c OK: slices past/short of the window are sane (offsets x limits compared to V1 counts, tot=%)', _tot;
END $t$;

-- ── 7d. explicit sorts + filters under V2 ────────────────────
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _s text; _keyf text; _a jsonb; _b jsonb; _full jsonb; _city text; _cat text; _bad int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  ASSERT public.recommendation_v2_active(_uid), '7d: still in the arm';

  FOREACH _s IN ARRAY ARRAY['newest','oldest','salary_high','salary_low'] LOOP
    _keyf := CASE _s WHEN 'salary_high' THEN 'max_salary' WHEN 'salary_low' THEN 'min_salary' ELSE 'created_at' END;
    _full := public.__t_v(1000, 0, NULL, NULL, NULL, _s, false);
    _a := public.__t_r(30, 0, NULL, NULL, NULL, _s, false);
    _b := public.__t_v(30, 0, NULL, NULL, NULL, _s, false);
    PERFORM public.__t_same('7d sort ' || _s, _a, _b, _full, _keyf);
    ASSERT jsonb_array_length(_a) > 0, '7d: non-vacuous';
    -- pure V1 path: arm label only, no rerank artefacts
    SELECT count(*) INTO _bad FROM public.recommend_jobs_routed(_limit => 30, _sort => _s) r
     WHERE r.variant IS DISTINCT FROM 'v2' OR r.rank_score IS NOT NULL OR r.reason_codes IS NOT NULL;
    ASSERT _bad = 0, format('7d: sort %s must be plain V1 rows labelled with the arm (v2)', _s);
  END LOOP;

  -- filters (recommended sort => V2 re-ranks inside the window): same row multiset as V1
  SELECT v.city INTO _city FROM public.recommend_jobs_for_candidate(_limit => 1) v LIMIT 1;
  SELECT j.category::text INTO _cat FROM public.recommend_jobs_for_candidate(_limit => 1) v JOIN public.jobs j ON j.id = v.id;
  ASSERT _city IS NOT NULL AND _cat IS NOT NULL, '7d: fixture city/category';
  PERFORM public.__t_perm('7d city',     public.__t_r(140, 0, NULL, _city, NULL, 'recommended', false), public.__t_v(140, 0, NULL, _city, NULL, 'recommended', false));
  PERFORM public.__t_perm('7d category', public.__t_r(140, 0, NULL, NULL, _cat,  'recommended', false), public.__t_v(140, 0, NULL, NULL, _cat,  'recommended', false));
  PERFORM public.__t_perm('7d q',        public.__t_r(140, 0, 'driver', NULL, NULL, 'recommended', false), public.__t_v(140, 0, 'driver', NULL, NULL, 'recommended', false));
  PERFORM public.__t_perm('7d relevant_only', public.__t_r(140, 0, NULL, NULL, NULL, 'recommended', true), public.__t_v(140, 0, NULL, NULL, NULL, 'recommended', true));
  ASSERT jsonb_array_length(public.__t_r(140, 0, NULL, _city, NULL, 'recommended', false)) > 0, '7d: city filter non-vacuous';
  ASSERT jsonb_array_length(public.__t_r(140, 0, NULL, NULL, _cat, 'recommended', false)) > 0, '7d: category filter non-vacuous';
  ASSERT jsonb_array_length(public.__t_r(140, 0, 'driver', NULL, NULL, 'recommended', false)) > 0, '7d: q filter non-vacuous';
  RAISE NOTICE '7d OK (city=%, category=%): city rows %, category rows %, q rows %, unfiltered %', _city, _cat,
    jsonb_array_length(public.__t_r(140, 0, NULL, _city, NULL, 'recommended', false)),
    jsonb_array_length(public.__t_r(140, 0, NULL, NULL, _cat, 'recommended', false)),
    jsonb_array_length(public.__t_r(140, 0, 'driver', NULL, NULL, 'recommended', false)),
    jsonb_array_length(public.__t_r(140, 0, NULL, NULL, NULL, 'recommended', false));
END $t$;

-- ── 7e. automatic fallback: re-ranker missing/broken ─────────
SAVEPOINT s_e;
ALTER FUNCTION public.recommendation_rerank(uuid, public.job_feed_row[]) RENAME TO recommendation_rerank_off;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _full jsonb; _a jsonb; _b jsonb; _n int; _bad int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  _full := public.__t_v(1000, 0, NULL, NULL, NULL, 'recommended', false);
  _a := public.__t_r(30, 0, NULL, NULL, NULL, 'recommended', false);   -- emits a WARNING
  _b := public.__t_v(30, 0, NULL, NULL, NULL, 'recommended', false);
  PERFORM public.__t_same('7e fallback', _a, _b, _full, 'score');
  ASSERT jsonb_array_length(_a) > 0, '7e: non-vacuous';
  SELECT count(*) INTO _bad FROM public.recommend_jobs_routed(_limit => 30, _surface => 'dashboard') r
   WHERE r.reason_codes IS DISTINCT FROM ARRAY['V2_FALLBACK']::text[] OR r.variant <> 'v2' OR r.rank_score IS NOT NULL;
  ASSERT _bad = 0, format('7e: %s fallback rows without {V2_FALLBACK}/variant v2', _bad);
  SELECT count(*) INTO _n FROM public.job_impressions
   WHERE candidate_user_id = _uid AND reason_codes = ARRAY['V2_FALLBACK']::text[] AND variant = 'v2';
  ASSERT _n > 0, '7e: impressions logged with V2_FALLBACK';
  RAISE NOTICE '7e OK: % fallback impressions', _n;
END $t$;

ROLLBACK TO SAVEPOINT s_e;
DO $t$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recommendation_rerank' AND pronargs = 2), '7e: rerank restored after savepoint rollback';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recommendation_rerank_off'), '7e: temp name gone';
END $t$;

-- ── 7f. arm lookup failure => V1 with WARNING ────────────────
SAVEPOINT s_f;
CREATE OR REPLACE FUNCTION public.recommendation_v2_active(_uid uuid) RETURNS boolean
LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'boom from arm lookup'; END $f$;

DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _full jsonb; _a jsonb; _b jsonb; _bad int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  _full := public.__t_v(1000, 0, NULL, NULL, NULL, 'recommended', false);
  _a := public.__t_r(30, 0, NULL, NULL, NULL, 'recommended', false);   -- emits a WARNING
  _b := public.__t_v(30, 0, NULL, NULL, NULL, 'recommended', false);
  PERFORM public.__t_same('7f arm failure', _a, _b, _full, 'score');
  ASSERT jsonb_array_length(_a) > 0, '7f: non-vacuous';
  SELECT count(*) INTO _bad FROM public.recommend_jobs_routed(_limit => 30) r
   WHERE r.variant <> 'v1' OR r.rank_score IS NOT NULL OR r.reason_codes IS NOT NULL;
  ASSERT _bad = 0, '7f: arm-lookup failure serves plain v1 rows';
  RAISE NOTICE '7f OK';
END $t$;

ROLLBACK TO SAVEPOINT s_f;
DO $t$ BEGIN
  ASSERT (SELECT prosecdef AND prosrc NOT LIKE '%boom%' FROM pg_proc WHERE proname = 'recommendation_v2_active'),
    '7f: recommendation_v2_active restored after savepoint rollback';
  ASSERT public.recommendation_v2_active('00000000-0000-4000-8000-00000000c001'::uuid), '7f: arm works again';
END $t$;

-- ── 7g. kill switch ──────────────────────────────────────────
UPDATE public.recommendation_settings SET v2_enabled = false, v2_rollout_pct = 100 WHERE id = 1;
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _bad int; _n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  ASSERT (SELECT _uid = ANY (v2_allowlist) FROM public.recommendation_settings WHERE id = 1), '7g: still allowlisted';
  DELETE FROM public.job_impressions WHERE candidate_user_id = _uid;
  SELECT count(*), count(*) FILTER (WHERE variant <> 'v1' OR rank_score IS NOT NULL OR reason_codes IS NOT NULL)
    INTO _n, _bad FROM public.recommend_jobs_routed(_limit => 30, _surface => 'dashboard');
  ASSERT _n > 0 AND _bad = 0, '7g: kill switch => plain v1 rows';
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id = _uid AND variant <> 'v1'), '7g: impressions v1';
  RAISE NOTICE '7g OK';
END $t$;

-- ── 7h. privileges (real roles) ──────────────────────────────
UPDATE public.recommendation_settings SET v2_enabled = true, v2_rollout_pct = 0 WHERE id = 1;
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _denied boolean; _n int; _v2 int;
  _router constant text := 'public.recommend_jobs_routed(int,int,text,text,text,text,text,int,int,int,int,timestamptz,text,text,text,text,boolean,boolean,boolean,text,text)';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  ASSERT has_function_privilege('authenticated', _router, 'EXECUTE'), '7h: authenticated can call router (acl)';
  ASSERT NOT has_function_privilege('anon', _router, 'EXECUTE'), '7h: anon cannot call router (acl)';
  ASSERT NOT has_function_privilege('authenticated', 'public.recommendation_rerank(uuid, public.job_feed_row[])', 'EXECUTE'), '7h: rerank acl';
  ASSERT NOT has_function_privilege('anon',          'public.recommendation_rerank(uuid, public.job_feed_row[])', 'EXECUTE'), '7h: rerank acl anon';
  ASSERT NOT has_function_privilege('authenticated', 'public.recommendation_v2_active(uuid)', 'EXECUTE'), '7h: v2_active acl';
  ASSERT NOT has_function_privilege('anon',          'public.recommendation_v2_active(uuid)', 'EXECUTE'), '7h: v2_active acl anon';
  ASSERT NOT has_function_privilege('authenticated',
      'public.recommendation_fetch_v1(text,uuid,text[],int,int,text,text,text,text,text,int,int,int,int,timestamptz,text,text,text,text,boolean,boolean,boolean,text)', 'EXECUTE'), '7h: fetch_v1 acl';
  ASSERT NOT has_function_privilege('anon',
      'public.recommendation_fetch_v1(text,uuid,text[],int,int,text,text,text,text,text,int,int,int,int,timestamptz,text,text,text,text,boolean,boolean,boolean,text)', 'EXECUTE'), '7h: fetch_v1 acl anon';

  -- authenticated through the real privilege path, V2 on: works and serves v2
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE variant = 'v2' AND rank_score IS NOT NULL) INTO _n, _v2
    FROM public.recommend_jobs_routed(_limit => 10, _surface => 'browse');
  RESET ROLE;
  ASSERT _n = 10 AND _v2 = 10, format('7h: authenticated V2 call: %s rows, %s v2', _n, _v2);

  -- authenticated cannot call the internals
  SET LOCAL ROLE authenticated;
  _denied := false;
  BEGIN PERFORM public.recommendation_v2_active(_uid);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true; END;
  RESET ROLE;
  ASSERT _denied, '7h: authenticated must not call recommendation_v2_active';

  SET LOCAL ROLE authenticated;
  _denied := false;
  BEGIN PERFORM public.recommendation_rerank(_uid, ARRAY[]::public.job_feed_row[]);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true; END;
  RESET ROLE;
  ASSERT _denied, '7h: authenticated must not call recommendation_rerank';

  SET LOCAL ROLE anon;
  _denied := false;
  BEGIN PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 3);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true; END;
  RESET ROLE;
  ASSERT _denied, '7h: anon must not call the router';

  SET LOCAL ROLE anon;
  _denied := false;
  BEGIN PERFORM public.recommendation_rerank(_uid, ARRAY[]::public.job_feed_row[]);
  EXCEPTION WHEN insufficient_privilege THEN _denied := true; END;
  RESET ROLE;
  ASSERT _denied, '7h: anon must not call recommendation_rerank';
  RAISE NOTICE '7h OK';
END $t$;

ROLLBACK;

-- ── 7i. no residue: settings row byte-identical, helpers/renames gone ──
SELECT set_config('t.before_fp', :'before_fp', false);
DO $t$
BEGIN
  ASSERT (SELECT md5(t::text) FROM public.recommendation_settings t WHERE id = 1) = current_setting('t.before_fp'),
    '7i: recommendation_settings row id=1 changed';
  ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recommendation_rerank' AND pronargs = 2), '7i: recommendation_rerank exists';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recommendation_rerank_off'), '7i: no renamed leftover';
  ASSERT (SELECT prosrc NOT LIKE '%boom%' FROM pg_proc WHERE proname = 'recommendation_v2_active'), '7i: v2_active body restored';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE '\_\_t\_%'), '7i: helper functions rolled back';
  RAISE NOTICE '7i OK: settings fingerprint unchanged, no residue';
END $t$;

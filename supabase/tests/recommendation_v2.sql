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

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

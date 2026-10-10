-- recommendation_eval.sql -- tests for the recommendation evaluation migration
-- (metrics helpers, labelled-impressions view, admin readouts). LOCAL ONLY.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/recommendation_eval.sql
-- Exits non-zero on any failed ASSERT.

-- ── Part 1: pure metrics (no reads/writes) ──────────────────
DO $$
BEGIN
    -- relevant item at rank 3 of 3: DCG = 3/log2(4) = 1.5, ideal = 3/log2(2) = 3
    ASSERT abs(public.recommendation_ndcg(ARRAY[0,0,3]::numeric[]) - 0.5) < 1e-6, 'late hit is penalised';
    ASSERT abs(public.recommendation_ndcg(ARRAY[3,2,1]::numeric[]) - 1) < 1e-9, 'ideal order scores 1';
    ASSERT public.recommendation_ndcg(ARRAY[0,0,0]::numeric[]) IS NULL, 'no positive gain => undefined (excluded from the mean)';
    ASSERT public.recommendation_ndcg(ARRAY[]::numeric[]) IS NULL, 'empty list => undefined';
    ASSERT abs(public.recommendation_ndcg(ARRAY[1,3]::numeric[]) - 0.7967) < 1e-3, 'swapped pair';
    -- a hit beyond rank k contributes nothing to DCG but still defines the ideal
    ASSERT public.recommendation_ndcg(ARRAY[0,0,0,0,0,0,0,0,0,0,5]::numeric[], 10) = 0, 'hit at rank 11 with k=10';
END $$;

DO $$
DECLARE z numeric;
BEGIN
    z := public.recommendation_two_prop_z(130, 1000, 100, 1000);   -- 13% vs 10%
    ASSERT z BETWEEN 2.09 AND 2.12, format('expected z≈2.10, got %s', z);
    ASSERT public.recommendation_two_prop_z(100, 1000, 100, 1000) = 0, 'equal rates => 0';
    ASSERT public.recommendation_two_prop_z(100, 1000, 130, 1000) < 0, 'worse arm => negative';
    ASSERT public.recommendation_two_prop_z(5, 0, 5, 100) IS NULL, 'empty arm => NULL';
    ASSERT public.recommendation_two_prop_z(0, 100, 0, 100) IS NULL, 'pooled rate 0 => NULL';
    ASSERT public.recommendation_two_prop_z(NULL, 100, 5, 100) IS NULL, 'missing count => NULL';
END $$;

-- ── Part 2: readouts on synthetic labelled impressions (inside BEGIN..ROLLBACK) ──
-- Fixture candidates c003..c008, jobs b001..b004 (active, seeded).
-- Anchor t0 = 10:00 IST two days ago, so every impression is matured (> 24 h old)
-- and all labels fall inside their 24 h window. Nothing is left behind.
-- Helpers live in pg_temp (session scope only, never persisted).
CREATE TEMP TABLE eval_clock AS
SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
       - interval '2 days' + interval '10 hours' AS t0;
CREATE FUNCTION pg_temp.t0() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT t0 FROM eval_clock $$;
CREATE FUNCTION pg_temp.u(_s text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('00000000-0000-4000-8000-00000000' || _s)::uuid $$;
CREATE FUNCTION pg_temp.r(_s text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
    SELECT ('00000000-0000-4000-9000-00000000' || lpad(_s, 4, '0'))::uuid $$;

-- Residue fingerprint taken OUTSIDE the transaction; compared again after ROLLBACK.
CREATE TEMP TABLE eval_fp_before AS
SELECT 'job_impressions' AS t, count(*) AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.job_impressions x
UNION ALL SELECT 'job_recommendation_feedback', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.job_recommendation_feedback x
UNION ALL SELECT 'recommendation_settings', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.recommendation_settings x
UNION ALL SELECT 'applications', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.applications x
UNION ALL SELECT 'saved_jobs', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.saved_jobs x
UNION ALL SELECT 'jobs_counts', count(*), md5(coalesce(string_agg(x.id::text || ':' || x.applications_count::text, '|' ORDER BY x.id), '')) FROM public.jobs x;

BEGIN;

-- Pure-helper spot checks against hand-computed values (ties, real lists).
DO $t$
BEGIN
    ASSERT abs(public.recommendation_ndcg(ARRAY[1,2,3,0]::numeric[]) - 0.789998) < 1e-5, 'ndcg c003 list';
    ASSERT abs(public.recommendation_ndcg(ARRAY[0,1,3,0]::numeric[]) - 0.586883) < 1e-5, 'ndcg c004 list';
    ASSERT abs(public.recommendation_ndcg(ARRAY[0,0,0,3]::numeric[]) - 0.430677) < 1e-5, 'ndcg c007 list';
    ASSERT abs(public.recommendation_ndcg(ARRAY[0,1,1]::numeric[]) - 0.693433) < 1e-5, 'ndcg with tied gains';
END $t$;

-- Fixture baseline for the readout window (fixture rows inside the window are counted, not assumed away).
CREATE TEMP TABLE eval_base AS
SELECT (SELECT count(*) FROM public.saved_jobs WHERE created_at >= now() - interval '14 days') AS saved,
       (SELECT count(*) FROM public.applications WHERE created_at >= now() - interval '14 days') AS apps,
       (SELECT count(*) FROM public.job_recommendation_feedback
          WHERE action = 'viewed' AND created_at >= now() - interval '14 days') AS viewed;
GRANT SELECT ON eval_base TO authenticated;  -- read by the admin block below

-- Impressions. Columns: candidate, job, position, offset from t0, request, arm, sort, reason codes.
INSERT INTO public.job_impressions
    (candidate_user_id, job_id, source, "position", shown_at, request_id, variant, sort, relevant_only, reason_codes)
SELECT pg_temp.u(v.cand), pg_temp.u(v.job), 'recommended', v.pos, pg_temp.t0() + v.off,
       pg_temp.r(v.req), v.arm, v.sort, false, v.rc
FROM (VALUES
  -- c003 (v2): full page; b001 is refetched 5 min later as a new request (dedupe test)
  ('c003','b001',0,interval '0 minutes','03','v2','recommended',NULL::text[]),
  ('c003','b002',1,interval '0 minutes','03','v2','recommended',NULL::text[]),
  ('c003','b003',2,interval '0 minutes','03','v2','recommended',NULL::text[]),
  ('c003','b004',3,interval '0 minutes','03','v2','recommended',NULL::text[]),
  ('c003','b001',0,interval '5 minutes','13','v2','recommended',NULL::text[]),
  -- c004 (v2)
  ('c004','b001',0,interval '0 minutes','04','v2','recommended',NULL::text[]),
  ('c004','b002',1,interval '0 minutes','04','v2','recommended',NULL::text[]),
  ('c004','b003',2,interval '0 minutes','04','v2','recommended',NULL::text[]),
  ('c004','b004',3,interval '0 minutes','04','v2','recommended',NULL::text[]),
  -- c005 (v2): every row came from a V2 fallback (counts toward the fallback rate)
  ('c005','b001',0,interval '0 minutes','05','v2','recommended',ARRAY['V2_FALLBACK']::text[]),
  ('c005','b002',1,interval '0 minutes','05','v2','recommended',ARRAY['V2_FALLBACK']::text[]),
  ('c005','b003',2,interval '0 minutes','05','v2','recommended',ARRAY['V2_FALLBACK']::text[]),
  ('c005','b004',3,interval '0 minutes','05','v2','recommended',ARRAY['V2_FALLBACK']::text[]),
  -- c006 (v1)
  ('c006','b001',0,interval '0 minutes','06','v1','recommended',NULL::text[]),
  ('c006','b002',1,interval '0 minutes','06','v1','recommended',NULL::text[]),
  ('c006','b003',2,interval '0 minutes','06','v1','recommended',NULL::text[]),
  ('c006','b004',3,interval '0 minutes','06','v1','recommended',NULL::text[]),
  -- c007 (v1)
  ('c007','b001',0,interval '0 minutes','07','v1','recommended',NULL::text[]),
  ('c007','b002',1,interval '0 minutes','07','v1','recommended',NULL::text[]),
  ('c007','b003',2,interval '0 minutes','07','v1','recommended',NULL::text[]),
  ('c007','b004',3,interval '0 minutes','07','v1','recommended',NULL::text[]),
  -- c008 (v1) + one explicit-sort row (must be excluded from the experiment)
  ('c008','b001',0,interval '0 minutes','08','v1','recommended',NULL::text[]),
  ('c008','b002',1,interval '0 minutes','08','v1','recommended',NULL::text[]),
  ('c008','b003',2,interval '0 minutes','08','v1','recommended',NULL::text[]),
  ('c008','b004',3,interval '0 minutes','08','v1','recommended',NULL::text[]),
  ('c008','b002',0,interval '0 minutes','18','v1','newest',NULL::text[])
) AS v(cand, job, pos, off, req, arm, sort, rc);

-- One immature impression (1 h old): excluded from labels, counted in health.
INSERT INTO public.job_impressions
    (candidate_user_id, job_id, source, "position", shown_at, request_id, variant, sort, relevant_only)
VALUES (pg_temp.u('c007'), pg_temp.u('b001'), 'recommended', 0, now() - interval '1 hour',
        pg_temp.r('17'), 'v1', 'recommended', false);

-- Labels. Feedback rows are 'viewed' only (the readout's view label).
INSERT INTO public.job_recommendation_feedback (candidate_user_id, job_id, action, created_at) VALUES
  (pg_temp.u('c003'), pg_temp.u('b001'), 'viewed', pg_temp.t0() + interval '2 hours'),
  (pg_temp.u('c004'), pg_temp.u('b002'), 'viewed', pg_temp.t0() + interval '3 hours'),
  (pg_temp.u('c006'), pg_temp.u('b001'), 'viewed', pg_temp.t0() + interval '4 hours'),
  (pg_temp.u('c006'), pg_temp.u('b002'), 'viewed', pg_temp.t0() + interval '6 hours'),
  (pg_temp.u('c008'), pg_temp.u('b001'), 'viewed', pg_temp.t0() + interval '1 hour'),
  (pg_temp.u('c008'), pg_temp.u('b001'), 'viewed', pg_temp.t0() + interval '2 hours');  -- repeat view: still one label

INSERT INTO public.saved_jobs (user_id, job_id, created_at) VALUES
  (pg_temp.u('c003'), pg_temp.u('b002'), pg_temp.t0() + interval '5 hours'),
  (pg_temp.u('c006'), pg_temp.u('b001'), pg_temp.t0() + interval '20 hours');

INSERT INTO public.applications (candidate_id, job_id, company_id, created_at)
SELECT v.cand, v.job, j.company_id, v.ts
FROM (VALUES
  (pg_temp.u('c003'), pg_temp.u('b003'), pg_temp.t0() + interval '3 hours'),
  (pg_temp.u('c004'), pg_temp.u('b003'), pg_temp.t0() + interval '3 hours'),
  (pg_temp.u('c007'), pg_temp.u('b004'), pg_temp.t0() + interval '22 hours'),
  (pg_temp.u('c005'), pg_temp.u('b004'), pg_temp.t0() + interval '25 hours')  -- after the 24 h window: no label
) AS v(cand, job, ts)
JOIN public.jobs j ON j.id = v.job;

-- Hand-computed expectations (gains: applied 3, saved 2, viewed 1):
--   v2 first impressions: c003 [viewed,saved,applied,-] c004 [-,viewed,applied,-] c005 [-,-,-,-]
--     imps 12, viewed 2, saved 1, applied 2, candidates 3, applied candidates 2 (c003,c004)
--   v1 first impressions: c006 [viewed+saved,viewed,-,-] c007 [-,-,-,applied] c008 [viewed,-,-,-]
--     imps 12, viewed 3, saved 1, applied 1, candidates 3, applied candidates 1 (c007)
--   NDCG lists: v2 c003 [1,2,3,0], c004 [0,1,3,0], c005 all-zero (undefined)
--               v1 c006 [2,1,0,0], c007 [0,0,0,3], c008 [1,0,0,0]
--   z (v2 vs v1 on candidate apply rate) = two_prop_z(2,3,1,3) = sqrt(2/3) = 0.8165

-- Act as the platform admin through the authenticated role (RLS and grants apply).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000a001', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $t$
DECLARE v2 record; v1 record; h jsonb; _n int; _sum int; _b record;
BEGIN
    ASSERT auth.uid() = '00000000-0000-4000-8000-00000000a001', 'setup: admin claim must be active';

    -- A/B readout, v2 row
    SELECT * INTO v2 FROM public.recommendation_eval(14) WHERE variant = 'v2';
    ASSERT v2.variant IS NOT NULL, 'eval: v2 row missing';
    ASSERT v2.n_candidates = 3, format('eval v2 candidates: %s', v2.n_candidates);
    ASSERT v2.n_impressions = 12, format('eval v2 impressions: %s', v2.n_impressions);
    ASSERT v2.n_viewed = 2 AND v2.n_saved = 1 AND v2.n_applied = 2, format('eval v2 labels: %s/%s/%s', v2.n_viewed, v2.n_saved, v2.n_applied);
    ASSERT abs(v2.view_rate - 0.1667) < 1e-4 AND abs(v2.save_rate - 0.0833) < 1e-4 AND abs(v2.apply_rate - 0.1667) < 1e-4,
        format('eval v2 rates: %s/%s/%s', v2.view_rate, v2.save_rate, v2.apply_rate);
    ASSERT v2.n_candidates_applied = 2 AND abs(v2.candidate_apply_rate - 0.6667) < 1e-4,
        format('eval v2 candidate apply: %s / %s', v2.n_candidates_applied, v2.candidate_apply_rate);
    ASSERT v2.n_lists = 2 AND abs(v2.ndcg10 - 0.6884) < 1e-4, format('eval v2 ndcg: %s over %s lists', v2.ndcg10, v2.n_lists);
    ASSERT v2.n_fallback_requests = 1, format('eval v2 fallback requests: %s', v2.n_fallback_requests);
    ASSERT v2.z_candidate_apply_vs_v1 IS NOT NULL AND abs(v2.z_candidate_apply_vs_v1 - 0.8165) < 1e-4,
        format('eval v2 z: %s', v2.z_candidate_apply_vs_v1);

    -- A/B readout, v1 row (control: no z-score, no fallbacks)
    SELECT * INTO v1 FROM public.recommendation_eval(14) WHERE variant = 'v1';
    ASSERT v1.variant IS NOT NULL, 'eval: v1 row missing';
    ASSERT v1.n_candidates = 3, format('eval v1 candidates: %s', v1.n_candidates);
    ASSERT v1.n_impressions = 12, format('eval v1 impressions: %s', v1.n_impressions);
    ASSERT v1.n_viewed = 3 AND v1.n_saved = 1 AND v1.n_applied = 1, format('eval v1 labels: %s/%s/%s', v1.n_viewed, v1.n_saved, v1.n_applied);
    ASSERT abs(v1.view_rate - 0.25) < 1e-4 AND abs(v1.save_rate - 0.0833) < 1e-4 AND abs(v1.apply_rate - 0.0833) < 1e-4,
        format('eval v1 rates: %s/%s/%s', v1.view_rate, v1.save_rate, v1.apply_rate);
    ASSERT v1.n_candidates_applied = 1 AND abs(v1.candidate_apply_rate - 0.3333) < 1e-4, 'eval v1 candidate apply';
    ASSERT v1.n_lists = 3 AND abs(v1.ndcg10 - 0.8102) < 1e-4, format('eval v1 ndcg: %s over %s lists', v1.ndcg10, v1.n_lists);
    ASSERT v1.n_fallback_requests = 0, 'eval v1 fallback requests';
    ASSERT v1.z_candidate_apply_vs_v1 IS NULL, 'z must only be set for v2';
    SELECT count(*) INTO _n FROM public.recommendation_eval(14);
    ASSERT _n = 2, format('eval: expected exactly 2 rows, got %s', _n);

    -- Data health (gate G1): counts over every impression, labelled or not.
    SELECT jsonb_object_agg(metric, value) INTO h FROM public.recommendation_data_health(14);
    ASSERT (h->>'days_with_impressions')::numeric = 2, format('health days: %s', h->>'days_with_impressions');
    ASSERT (h->>'impressions_total')::numeric = 27, format('health impressions: %s', h->>'impressions_total');
    ASSERT (h->>'candidates_with_impressions')::numeric = 6, format('health candidates: %s', h->>'candidates_with_impressions');
    ASSERT (h->>'requests_v1')::numeric = 5, format('health requests_v1: %s', h->>'requests_v1');
    ASSERT (h->>'requests_v2')::numeric = 4, format('health requests_v2: %s', h->>'requests_v2');
    ASSERT (h->>'v2_fallback_pct')::numeric = 25.00, format('health fallback pct: %s', h->>'v2_fallback_pct');
    SELECT * INTO _b FROM eval_base;
    ASSERT (h->>'viewed_events')::numeric = _b.viewed + 6, format('health viewed: %s', h->>'viewed_events');
    ASSERT (h->>'saved_events')::numeric = _b.saved + 2, format('health saved: %s', h->>'saved_events');
    ASSERT (h->>'applications')::numeric = _b.apps + 4, format('health applications: %s', h->>'applications');
    ASSERT (SELECT bool_and(value >= 0) FROM public.recommendation_data_health(14)), 'health: all counts non-negative';

    -- Training export (gate G3): matured, default-sorted rows only, with the right gain.
    SELECT count(*), sum(gain) INTO _n, _sum FROM public.recommendation_training_examples(30);
    ASSERT _n = 25, format('training rows: %s', _n);
    ASSERT _sum = 18, format('training gain sum: %s', _sum);
    ASSERT (SELECT count(*) FROM public.recommendation_training_examples(30) WHERE candidate_user_id = pg_temp.u('c008')) = 4,
        'training: explicit-sort row must be excluded';
    ASSERT (SELECT count(*) FROM public.recommendation_training_examples(30) WHERE candidate_user_id = pg_temp.u('c007')) = 4,
        'training: immature row must be excluded';
    ASSERT (SELECT gain FROM public.recommendation_training_examples(30)
             WHERE candidate_user_id = pg_temp.u('c007') AND job_id = pg_temp.u('b004')) = 3, 'training: applied => gain 3';
    ASSERT (SELECT gain FROM public.recommendation_training_examples(30)
             WHERE candidate_user_id = pg_temp.u('c003') AND job_id = pg_temp.u('b002')) = 2, 'training: saved => gain 2';
    ASSERT (SELECT gain FROM public.recommendation_training_examples(30)
             WHERE candidate_user_id = pg_temp.u('c004') AND job_id = pg_temp.u('b002')) = 1, 'training: viewed => gain 1';
    ASSERT (SELECT gain FROM public.recommendation_training_examples(30)
             WHERE candidate_user_id = pg_temp.u('c005') AND job_id = pg_temp.u('b004')) = 0, 'training: late application => gain 0';
END $t$;

-- Staff exclusion: a v2_allowlist member (c003) drops out of the experiment readout.
RESET ROLE;
UPDATE public.recommendation_settings SET v2_allowlist = ARRAY[pg_temp.u('c003')] WHERE id = 1;
SET LOCAL ROLE authenticated;

DO $t$
DECLARE v2 record; v1 record;
BEGIN
    SELECT * INTO v2 FROM public.recommendation_eval(14) WHERE variant = 'v2';
    ASSERT v2.n_candidates = 2 AND v2.n_impressions = 8, format('staff: v2 population %s/%s', v2.n_candidates, v2.n_impressions);
    ASSERT v2.n_viewed = 1 AND v2.n_saved = 0 AND v2.n_applied = 1, 'staff: v2 labels';
    ASSERT v2.n_candidates_applied = 1 AND abs(v2.candidate_apply_rate - 0.5) < 1e-4, 'staff: v2 candidate apply';
    ASSERT v2.n_lists = 1 AND abs(v2.ndcg10 - 0.5869) < 1e-4, 'staff: v2 ndcg';
    ASSERT abs(v2.z_candidate_apply_vs_v1 - 0.3727) < 1e-4, format('staff: z %s', v2.z_candidate_apply_vs_v1);
    SELECT * INTO v1 FROM public.recommendation_eval(14) WHERE variant = 'v1';
    ASSERT v1.n_candidates = 3 AND v1.n_impressions = 12, 'staff: v1 unaffected';
END $t$;

-- Negative tests: a candidate (not an admin) gets insufficient_permissions from every readout.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-00000000c003', 'role', 'authenticated')::text, true);

DO $t$
DECLARE msg text;
BEGIN
    ASSERT auth.uid() = '00000000-0000-4000-8000-00000000c003', 'negative: claim must be the candidate';

    BEGIN PERFORM 1 FROM public.recommendation_eval(14); msg := 'no error'; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
    ASSERT msg = 'insufficient_permissions', format('eval as candidate: %s', msg);
    BEGIN PERFORM 1 FROM public.recommendation_data_health(14); msg := 'no error'; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
    ASSERT msg = 'insufficient_permissions', format('health as candidate: %s', msg);
    BEGIN PERFORM 1 FROM public.recommendation_training_examples(30); msg := 'no error'; EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
    ASSERT msg = 'insufficient_permissions', format('training as candidate: %s', msg);

    -- The labelled view is not selectable by authenticated (direct access).
    BEGIN PERFORM 1 FROM public.recommendation_labelled_impressions; msg := 'no error'; EXCEPTION WHEN insufficient_privilege THEN msg := 'denied'; END;
    ASSERT msg = 'denied', format('view as authenticated: %s', msg);
END $t$;

-- anon: no access to the view and no execute on the readouts.
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
SET LOCAL ROLE anon;

DO $t$
DECLARE msg text;
BEGIN
    BEGIN PERFORM 1 FROM public.recommendation_labelled_impressions; msg := 'no error'; EXCEPTION WHEN insufficient_privilege THEN msg := 'denied'; END;
    ASSERT msg = 'denied', format('view as anon: %s', msg);
    BEGIN PERFORM 1 FROM public.recommendation_eval(14); msg := 'no error'; EXCEPTION WHEN insufficient_privilege THEN msg := 'denied'; END;
    ASSERT msg = 'denied', format('eval as anon: %s', msg);
END $t$;

RESET ROLE;

-- Catalog-level grants and read-only guarantee (STABLE = Postgres rejects writes inside).
DO $t$
BEGIN
    ASSERT NOT has_table_privilege('anon', 'public.recommendation_labelled_impressions', 'SELECT'), 'grant: anon view';
    ASSERT NOT has_table_privilege('authenticated', 'public.recommendation_labelled_impressions', 'SELECT'), 'grant: authenticated view';
    ASSERT NOT has_function_privilege('anon', 'public.recommendation_eval(integer)', 'EXECUTE'), 'grant: anon eval';
    ASSERT has_function_privilege('authenticated', 'public.recommendation_eval(integer)', 'EXECUTE'), 'grant: authenticated eval';
    ASSERT NOT has_function_privilege('anon', 'public.recommendation_data_health(integer)', 'EXECUTE'), 'grant: anon health';
    ASSERT NOT has_function_privilege('anon', 'public.recommendation_training_examples(integer,integer)', 'EXECUTE'), 'grant: anon training';
    ASSERT (SELECT provolatile FROM pg_proc WHERE oid = 'public.recommendation_eval(integer)'::regprocedure) = 's', 'read-only: eval must be STABLE';
    ASSERT (SELECT provolatile FROM pg_proc WHERE oid = 'public.recommendation_data_health(integer)'::regprocedure) = 's', 'read-only: health must be STABLE';
    ASSERT (SELECT provolatile FROM pg_proc WHERE oid = 'public.recommendation_training_examples(integer,integer)'::regprocedure) = 's', 'read-only: training must be STABLE';
END $t$;

ROLLBACK;

-- Residue: every fingerprinted table is exactly what it was before the test.
CREATE TEMP TABLE eval_fp_after AS
SELECT 'job_impressions' AS t, count(*) AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.job_impressions x
UNION ALL SELECT 'job_recommendation_feedback', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.job_recommendation_feedback x
UNION ALL SELECT 'recommendation_settings', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.recommendation_settings x
UNION ALL SELECT 'applications', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.applications x
UNION ALL SELECT 'saved_jobs', count(*), md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.saved_jobs x
UNION ALL SELECT 'jobs_counts', count(*), md5(coalesce(string_agg(x.id::text || ':' || x.applications_count::text, '|' ORDER BY x.id), '')) FROM public.jobs x;

DO $t$
DECLARE _diff int;
BEGIN
    SELECT count(*) INTO _diff
    FROM eval_fp_before b FULL JOIN eval_fp_after a USING (t)
    WHERE a.h IS DISTINCT FROM b.h OR a.n IS DISTINCT FROM b.n;
    ASSERT _diff = 0, format('residue: %s fingerprinted table(s) changed', _diff);
END $t$;

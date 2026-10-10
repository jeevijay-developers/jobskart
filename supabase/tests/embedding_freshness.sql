-- embedding_freshness.sql -- tests for 20261008103459_embedding_freshness.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql to be loaded (candidates ...c001.., employers ...e001.., admin ...a001).
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/embedding_freshness.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

BEGIN;

-- Helper (session-local): act as a user (or nobody when NULL).
CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN _uid IS NULL THEN '{}' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true);
END $f$;

-- ───────────────────────── a. columns ─────────────────────────
DO $t$
BEGIN
  ASSERT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='candidate_profiles'
           AND column_name IN ('profile_embedding_hash','profile_embedding_model','profile_embedded_at')) = 3, 'a: candidate_profiles columns';
  ASSERT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs'
           AND column_name IN ('description_embedding_hash','description_embedding_model','description_embedded_at')) = 3, 'a: jobs columns';
  -- old signatures are gone, new ones exist exactly once
  ASSERT (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='update_candidate_profile_embedding') = 1, 'a: one candidate writer';
  ASSERT (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='update_job_description_embedding') = 1, 'a: one job writer';
END $t$;

-- ───────────── f0. coverage BEFORE any hash/model is set (fixtures are legacy rows) ─────────────
DO $t$
DECLARE r record; _j_emb bigint; _c_emb bigint; _n int := 0;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM jobs WHERE description_embedding_hash IS NOT NULL OR description_embedding_model IS NOT NULL), 'f0 precondition: no job hashes';
  ASSERT NOT EXISTS (SELECT 1 FROM candidate_profiles WHERE profile_embedding_hash IS NOT NULL OR profile_embedding_model IS NOT NULL), 'f0 precondition: no candidate hashes';
  SELECT count(*) INTO _j_emb FROM jobs j WHERE j.status='active' AND (j.expires_at IS NULL OR j.expires_at > now()) AND j.description_embedding IS NOT NULL;
  SELECT count(*) INTO _c_emb FROM candidate_profiles cp WHERE cp.onboarding_completed AND cp.profile_embedding IS NOT NULL;
  ASSERT _j_emb > 0 AND _c_emb > 0, 'f0 precondition: fixtures have embeddings';

  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000a001');
  SET LOCAL ROLE authenticated;
  FOR r IN SELECT * FROM public.recommendation_embedding_coverage() LOOP
    IF r.entity = 'jobs' THEN
      ASSERT r.n_embedded = _j_emb AND r.n_stale = _j_emb AND r.pct_current = 0, format('f0 jobs: %s', r);
    ELSIF r.entity = 'candidates' THEN
      ASSERT r.n_embedded = _c_emb AND r.n_stale = _c_emb AND r.pct_current = 0, format('f0 candidates: %s', r);
    ELSIF r.entity IN ('jobs_skills','jobs_role','candidates_skills','candidates_role') THEN
      -- facet rows (Plan 10): present and internally consistent; their fill level depends on backfill state
      ASSERT r.n_embedded + r.n_missing = r.n_total, format('f0 facet totals: %s', r);
    ELSE
      RAISE EXCEPTION 'f0 unexpected entity %', r.entity;
    END IF;
    _n := _n + 1;
  END LOOP;
  ASSERT _n = 6, format('f0 expected 6 coverage rows, got %s', _n);
  RESET ROLE;
END $t$;

-- ───────────── b. invalidation triggers: candidate_profiles ─────────────
DO $t$
DECLARE
  _uid constant uuid := '00000000-0000-4000-8000-00000000c001';
  _stmt text; _h text;
BEGIN
  -- content changes MUST clear the hash
  FOREACH _stmt IN ARRAY ARRAY[
    $$bio = coalesce(bio,'') || ' x'$$,
    $$skills = skills || ARRAY['zzz-new-skill']$$,
    $$headline = coalesce(headline,'') || ' x'$$,
    $$years_experience = years_experience + 1$$,
    $$last_role = coalesce(last_role,'') || ' x'$$
  ] LOOP
    UPDATE candidate_profiles SET profile_embedding_hash = 'seed' WHERE user_id = _uid;
    EXECUTE format('UPDATE candidate_profiles SET %s WHERE user_id = %L', _stmt, _uid);
    SELECT profile_embedding_hash INTO _h FROM candidate_profiles WHERE user_id = _uid;
    ASSERT _h IS NULL, format('b: candidate hash must be cleared by: %s', _stmt);
  END LOOP;

  -- unrelated / same-value updates MUST NOT clear it
  FOREACH _stmt IN ARRAY ARRAY[
    $$profile_strength = profile_strength + 1$$,
    $$notification_prefs = notification_prefs || '{"t":1}'::jsonb$$,
    $$profile_views = profile_views + 1$$,
    $$resume_name = coalesce(resume_name,'') || 'x'$$,
    $$bio = bio$$,
    $$skills = skills$$,
    $$headline = headline$$,
    $$years_experience = years_experience$$,
    $$last_role = last_role$$
  ] LOOP
    UPDATE candidate_profiles SET profile_embedding_hash = 'seed' WHERE user_id = _uid;
    EXECUTE format('UPDATE candidate_profiles SET %s WHERE user_id = %L', _stmt, _uid);
    SELECT profile_embedding_hash INTO _h FROM candidate_profiles WHERE user_id = _uid;
    ASSERT _h = 'seed', format('b: candidate hash must survive: %s (got %s)', _stmt, coalesce(_h,'NULL'));
  END LOOP;

  -- profiles.full_name / city clear it; another profiles column does not; same value does not
  UPDATE candidate_profiles SET profile_embedding_hash = 'seed' WHERE user_id = _uid;
  UPDATE profiles SET full_name = coalesce(full_name,'') || ' x' WHERE id = _uid;
  ASSERT (SELECT profile_embedding_hash FROM candidate_profiles WHERE user_id = _uid) IS NULL, 'b: profiles.full_name must clear';

  UPDATE candidate_profiles SET profile_embedding_hash = 'seed' WHERE user_id = _uid;
  UPDATE profiles SET city = coalesce(city,'') || ' x' WHERE id = _uid;
  ASSERT (SELECT profile_embedding_hash FROM candidate_profiles WHERE user_id = _uid) IS NULL, 'b: profiles.city must clear';

  UPDATE candidate_profiles SET profile_embedding_hash = 'seed' WHERE user_id = _uid;
  UPDATE profiles SET avatar_url = coalesce(avatar_url,'') || 'x' WHERE id = _uid;
  ASSERT (SELECT profile_embedding_hash FROM candidate_profiles WHERE user_id = _uid) = 'seed', 'b: profiles.avatar_url must NOT clear';
  UPDATE profiles SET full_name = full_name, city = city WHERE id = _uid;
  ASSERT (SELECT profile_embedding_hash FROM candidate_profiles WHERE user_id = _uid) = 'seed', 'b: same-value profiles update must NOT clear';
END $t$;

-- ───────────── b. invalidation triggers: jobs ─────────────
DO $t$
DECLARE
  _id uuid; _stmt text; _h text;
BEGIN
  SELECT id INTO _id FROM jobs WHERE status = 'active' AND company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;
  ASSERT _id IS NOT NULL, 'b: need an active d001 job';

  FOREACH _stmt IN ARRAY ARRAY[
    $$title = title || ' x'$$,
    $$category = coalesce(category,'') || ' x'$$,
    $$skills = skills || ARRAY['zzz-new-skill']$$,
    $$city = coalesce(city,'') || ' x'$$,
    $$description = coalesce(description,'') || ' x'$$
  ] LOOP
    UPDATE jobs SET description_embedding_hash = 'seed' WHERE id = _id;
    EXECUTE format('UPDATE jobs SET %s WHERE id = %L', _stmt, _id);
    SELECT description_embedding_hash INTO _h FROM jobs WHERE id = _id;
    ASSERT _h IS NULL, format('b: job hash must be cleared by: %s', _stmt);
  END LOOP;

  FOREACH _stmt IN ARRAY ARRAY[
    $$views_count = views_count + 1$$,
    $$applications_count = applications_count + 1$$,
    $$status = 'paused'$$,
    $$title = title$$,
    $$category = category$$,
    $$skills = skills$$,
    $$city = city$$,
    $$description = description$$
  ] LOOP
    UPDATE jobs SET description_embedding_hash = 'seed' WHERE id = _id;
    EXECUTE format('UPDATE jobs SET %s WHERE id = %L', _stmt, _id);
    SELECT description_embedding_hash INTO _h FROM jobs WHERE id = _id;
    ASSERT _h = 'seed', format('b: job hash must survive: %s (got %s)', _stmt, coalesce(_h,'NULL'));
    UPDATE jobs SET status = 'active' WHERE id = _id;
  END LOOP;
END $t$;

-- ───────────── c. writers (new shape, old shape, permissions) ─────────────
DO $t$
DECLARE
  _v vector(1536) := array_fill(0.1::float4, ARRAY[1536])::vector(1536);
  _cand constant uuid := '00000000-0000-4000-8000-00000000c001';
  _job uuid; _before timestamptz; _r record; _msg text;
BEGIN
  SELECT id INTO _job FROM jobs WHERE company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;
  UPDATE candidate_profiles SET profile_embedded_at = NULL, profile_embedding_hash = NULL, profile_embedding_model = NULL WHERE user_id = _cand;
  UPDATE jobs SET description_embedded_at = NULL, description_embedding_hash = NULL, description_embedding_model = NULL WHERE id = _job;

  -- candidate writer, new shape; its own UPDATE must not clear the hash it just set
  PERFORM pg_temp.act_as(_cand);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_candidate_profile_embedding(_v, 'h1', 'model-x');
  RESET ROLE;
  SELECT profile_embedding IS NOT NULL AS has_vec, profile_embedding_hash AS h, profile_embedding_model AS m,
         (profile_embedded_at > now() - interval '1 minute') AS fresh INTO _r FROM candidate_profiles WHERE user_id = _cand;
  ASSERT _r.has_vec AND _r.h = 'h1' AND _r.m = 'model-x' AND _r.fresh, format('c: candidate writer new shape: %s', _r);

  -- employer writer, new shape
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
  SET LOCAL ROLE authenticated;
  PERFORM public.update_job_description_embedding(_job, _v, 'h2', 'model-x');
  RESET ROLE;
  SELECT description_embedding IS NOT NULL AS has_vec, description_embedding_hash AS h, description_embedding_model AS m,
         (description_embedded_at > now() - interval '1 minute') AS fresh INTO _r FROM jobs WHERE id = _job;
  ASSERT _r.has_vec AND _r.h = 'h2' AND _r.m = 'model-x' AND _r.fresh, format('c: job writer new shape: %s', _r);

  -- non-members: other-company employer, and a candidate
  FOR _msg IN SELECT unnest(ARRAY['00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-00000000c001']) LOOP
    PERFORM pg_temp.act_as(_msg::uuid);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.update_job_description_embedding(_job, _v, 'evil', 'evil');
      RESET ROLE;
      RAISE EXCEPTION 'c: non-member % was allowed to write job embedding', _msg;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      ASSERT SQLERRM = 'insufficient_permissions', format('c: expected insufficient_permissions for %s, got %s', _msg, SQLERRM);
    END;
  END LOOP;
  ASSERT (SELECT description_embedding_hash FROM jobs WHERE id = _job) = 'h2', 'c: non-member must not have changed hash';

  -- no uid
  PERFORM pg_temp.act_as(NULL);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_candidate_profile_embedding(_v, 'x', 'x');
    RESET ROLE;
    RAISE EXCEPTION 'c: no-uid candidate write allowed';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    ASSERT SQLERRM = 'not_authenticated', format('c: expected not_authenticated, got %s', SQLERRM);
  END;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.update_job_description_embedding(_job, _v, 'x', 'x');
    RESET ROLE;
    RAISE EXCEPTION 'c: no-uid job write allowed';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    ASSERT SQLERRM = 'not_authenticated', format('c: expected not_authenticated (job), got %s', SQLERRM);
  END;

  -- BACKWARD COMPAT: the exact call shapes the currently deployed client sends (named args, no hash/model)
  PERFORM pg_temp.act_as(_cand);
  SET LOCAL ROLE authenticated;
  PERFORM public.update_candidate_profile_embedding(_embedding => _v);
  RESET ROLE;
  SELECT profile_embedding IS NOT NULL AS has_vec, profile_embedding_hash AS h, profile_embedding_model AS m INTO _r FROM candidate_profiles WHERE user_id = _cand;
  ASSERT _r.has_vec AND _r.h IS NULL AND _r.m IS NULL, format('c: old candidate shape: %s', _r);

  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
  SET LOCAL ROLE authenticated;
  PERFORM public.update_job_description_embedding(_job_id => _job, _embedding => _v);
  RESET ROLE;
  SELECT description_embedding IS NOT NULL AS has_vec, description_embedding_hash AS h, description_embedding_model AS m INTO _r FROM jobs WHERE id = _job;
  ASSERT _r.has_vec AND _r.h IS NULL AND _r.m IS NULL, format('c: old job shape: %s', _r);
END $t$;

-- ───────────── d. *_is_current ─────────────
DO $t$
DECLARE
  _v vector(1536) := array_fill(0.1::float4, ARRAY[1536])::vector(1536);
  _c1 constant uuid := '00000000-0000-4000-8000-00000000c001';
  _c2 constant uuid := '00000000-0000-4000-8000-00000000c002';
  _job uuid;
BEGIN
  SELECT id INTO _job FROM jobs WHERE company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;
  UPDATE candidate_profiles SET profile_embedding = _v, profile_embedding_hash = 'ha' WHERE user_id = _c1;
  UPDATE candidate_profiles SET profile_embedding = _v, profile_embedding_hash = 'hb' WHERE user_id = _c2;
  UPDATE jobs SET description_embedding = _v, description_embedding_hash = 'jh' WHERE id = _job;

  PERFORM pg_temp.act_as(_c1);
  SET LOCAL ROLE authenticated;
  ASSERT public.candidate_embedding_is_current('ha') IS TRUE, 'd: matching hash => true';
  ASSERT public.candidate_embedding_is_current('zz') IS FALSE, 'd: different hash => false';
  ASSERT public.candidate_embedding_is_current(NULL) IS FALSE, 'd: NULL arg => false';
  ASSERT public.candidate_embedding_is_current('hb') IS FALSE, 'd: must not see another candidate''s hash';
  RESET ROLE;

  -- stored hash NULL => false even for NULL arg
  UPDATE candidate_profiles SET profile_embedding_hash = NULL WHERE user_id = _c1;
  PERFORM pg_temp.act_as(_c1);
  SET LOCAL ROLE authenticated;
  ASSERT public.candidate_embedding_is_current(NULL) IS FALSE, 'd: NULL stored hash + NULL arg => false';
  ASSERT public.candidate_embedding_is_current('ha') IS FALSE, 'd: NULL stored hash => false';
  RESET ROLE;

  -- embedding NULL but hash set => false
  UPDATE candidate_profiles SET profile_embedding = NULL, profile_embedding_hash = 'ha' WHERE user_id = _c1;
  PERFORM pg_temp.act_as(_c1);
  SET LOCAL ROLE authenticated;
  ASSERT public.candidate_embedding_is_current('ha') IS FALSE, 'd: NULL embedding => false';
  RESET ROLE;

  -- jobs
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
  SET LOCAL ROLE authenticated;
  ASSERT public.job_embedding_is_current(_job, 'jh') IS TRUE, 'd: job matching => true';
  ASSERT public.job_embedding_is_current(_job, 'zz') IS FALSE, 'd: job different hash => false';
  ASSERT public.job_embedding_is_current(_job, NULL) IS FALSE, 'd: job NULL arg => false';
  RESET ROLE;
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e002');
  SET LOCAL ROLE authenticated;
  ASSERT public.job_embedding_is_current(_job, 'jh') IS FALSE, 'd: non-member with matching hash => false';
  RESET ROLE;
  PERFORM pg_temp.act_as(_c1);
  SET LOCAL ROLE authenticated;
  ASSERT public.job_embedding_is_current(_job, 'jh') IS FALSE, 'd: candidate with matching hash => false';
  RESET ROLE;
  UPDATE jobs SET description_embedding = NULL, description_embedding_hash = 'jh' WHERE id = _job;
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
  SET LOCAL ROLE authenticated;
  ASSERT public.job_embedding_is_current(_job, 'jh') IS FALSE, 'd: job NULL embedding => false';
  RESET ROLE;
END $t$;

-- ───────────── e. privileges ─────────────
DO $t$
DECLARE
  _v vector(1536) := array_fill(0.1::float4, ARRAY[1536])::vector(1536);
  _job uuid; _fn text;
BEGIN
  SELECT id INTO _job FROM jobs WHERE company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;

  -- catalog level
  FOREACH _fn IN ARRAY ARRAY[
    'public.update_candidate_profile_embedding(vector,text,text)',
    'public.update_job_description_embedding(uuid,vector,text,text)',
    'public.candidate_embedding_is_current(text)',
    'public.job_embedding_is_current(uuid,text)',
    'public.recommendation_embedding_coverage(text)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', _fn, 'EXECUTE'), format('e: anon must not execute %s', _fn);
    ASSERT has_function_privilege('authenticated', _fn, 'EXECUTE'), format('e: authenticated must execute %s', _fn);
  END LOOP;

  -- actual anon calls are denied
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.update_candidate_profile_embedding(_v, 'a', 'a'); RESET ROLE; RAISE EXCEPTION 'e: anon wrote candidate'; EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.update_job_description_embedding(_job, _v, 'a', 'a'); RESET ROLE; RAISE EXCEPTION 'e: anon wrote job'; EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.candidate_embedding_is_current('a'); RESET ROLE; RAISE EXCEPTION 'e: anon cand is_current'; EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.job_embedding_is_current(_job, 'a'); RESET ROLE; RAISE EXCEPTION 'e: anon job is_current'; EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  SET LOCAL ROLE anon;
  BEGIN PERFORM * FROM public.recommendation_embedding_coverage(); RESET ROLE; RAISE EXCEPTION 'e: anon coverage'; EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;

  -- coverage is admin-only even for authenticated
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000c001');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.recommendation_embedding_coverage();
    RESET ROLE;
    RAISE EXCEPTION 'e: candidate read coverage';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    ASSERT SQLERRM = 'insufficient_permissions', format('e: coverage candidate expected insufficient_permissions, got %s', SQLERRM);
  END;
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000e001');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.recommendation_embedding_coverage();
    RESET ROLE;
    RAISE EXCEPTION 'e: employer read coverage';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    ASSERT SQLERRM = 'insufficient_permissions', format('e: coverage employer expected insufficient_permissions, got %s', SQLERRM);
  END;
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000a001');
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM public.recommendation_embedding_coverage()) = 6, 'e: admin sees six rows';
  RESET ROLE;
END $t$;

-- ───────────── f. coverage with hashes / models ─────────────
DO $t$
DECLARE
  _v vector(1536) := array_fill(0.1::float4, ARRAY[1536])::vector(1536);
  r record;
  _jt bigint; _je bigint; _jhashed bigint; _jmx bigint; _jhm bigint;
  _ct bigint; _ce bigint; _chashed bigint; _cmx bigint; _chm bigint;
  _jf constant text := $$j.status='active' AND (j.expires_at IS NULL OR j.expires_at > now())$$;
BEGIN
  -- give every embedded in-scope row a hash; alternate model-x / other; leave one embedded row per entity hash-less
  UPDATE jobs j SET description_embedding_hash = 'h', description_embedding_model = CASE WHEN x.rn % 2 = 1 THEN 'model-x' ELSE 'other' END
  FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM jobs
         WHERE status='active' AND (expires_at IS NULL OR expires_at > now()) AND description_embedding IS NOT NULL) x
  WHERE j.id = x.id;
  UPDATE jobs SET description_embedding_hash = NULL
   WHERE id = (SELECT id FROM jobs WHERE status='active' AND (expires_at IS NULL OR expires_at > now()) AND description_embedding IS NOT NULL ORDER BY id LIMIT 1);

  UPDATE candidate_profiles c SET profile_embedding_hash = 'h', profile_embedding_model = CASE WHEN x.rn % 2 = 1 THEN 'model-x' ELSE 'other' END
  FROM (SELECT user_id, row_number() OVER (ORDER BY user_id) rn FROM candidate_profiles
         WHERE onboarding_completed AND profile_embedding IS NOT NULL) x
  WHERE c.user_id = x.user_id;
  UPDATE candidate_profiles SET profile_embedding_hash = NULL
   WHERE user_id = (SELECT user_id FROM candidate_profiles WHERE onboarding_completed AND profile_embedding IS NOT NULL ORDER BY user_id LIMIT 1);

  -- expected values, straight from the tables
  SELECT count(*), count(*) FILTER (WHERE description_embedding IS NOT NULL),
         count(*) FILTER (WHERE description_embedding IS NOT NULL AND description_embedding_hash IS NOT NULL),
         count(*) FILTER (WHERE description_embedding IS NOT NULL AND description_embedding_hash IS NOT NULL AND description_embedding_model = 'model-x')
    INTO _jt, _je, _jhashed, _jmx
    FROM jobs j WHERE j.status='active' AND (j.expires_at IS NULL OR j.expires_at > now());
  SELECT count(*), count(*) FILTER (WHERE profile_embedding IS NOT NULL),
         count(*) FILTER (WHERE profile_embedding IS NOT NULL AND profile_embedding_hash IS NOT NULL),
         count(*) FILTER (WHERE profile_embedding IS NOT NULL AND profile_embedding_hash IS NOT NULL AND profile_embedding_model = 'model-x')
    INTO _ct, _ce, _chashed, _cmx
    FROM candidate_profiles WHERE onboarding_completed;
  ASSERT _jt > _je AND _ct > _ce, 'f: fixtures must include rows with no embedding (missing)';
  ASSERT _jmx > 0 AND _jmx < _jhashed AND _jhashed < _je, 'f: scenario must be non-degenerate (jobs)';

  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000a001');
  SET LOCAL ROLE authenticated;

  -- model-agnostic: stale = embedded with NULL hash
  FOR r IN SELECT * FROM public.recommendation_embedding_coverage() c WHERE c.entity IN ('jobs','candidates') LOOP
    IF r.entity = 'jobs' THEN
      ASSERT r.n_total=_jt AND r.n_embedded=_je AND r.n_missing=_jt-_je AND r.n_stale=_je-_jhashed
         AND r.pct_current = round(100.0*_jhashed/_jt,1), format('f jobs (no model): %s', r);
    ELSE
      ASSERT r.entity='candidates' AND r.n_total=_ct AND r.n_embedded=_ce AND r.n_missing=_ct-_ce AND r.n_stale=_ce-_chashed
         AND r.pct_current = round(100.0*_chashed/_ct,1), format('f candidates (no model): %s', r);
    END IF;
  END LOOP;

  -- with a target model: other-model rows are stale too and not current
  FOR r IN SELECT * FROM public.recommendation_embedding_coverage('model-x') c WHERE c.entity IN ('jobs','candidates') LOOP
    IF r.entity = 'jobs' THEN
      ASSERT r.n_total=_jt AND r.n_embedded=_je AND r.n_missing=_jt-_je AND r.n_stale=_je-_jmx
         AND r.pct_current = round(100.0*_jmx/_jt,1), format('f jobs (model-x): %s', r);
    ELSE
      ASSERT r.entity='candidates' AND r.n_total=_ct AND r.n_embedded=_ce AND r.n_missing=_ct-_ce AND r.n_stale=_ce-_cmx
         AND r.pct_current = round(100.0*_cmx/_ct,1), format('f candidates (model-x): %s', r);
    END IF;
  END LOOP;

  -- a model nobody used: nothing current, every embedded row stale
  FOR r IN SELECT * FROM public.recommendation_embedding_coverage('nope') c WHERE c.entity IN ('jobs','candidates') LOOP
    ASSERT r.pct_current = 0 AND r.n_stale = r.n_embedded, format('f (nope): %s', r);
  END LOOP;
  RESET ROLE;
END $t$;

-- ───────────── g. hot path still works ─────────────
DO $t$
DECLARE _job uuid; _before int; _after int;
BEGIN
  SELECT id, views_count INTO _job, _before FROM jobs WHERE company_id = '00000000-0000-4000-8000-00000000d001' ORDER BY id LIMIT 1;
  UPDATE jobs SET views_count = views_count + 1 WHERE id = _job;
  SELECT views_count INTO _after FROM jobs WHERE id = _job;
  ASSERT _after = _before + 1, 'g: jobs hot-path update';
  UPDATE candidate_profiles SET profile_views = profile_views + 1 WHERE user_id = '00000000-0000-4000-8000-00000000c001';
  ASSERT FOUND, 'g: candidate_profiles hot-path update';
  -- authenticated candidate editing their own profile through RLS
  PERFORM pg_temp.act_as('00000000-0000-4000-8000-00000000c001');
  SET LOCAL ROLE authenticated;
  UPDATE candidate_profiles SET bio = 'edited via RLS' WHERE user_id = '00000000-0000-4000-8000-00000000c001';
  ASSERT FOUND, 'g: RLS self-update';
  RESET ROLE;
END $t$;

ROLLBACK;

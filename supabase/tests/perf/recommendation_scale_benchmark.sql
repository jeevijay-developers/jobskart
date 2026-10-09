-- =====================================================================
-- recommendation_scale_benchmark.sql
--
-- Rollback-wrapped latency benchmark for the candidate job feed
-- (recommend_jobs_for_candidate = "V1", recommend_jobs_routed = router +
-- optional V2 rerank) at production-like scale.
--
-- LOCAL ONLY. NEVER run against a linked/remote project.
--
-- Everything happens inside ONE transaction that is ROLLED BACK at the end,
-- so no rows survive. (The ROLLBACK leaves dead tuples and bloated index
-- files behind: run `VACUUM (ANALYZE)` + `REINDEX` on the touched tables
-- afterwards; see the "after rollback" block printed at the end.)
--
-- NOTE: this is a MEASUREMENT HARNESS, not application code. To bulk-load
-- tens of thousands of rows quickly it uses
--     SET LOCAL session_replication_role = replica
-- which skips triggers and FK checks while loading. The session role is put
-- back to `origin` before anything is timed, so the measured code paths run
-- exactly as in production (triggers/RLS-bypass of SECURITY DEFINER, etc).
--
-- Usage (defaults shown):
--   docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--     -v ON_ERROR_STOP=1 -q \
--     -v n_jobs=20000 -v n_candidates=2000 -v n_companies=4000 \
--     -v n_applications=60000 \
--     < supabase/tests/perf/recommendation_scale_benchmark.sql
--
-- Optional variables:
--   n_closed         non-servable historical jobs (closed/expired)   default n_jobs/4
--   n_impressions    filler job_impressions rows                       default 40000
--   reps / warmup    timed repetitions / untimed warm-ups per cell     default 20 / 3
--   with_canonical   1 = load 60 canonical_skills (+aliases) so V1's
--                    per-job canonical-skill EXISTS path is exercised   default 1
--   scen_ords        comma list of scenario ord numbers to run (1-8)     default all
--   prof_ns          comma list of test profiles (1 Driver, 2 Sales,
--                    3 ColdStart, 4 ManyApplications)                   default 1,2,3,4
--   skip_timing      1 = load + EXPLAIN only (debugging)               default 0
--   explain          1 = also print EXPLAIN (ANALYZE, BUFFERS) of V1    default 1
--
--   plan_mode        auto | force_custom_plan | force_generic_plan.      default auto
--                    plpgsql caches the RETURN QUERY plan per session and after 5 calls may flip
--                    to a GENERIC plan (a pooled backend does the same in production). The
--                    flip makes V1 ~10x slower here. Use force_custom_plan for stable per-size
--                    numbers; run scen_ords=1 -v plan_mode=auto -v warmup=0 -v reps=9 to see the flip.
--   explain_generic  1 = also EXPLAIN under a generic plan                default 0
--
-- Run commands (measured on 4 CPU / 8 GB Docker, shared_buffers 128MB; runtime = wall clock
-- incl. ~10-40 s load). Do NOT pipe psql into `head`: the backend keeps running after the client dies.
--   smoke 2k : -v n_jobs=2000  -v n_candidates=300   -v n_companies=400  -v n_applications=6000
--              -v reps=3 -v warmup=1 -v plan_mode=force_custom_plan                (~1.5 min)
--   5k       : -v n_jobs=5000  -v n_candidates=2500  -v n_companies=1000 -v n_applications=15000
--              -v reps=5 -v warmup=1 -v plan_mode=force_custom_plan                (~5 min)
--   20k      : -v n_jobs=20000 -v n_candidates=10000 -v n_companies=4000 -v n_applications=60000
--              -v reps=3 -v warmup=1 -v plan_mode=force_custom_plan -v explain_generic=1  (~13 min)
--   50k      : -v n_jobs=50000 -v n_candidates=25000 -v n_companies=10000 -v n_applications=150000
--              -v reps=2 -v warmup=1 -v plan_mode=force_custom_plan   (est. > 35 min, ~1 GB RAM; not run)
-- Afterwards ALWAYS: VACUUM (ANALYZE) the touched tables + REINDEX TABLE public.jobs (the 20k run
-- leaves the jobs table ~230 MB / HNSW ~40 MB of dead space until then).
-- =====================================================================

\set ON_ERROR_STOP on
\if :{?n_jobs} \else \set n_jobs 20000 \endif
\if :{?n_candidates} \else \set n_candidates 2000 \endif
\if :{?n_companies} \else \set n_companies 4000 \endif
\if :{?n_applications} \else \set n_applications 60000 \endif
\if :{?n_closed} \else
SELECT (:n_jobs / 4)::int AS n_closed \gset
\endif
\if :{?n_impressions} \else \set n_impressions 40000 \endif
\if :{?reps} \else \set reps 20 \endif
\if :{?warmup} \else \set warmup 3 \endif
\if :{?with_canonical} \else \set with_canonical 1 \endif
\if :{?explain} \else \set explain 1 \endif
\if :{?skip_timing} \else \set skip_timing 0 \endif
\if :{?scen_ords} \else \set scen_ords '' \endif
\if :{?prof_ns} \else \set prof_ns '1,2,3,4' \endif
\if :{?plan_mode} \else \set plan_mode auto \endif
\if :{?explain_generic} \else \set explain_generic 0 \endif

\echo
\echo '== recommendation scale benchmark =='
\echo 'n_jobs=' :n_jobs ' n_closed=' :n_closed ' n_candidates=' :n_candidates ' n_companies=' :n_companies ' n_applications=' :n_applications ' n_impressions=' :n_impressions
\echo 'reps=' :reps ' warmup=' :warmup ' with_canonical=' :with_canonical

-- ---- safety guard: refuse to run on anything that looks real ---------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email IS NULL
             OR (email NOT LIKE '%@fixture.local' AND email NOT LIKE '%@bench.invalid')) THEN
    RAISE EXCEPTION 'benchmark refuses to run: database contains non-fixture users (is this a real project?)';
  END IF;
END
$guard$;

-- ---- baseline (compare with the "after rollback" block at the end) ----
SELECT 'before' AS phase,
       (SELECT count(*) FROM public.jobs)               AS jobs,
       (SELECT count(*) FROM public.candidate_profiles) AS candidate_profiles,
       (SELECT count(*) FROM public.applications)       AS applications,
       (SELECT count(*) FROM public.job_impressions)    AS job_impressions,
       (SELECT count(*) FROM auth.users)                AS auth_users,
       pg_size_pretty(pg_total_relation_size('public.jobs')) AS jobs_total_size,
       pg_size_pretty(pg_relation_size('public.idx_jobs_description_embedding')) AS jobs_hnsw_size;

SELECT name || ' = ' || setting AS server_settings
FROM pg_settings
WHERE name IN ('shared_buffers','work_mem','effective_cache_size','jit','max_parallel_workers_per_gather','random_page_cost')
ORDER BY name;

BEGIN;
SET LOCAL statement_timeout = 0;
SET LOCAL session_replication_role = replica;   -- load phase only; reset to origin before timing
SELECT setseed(0.42);                            -- repeatable synthetic data
-- plpgsql caches the plan of RETURN QUERY per session: after 5 executions Postgres may switch to a
-- GENERIC plan. A pooled production backend lives long enough for that, so the default 'auto' keeps
-- that behaviour (use warmup >= 6 for steady-state numbers); force_custom_plan / force_generic_plan
-- isolate the two.
SET LOCAL plan_cache_mode = :plan_mode;

SELECT set_config('bench.reps', :'reps', true), set_config('bench.warmup', :'warmup', true),
       set_config('bench.n_jobs', :'n_jobs', true), set_config('bench.explain', :'explain', true),
       set_config('bench.scen_ords', :'scen_ords', true), set_config('bench.prof_ns', :'prof_ns', true);

CREATE TEMP TABLE b_clock(label text, t timestamptz);
INSERT INTO b_clock VALUES ('start', clock_timestamp());

-- ---- lookup tables --------------------------------------------------------
-- Categories use the same names role_category() returns. w = share of
-- jobs/candidates/applications (Driver/Delivery/Sales are the popular ones).
CREATE TEMP TABLE b_cat AS
SELECT cat_no, cat, role_title, w,
       coalesce(sum(w) OVER (ORDER BY cat_no ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS lo,
       CASE WHEN cat_no = 10 THEN 2 ELSE sum(w) OVER (ORDER BY cat_no) END AS hi
FROM (VALUES
  (1,  'Driver',           'Car Driver',                 0.17),
  (2,  'Delivery',         'Delivery Executive',         0.16),
  (3,  'Security',         'Security Guard',             0.10),
  (4,  'Warehouse',        'Warehouse Packer',           0.08),
  (5,  'Telecaller',       'Telecaller',                 0.09),
  (6,  'Customer Support', 'Customer Support Executive', 0.08),
  (7,  'Data Entry',       'Data Entry Operator',        0.06),
  (8,  'Sales',            'Sales Executive',            0.11),
  (9,  'Retail',           'Retail Store Executive',     0.08),
  (10, 'Cook',             'Cook',                       0.07)
) v(cat_no, cat, role_title, w);

-- Sanity: every role_title must map back to its category.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM b_cat WHERE public.role_category(role_title) IS DISTINCT FROM cat) THEN
    RAISE EXCEPTION 'benchmark role titles no longer match role_category(); update b_cat';
  END IF;
END $$;

CREATE TEMP TABLE b_city(city_no int PRIMARY KEY, city text);
INSERT INTO b_city
SELECT i, c FROM unnest(ARRAY['Delhi','Mumbai','Bangalore','Pune','Hyderabad','Chennai','Kolkata','Ahmedabad',
  'Jaipur','Lucknow','Surat','Chandigarh','Indore','Bhopal','Nagpur','Patna','Kanpur','Noida','Gurgaon','Vadodara'])
  WITH ORDINALITY AS t(c, i);

-- 60 skills, 6 "core" per category.
CREATE TEMP TABLE b_skill AS
SELECT row_number() OVER () AS idx, v.cat_no, s AS name
FROM (VALUES
  (1,  ARRAY['driving','valid license','city navigation','night driving','heavy vehicle license','vehicle maintenance']),
  (2,  ARRAY['two-wheeler','delivery','navigation','route planning','cash handling','smartphone usage']),
  (3,  ARRAY['security','night shift','fire safety','patrolling','cctv monitoring','crowd control']),
  (4,  ARRAY['packing','inventory','loading','forklift','stock counting','barcode scanning']),
  (5,  ARRAY['telecalling','hindi','communication','lead follow-up','outbound calls','crm basics']),
  (6,  ARRAY['customer support','english','crm','email support','chat support','complaint handling']),
  (7,  ARRAY['data entry','excel','typing','ms office','data verification','record keeping']),
  (8,  ARRAY['sales','negotiation','lead generation','field sales','cold calling','target achievement']),
  (9,  ARRAY['retail','billing','customer handling','cashier','merchandising','pos systems']),
  (10, ARRAY['cooking','north indian','tandoor','kitchen hygiene','continental','food prep'])
) v(cat_no, arr), unnest(v.arr) s;

-- Category-structured unit vectors (same idea as fixtures/seed_local.sql fx_vec):
-- same-category cosine ~0.95+, cross-category ~0. 40 variants per category
-- are precomputed once and re-used (cheap) instead of one sin() wave per row.
CREATE FUNCTION pg_temp.b_vec(_cat int, _noise int) RETURNS vector
LANGUAGE sql IMMUTABLE AS $f$
  WITH p AS (SELECT 0.31 + 0.53 * _cat AS seed),
  raw AS (
    SELECT i, sin(i * p.seed) + 0.25 * sin(i * (1.9 + _noise * 0.013) + _noise) AS x
    FROM p, generate_series(1, 1536) i
  ), n AS (SELECT sqrt(sum(x * x)) AS norm FROM raw)
  SELECT (array_agg(raw.x / n.norm ORDER BY raw.i))::float8[]::vector(1536) FROM raw, n
$f$;
CREATE TEMP TABLE b_vec AS
SELECT c.cat_no, v.var, pg_temp.b_vec(c.cat_no, 100 + v.var) AS vec
FROM b_cat c, generate_series(1, 40) v(var);

-- ---- canonical skills (optional) ---------------------------------------------
INSERT INTO public.canonical_skills (name, aliases, category, is_active)
SELECT name, ARRAY[name || ' skill', name || 's'], (SELECT cat FROM b_cat c WHERE c.cat_no = b_skill.cat_no), true
FROM b_skill
WHERE :with_canonical = 1
ON CONFLICT (name) DO NOTHING;

-- ---- companies -------------------------------------------------------------------
CREATE TEMP TABLE b_company AS
SELECT n, gen_random_uuid() AS id FROM generate_series(1, :n_companies) n;
ALTER TABLE b_company ADD PRIMARY KEY (n);

INSERT INTO public.companies (id, name, industry, primary_city, is_verified, verification_status, onboarding_completed, description)
SELECT b.id, 'Bench Company ' || b.n,
       (ARRAY['Logistics','Services','Retail','Hospitality','Manufacturing','BPO'])[1 + b.n % 6],
       (SELECT city FROM b_city WHERE city_no = 1 + b.n % 20),
       b.n % 5 < 2,
       CASE WHEN b.n % 5 < 2 THEN 'verified' ELSE 'unverified' END,
       true, 'Synthetic benchmark company'
FROM b_company b;

-- ---- jobs (active servable + historical closed/expired) -----------------------
CREATE TEMP TABLE b_job AS
SELECT s.n, s.id, c.cat_no, c.cat,
       c.role_title || (ARRAY['', ' (Urgent)', ' - Immediate Joining', ' Required'])[1 + s.n % 4] AS title,
       s.company_no,
       CASE WHEN s.n <= :n_jobs THEN 'active'
            WHEN s.r_status < 0.7 THEN 'closed' ELSE 'expired' END AS status,
       (SELECT city FROM b_city WHERE city_no = s.city_no) AS city,
       10000 + c.cat_no * 1000 + floor(s.r_sal * 10)::int * 1000 AS min_salary,
       10000 + c.cat_no * 1000 + floor(s.r_sal * 10)::int * 1000 + 3000 + floor(s.r_exp * 8)::int * 1000 AS max_salary,
       floor(s.r_exp * 4)::int AS min_exp,
       floor(s.r_exp * 4)::int + 1 + floor(s.r_age * 5)::int AS max_exp,
       CASE WHEN s.r_wm < 0.78 THEN 'onsite' WHEN s.r_wm < 0.88 THEN 'field'
            WHEN s.r_wm < 0.95 THEN 'hybrid' ELSE 'remote' END AS wm,
       CASE WHEN s.r_jt < 0.85 THEN 'full_time' WHEN s.r_jt < 0.93 THEN 'part_time'
            WHEN s.r_jt < 0.97 THEN 'contract' ELSE 'temporary' END AS jt,
       CASE WHEN s.r_tier < 0.08 THEN 'trending' WHEN s.r_tier < 0.20 THEN 'classic_plus' ELSE 'classic' END AS tier,
       CASE WHEN s.n <= :n_jobs THEN now() - (power(s.r_age2, 1.3) * 45) * interval '1 day'
            ELSE now() - (20 + s.r_age2 * 100) * interval '1 day' END AS created_at,
       CASE WHEN s.n > :n_jobs THEN now() - (1 + s.r_age * 20) * interval '1 day'
            WHEN s.r_exp2 < 0.02 THEN now() - interval '1 day'          -- ~2% "active but past expiry"
            ELSE now() + (5 + s.r_exp2 * 40) * interval '1 day' END AS expires_at,
       (s.r_emb < 0.85) AS has_emb,
       1 + floor(s.r_var * 40)::int AS var_no,
       (s.n <= :n_jobs AND s.r_boost < 0.03) AS boosted,
       s.r_boost2,
       (SELECT array_agg(q.name) FROM (
           SELECT k.name FROM b_skill k
           ORDER BY random() * CASE WHEN k.cat_no = c.cat_no THEN 3 ELSE 1 END DESC
           LIMIT 3 + (s.n % 4)) q) AS skills
FROM (SELECT n, gen_random_uuid() AS id,
             random() AS r_cat, random() AS r_status, random() AS r_sal, random() AS r_exp, random() AS r_exp2,
             random() AS r_age, random() AS r_age2, random() AS r_wm, random() AS r_jt, random() AS r_tier,
             random() AS r_emb, random() AS r_var, random() AS r_boost, random() AS r_boost2,
             1 + floor(20 * power(random(), 1.7))::int AS city_no,
             1 + floor(:n_companies * power(random(), 1.5))::int AS company_no
      FROM generate_series(1, :n_jobs + :n_closed) n) s
JOIN b_cat c ON s.r_cat >= c.lo AND s.r_cat < c.hi;
ALTER TABLE b_job ADD PRIMARY KEY (n);

INSERT INTO public.jobs (
  id, company_id, title, description, category, city, state, min_salary, max_salary, skills,
  min_experience_years, max_experience_years, work_mode, job_type, tier, status,
  created_at, expires_at, description_embedding)
SELECT j.id, co.id, j.title, 'Bench job ' || j.n || ' in ' || j.city, j.cat, j.city, 'Bench State',
       j.min_salary, j.max_salary, j.skills, j.min_exp, j.max_exp,
       j.wm::work_mode, j.jt::job_type, j.tier::job_tier, j.status::job_status,
       j.created_at, j.expires_at,
       CASE WHEN j.has_emb THEN v.vec END
FROM b_job j
JOIN b_company co ON co.n = j.company_no
LEFT JOIN b_vec v ON v.cat_no = j.cat_no AND v.var = j.var_no;

-- ~3% of active jobs carry an active boost (jobs.boosted_until is maintained by a trigger
-- that replica mode skips, so set it explicitly)
INSERT INTO public.job_boosts (company_id, job_id, starts_at, ends_at, credits_spent, source)
SELECT jb.company_id, j.id, now() - (j.r_boost2 * 20) * interval '1 hour',
       now() - (j.r_boost2 * 20) * interval '1 hour' + interval '24 hours', 1, 'wallet'
FROM b_job j JOIN public.jobs jb ON jb.id = j.id
WHERE j.boosted;
UPDATE public.jobs SET boosted_until = (SELECT max(ends_at) FROM public.job_boosts b WHERE b.job_id = jobs.id)
WHERE id IN (SELECT id FROM public.job_boosts);

INSERT INTO b_clock VALUES ('jobs_loaded', clock_timestamp());

-- ---- candidates (auth.users + profiles + candidate_profiles + some preferences) ---
-- n=1 Driver/Delhi, n=2 Sales/Delhi (with preferences), n=3 cold start,
-- n=4 Delivery rider who has applied to many jobs. 8% of the rest are cold start.
CREATE TEMP TABLE b_cand AS
SELECT s.n, s.id,
       CASE s.n WHEN 1 THEN 'Driver' WHEN 2 THEN 'Sales' WHEN 3 THEN 'ColdStart' WHEN 4 THEN 'ManyApplications'
            ELSE 'random' END AS label,
       CASE WHEN s.n = 1 THEN 1 WHEN s.n = 2 THEN 8 WHEN s.n = 3 THEN NULL WHEN s.n = 4 THEN 2 ELSE c.cat_no END AS cat_no,
       (s.n = 3 OR (s.n > 4 AND s.r_cold < 0.08)) AS cold,
       CASE WHEN s.n IN (1, 2) THEN 'Delhi' ELSE (SELECT city FROM b_city WHERE city_no = s.city_no) END AS city,
       (SELECT city FROM b_city WHERE city_no = 1 + floor(s.r_pc * 20)::int) AS other_city,
       floor(s.r_yrs * 10)::int AS years,
       12000 + floor(s.r_sal * 18)::int * 1000 AS exp_sal,
       (s.n IN (1, 2, 4) OR s.r_emb < 0.85) AS has_emb,
       1 + floor(s.r_var * 40)::int AS var_no,
       (s.n = 2 OR (s.n > 4 AND s.r_pref < 0.25)) AS has_pref,
       (s.n % 7) AS flavour
FROM (SELECT n, gen_random_uuid() AS id, random() AS r_cat, random() AS r_cold, random() AS r_pc, random() AS r_yrs,
             random() AS r_sal, random() AS r_emb, random() AS r_var, random() AS r_pref,
             1 + floor(20 * power(random(), 1.7))::int AS city_no
      FROM generate_series(1, :n_candidates) n) s
LEFT JOIN b_cat c ON s.r_cat >= c.lo AND s.r_cat < c.hi;
ALTER TABLE b_cand ADD PRIMARY KEY (n);
CREATE INDEX ON b_cand(id);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token)
SELECT '00000000-0000-0000-0000-000000000000', c.id, 'authenticated', 'authenticated',
       'bench_' || c.n || '@bench.invalid', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', 'Bench Candidate ' || c.n, 'user_type', 'candidate'),
       now(), now(), '', '', '', '', '', '', '', ''
FROM b_cand c;

INSERT INTO public.profiles (id, full_name, email, city, user_type)
SELECT c.id, 'Bench Candidate ' || c.n, 'bench_' || c.n || '@bench.invalid',
       CASE WHEN c.cold THEN NULL ELSE c.city END, 'candidate'
FROM b_cand c;

INSERT INTO public.candidate_profiles (
  user_id, experience_status, years_experience, last_role, headline, skills,
  interested_roles, preferred_cities, expected_salary, highest_qualification,
  onboarding_completed, profile_embedding)
SELECT c.id,
       (CASE WHEN c.cold OR c.years = 0 THEN 'fresher' ELSE 'experienced' END)::experience_status,
       CASE WHEN c.cold THEN 0 ELSE c.years END,
       CASE WHEN c.cold OR c.flavour = 6 THEN NULL ELSE cat.role_title END,                 -- ~14% have no last_role
       CASE WHEN c.cold THEN NULL WHEN c.flavour % 2 = 0 THEN 'Experienced ' || cat.role_title || ' looking for work' END,
       CASE WHEN c.cold THEN ARRAY[]::text[] ELSE
         (SELECT coalesce(array_agg(q.name), ARRAY[]::text[]) FROM (
             SELECT k.name FROM b_skill k
             ORDER BY random() * CASE WHEN k.cat_no = c.cat_no THEN 3 ELSE 1 END DESC
             LIMIT 2 + (c.n % 4)) q) END,
       CASE WHEN c.cold THEN ARRAY[]::text[] ELSE ARRAY[cat.role_title] END,
       CASE WHEN c.cold THEN ARRAY[]::text[]
            WHEN c.n % 5 < 2 THEN ARRAY[c.city, c.other_city] ELSE ARRAY[c.city] END,
       CASE WHEN c.cold THEN NULL ELSE c.exp_sal END,
       CASE WHEN c.cold THEN NULL ELSE (ARRAY['10th','12th','Graduate'])[1 + c.n % 3] END,
       true,
       CASE WHEN c.cold OR NOT c.has_emb THEN NULL ELSE v.vec END
FROM b_cand c
LEFT JOIN b_cat cat ON cat.cat_no = c.cat_no
LEFT JOIN b_vec v ON v.cat_no = c.cat_no AND v.var = c.var_no;

INSERT INTO public.candidate_preferences (user_id, min_salary_monthly, max_salary_monthly, job_types, work_modes,
                                          min_experience_years, max_experience_years)
SELECT c.id, 12000 + (c.n % 4) * 2000, 25000 + (c.n % 4) * 5000,
       ARRAY['full_time'], ARRAY['onsite','field'], 0, 4 + c.n % 6
FROM b_cand c WHERE c.has_pref AND NOT c.cold;

INSERT INTO b_clock VALUES ('candidates_loaded', clock_timestamp());

-- ---- applications: spread over 40 days, skewed to popular categories -----------------
CREATE TEMP TABLE b_job_by_cat AS
SELECT j.id, jb.company_id, j.cat_no, row_number() OVER (PARTITION BY j.cat_no ORDER BY j.n) AS rn
FROM b_job j JOIN public.jobs jb ON jb.id = j.id
WHERE j.status = 'active';
CREATE INDEX ON b_job_by_cat(cat_no, rn);
CREATE TEMP TABLE b_cat_cnt AS SELECT cat_no, count(*) AS cnt FROM b_job_by_cat GROUP BY cat_no;
ANALYZE b_job_by_cat;

INSERT INTO public.applications (job_id, candidate_id, company_id, status, created_at)
SELECT j.id, cd.id, j.company_id, 'applied', now() - (a.r_age * 40) * interval '1 day'
FROM (SELECT random() AS r_cat, random() AS r_job, random() AS r_age,
             1 + floor(:n_candidates * power(random(), 1.3))::int AS cand_no
      FROM generate_series(1, :n_applications)) a
JOIN b_cat c ON a.r_cat >= c.lo AND a.r_cat < c.hi
JOIN b_cat_cnt cc ON cc.cat_no = c.cat_no
JOIN b_job_by_cat j ON j.cat_no = c.cat_no AND j.rn = 1 + floor(a.r_job * cc.cnt)::bigint
JOIN b_cand cd ON cd.n = a.cand_no
ON CONFLICT (job_id, candidate_id) DO NOTHING;

-- the "many applications" candidate (n=4): ~10% of the jobs, capped at 400
INSERT INTO public.applications (job_id, candidate_id, company_id, status, created_at)
SELECT j.id, (SELECT id FROM b_cand WHERE n = 4), j.company_id, 'applied', now() - random() * 40 * interval '1 day'
FROM b_job_by_cat j
ORDER BY random()
LIMIT least(400, :n_jobs / 10)
ON CONFLICT (job_id, candidate_id) DO NOTHING;

-- ---- filler impressions ----------------------------------------------------------------
INSERT INTO public.job_impressions (candidate_user_id, job_id, source, "position", shown_at, variant, sort)
SELECT cd.id, j.id, 'browse', floor(i.r_pos * 40)::int, now() - (i.r_age * 14) * interval '1 day', 'v1', 'recommended'
FROM (SELECT random() AS r_pos, random() AS r_age,
             1 + floor(:n_candidates * random())::int AS cand_no,
             1 + floor(:n_jobs * random())::int AS job_no
      FROM generate_series(1, :n_impressions)) i
JOIN b_cand cd ON cd.n = i.cand_no
JOIN b_job j ON j.n = i.job_no;

-- ---- recent engagement for the 4 test candidates (feeds V2 "recent intent") -------------
-- 10 'viewed' events in their own category over the last 10 days, 2 saved jobs, and
-- repeat impressions of 5 jobs on 3 distinct past days (fatigue demotion path).
INSERT INTO public.job_recommendation_feedback (candidate_user_id, job_id, action, created_at)
SELECT c.id, j.id, 'viewed', now() - (j.rn % 10) * interval '1 day'
FROM b_cand c
JOIN b_job_by_cat j ON j.cat_no = c.cat_no AND j.rn <= 10
WHERE c.n <= 4 AND NOT c.cold;
INSERT INTO public.saved_jobs (user_id, job_id)
SELECT c.id, j.id FROM b_cand c JOIN b_job_by_cat j ON j.cat_no = c.cat_no AND j.rn BETWEEN 11 AND 12
WHERE c.n <= 4 AND NOT c.cold ON CONFLICT DO NOTHING;
INSERT INTO public.job_impressions (candidate_user_id, job_id, source, "position", shown_at, variant, sort)
SELECT c.id, j.id, 'browse', 0, now() - d * interval '1 day', 'v1', 'recommended'
FROM b_cand c
JOIN b_job_by_cat j ON j.cat_no = c.cat_no AND j.rn BETWEEN 21 AND 25
CROSS JOIN generate_series(1, 3) d
WHERE c.n <= 4;

-- ---- statistics for the planner (ANALYZE is allowed inside a transaction) --------------
ANALYZE public.jobs;
ANALYZE public.companies;
ANALYZE public.applications;
ANALYZE public.profiles;
ANALYZE public.candidate_profiles;
ANALYZE public.candidate_preferences;
ANALYZE public.job_boosts;
ANALYZE public.job_impressions;
ANALYZE public.job_recommendation_feedback;
ANALYZE public.saved_jobs;
ANALYZE public.canonical_skills;
INSERT INTO b_clock VALUES ('loaded_and_analyzed', clock_timestamp());

-- production code paths run with triggers enabled
SET LOCAL session_replication_role = origin;

\echo
\echo '== dataset =='
SELECT (SELECT count(*) FROM public.jobs WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS servable_active_jobs,
       (SELECT count(*) FROM public.jobs) AS jobs_total,
       (SELECT count(*) FROM public.jobs WHERE description_embedding IS NOT NULL) AS jobs_with_embedding,
       (SELECT count(*) FROM public.companies) AS companies,
       (SELECT count(*) FROM public.candidate_profiles) AS candidates,
       (SELECT count(*) FROM public.candidate_profiles WHERE profile_embedding IS NOT NULL) AS cands_with_embedding,
       (SELECT count(*) FROM public.applications) AS applications,
       (SELECT count(*) FROM public.applications WHERE created_at >= now() - interval '30 days') AS apps_30d,
       (SELECT count(*) FROM public.job_boosts WHERE ends_at > now()) AS active_boosts,
       (SELECT count(*) FROM public.job_impressions) AS impressions,
       (SELECT count(*) FROM public.canonical_skills) AS canonical_skills,
       pg_size_pretty(pg_total_relation_size('public.jobs')) AS jobs_total_size,
       pg_size_pretty(pg_relation_size('public.idx_jobs_description_embedding')) AS jobs_hnsw_size;
SELECT label AS load_step, round(extract(epoch FROM t - lag(t) OVER (ORDER BY t))::numeric, 1) AS seconds FROM b_clock ORDER BY t;

-- ---- timing harness ------------------------------------------------------------------------
CREATE TEMP TABLE b_res(scenario text, profile text, rep int, ms numeric, n_rows bigint);

CREATE FUNCTION pg_temp.b_run(_scen text, _prof text, _uid uuid, _sql text, _reps int, _warm int, _clear_log boolean, _v2 boolean)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE i int; t0 timestamptz; t1 timestamptz; n bigint; v_ok bigint; v_fb bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'benchmark auth failure: auth.uid() = %, expected %', auth.uid(), _uid;
  END IF;
  FOR i IN 1 .. _warm + _reps LOOP
    -- The router's burst guard suppresses re-logging the same job within 10 s and now() is
    -- frozen inside a transaction, so clear this user's logged impressions (untimed) to make
    -- every repetition pay the real INSERT cost, as a fresh page view in production would.
    IF _clear_log THEN
      DELETE FROM public.job_impressions WHERE candidate_user_id = _uid AND request_id IS NOT NULL;
    END IF;
    t0 := clock_timestamp();
    EXECUTE _sql INTO n;
    t1 := clock_timestamp();
    IF i > _warm THEN
      INSERT INTO b_res VALUES (_scen, _prof, i - _warm, extract(epoch FROM (t1 - t0)) * 1000, n);
    END IF;
  END LOOP;
  -- The router swallows V2 errors (falls back to V1 with a WARNING), which would silently
  -- time V1 as "V2". Prove the V2 arm really served the last call (impressions of the last
  -- iteration are still in the table because the log is only cleared BEFORE each call).
  IF _v2 AND _clear_log THEN
    SELECT count(*) FILTER (WHERE variant = 'v2'),
           count(*) FILTER (WHERE 'V2_FALLBACK' = ANY (coalesce(reason_codes, ARRAY[]::text[])))
      INTO v_ok, v_fb
    FROM public.job_impressions WHERE candidate_user_id = _uid AND request_id IS NOT NULL;
    IF v_ok = 0 OR v_fb > 0 THEN
      RAISE EXCEPTION 'V2 scenario % / % did not run V2 (v2 impressions %, fallback rows %)', _scen, _prof, v_ok, v_fb;
    END IF;
  END IF;
  RAISE NOTICE '% | % | mean % ms', _scen, _prof,
    (SELECT round(avg(ms), 0) FROM b_res WHERE scenario = _scen AND profile = _prof);
END $f$;

-- scenario list: ord, name, v2 on?, clear impressions?, statement
CREATE TEMP TABLE b_scn(ord int, name text, v2 boolean, clear_log boolean, sql text);
INSERT INTO b_scn VALUES
 (1, 'a1 V1 direct p1 (recommended)',        false, false, 'select count(*) from public.recommend_jobs_for_candidate(_limit=>14, _sort=>''recommended'')'),
 (2, 'a2 V1 direct p5 (offset 56)',          false, false, 'select count(*) from public.recommend_jobs_for_candidate(_limit=>14, _offset=>56, _sort=>''recommended'')'),
 (3, 'd1 V1 +city filter (Delhi)',           false, false, 'select count(*) from public.recommend_jobs_for_candidate(_limit=>14, _city=>''Delhi'', _sort=>''recommended'')'),
 (4, 'd2 V1 relevant_only',                  false, false, 'select count(*) from public.recommend_jobs_for_candidate(_limit=>14, _relevant_only=>true, _sort=>''recommended'')'),
 (5, 'd3 V1 sort=newest',                    false, false, 'select count(*) from public.recommend_jobs_for_candidate(_limit=>14, _sort=>''newest'')'),
 (6, 'b  router, V2 off p1',                 false, true,  'select count(*) from public.recommend_jobs_routed(_limit=>14, _surface=>''browse'')'),
 (7, 'c1 router, V2 on p1',                  true,  true,  'select count(*) from public.recommend_jobs_routed(_limit=>14, _surface=>''browse'')'),
 (8, 'c2 router, V2 on p5 (offset 56)',      true,  true,  'select count(*) from public.recommend_jobs_routed(_limit=>14, _offset=>56, _surface=>''browse'')');

\if :skip_timing
\else
DO $$
DECLARE r record; p record;
        reps int := current_setting('bench.reps')::int;
        warm int := current_setting('bench.warmup')::int;
BEGIN
  FOR r IN SELECT * FROM b_scn
           WHERE current_setting('bench.scen_ords') = '' OR ord = ANY (string_to_array(current_setting('bench.scen_ords'), ',')::int[])
           ORDER BY ord LOOP
    UPDATE public.recommendation_settings
       SET v2_enabled = r.v2, v2_rollout_pct = 0,
           v2_allowlist = (SELECT array_agg(id) FROM b_cand WHERE n <= 4)
     WHERE id = 1;
    FOR p IN SELECT bc.n, bc.label, bc.id FROM b_cand bc
             WHERE bc.n = ANY (string_to_array(current_setting('bench.prof_ns'), ',')::int[]) ORDER BY bc.n LOOP
      PERFORM pg_temp.b_run(r.name, p.label, p.id, r.sql, reps, warm, r.clear_log, r.v2);
    END LOOP;
  END LOOP;
END $$;
\endif

\echo
\echo '== eligible-set size per profile (total_count of V1, no filters) =='
DO $$
DECLARE p record; v_total bigint;
BEGIN
  FOR p IN SELECT bc.label, bc.id FROM b_cand bc WHERE bc.n <= 4 ORDER BY bc.n LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    SELECT max(total_count) INTO v_total FROM public.recommend_jobs_for_candidate(_limit=>1);
    RAISE NOTICE '% : % eligible jobs scored per V1 request', p.label, v_total;
  END LOOP;
END $$;

\echo
\echo '== results: ms per call (p50 / p95 / max over reps), per profile =='
SELECT scenario, profile, count(*) AS reps,
       round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p95_ms,
       round(max(ms), 1) AS max_ms
FROM b_res GROUP BY scenario, profile ORDER BY scenario, profile;

\echo
\echo '== results: all profiles pooled =='
SELECT scenario, count(*) AS samples,
       round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p50_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms)::numeric, 1) AS p95_ms,
       round(max(ms), 1) AS max_ms, round(avg(ms), 1) AS mean_ms
FROM b_res GROUP BY scenario ORDER BY scenario;

\echo
\echo '== plan gate: routed-V2 / V1 (ratio of means, per profile; gate <= 1.4) =='
SELECT v1.profile,
       round(avg(v1.ms), 1)  AS v1_mean_ms,
       round(avg(v2.ms), 1)  AS routed_v2_p1_mean_ms,
       round(avg(v2.ms) / nullif(avg(v1.ms), 0), 2) AS ratio_p1,
       round(avg(v5.ms) / nullif(avg(v1.ms), 0), 2) AS ratio_p5,
       round(avg(rt.ms) / nullif(avg(v1.ms), 0), 2) AS router_v2_off_ratio
FROM b_res v1
JOIN b_res v2 ON v2.profile = v1.profile AND v2.scenario LIKE 'c1%'
JOIN b_res v5 ON v5.profile = v1.profile AND v5.scenario LIKE 'c2%'
JOIN b_res rt ON rt.profile = v1.profile AND rt.scenario LIKE 'b %'
WHERE v1.scenario LIKE 'a1%'
GROUP BY v1.profile ORDER BY v1.profile;

-- ---- EXPLAIN of V1 ----------------------------------------------------------------------------
-- V1 is a plpgsql function, so EXPLAIN of the call shows only a Function Scan. To see the inner
-- query plan we build a throw-away pg_temp clone of the CURRENT function body whose
-- `RETURN QUERY <select>` becomes `RETURN QUERY EXPLAIN (...) <select>` (plpgsql passes its
-- variables through to EXPLAIN), so it stays in sync with whatever migration is live.
CREATE FUNCTION pg_temp.mk_explain(_fname text, _opts text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.recommend_jobs_for_candidate'::regproc);
  d := replace(d, 'FUNCTION public.recommend_jobs_for_candidate(', 'FUNCTION pg_temp.' || _fname || '(');
  d := regexp_replace(d, 'RETURNS TABLE\([^)]*\)', 'RETURNS SETOF text');
  d := regexp_replace(d, '\mSTABLE\M', 'VOLATILE');      -- plpgsql refuses EXPLAIN inside a non-volatile function
  d := regexp_replace(d, 'RETURN QUERY\s+WITH s AS', 'RETURN QUERY EXPLAIN (' || _opts || ') WITH s AS');
  IF d NOT LIKE '%EXPLAIN (%' OR d NOT LIKE '%SETOF text%' THEN
    RAISE EXCEPTION 'could not derive EXPLAIN clone of recommend_jobs_for_candidate';
  END IF;
  EXECUTE d;
END $f$;
SELECT pg_temp.mk_explain('v1_explain_notiming', 'ANALYZE, BUFFERS, TIMING OFF');
SELECT pg_temp.mk_explain('v1_explain_timing',   'ANALYZE, BUFFERS, TIMING ON');

\if :explain
SELECT set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true) FROM b_cand WHERE n = 1;
\echo
\echo '== EXPLAIN (ANALYZE, BUFFERS, TIMING OFF): V1, Driver profile, _limit=>14 =='
SELECT * FROM pg_temp.v1_explain_notiming(_limit => 14, _sort => 'recommended');
\echo
\echo '== EXPLAIN (ANALYZE, BUFFERS, TIMING ON) -- per-node actual time, overhead inflates the total =='
SELECT * FROM pg_temp.v1_explain_timing(_limit => 14, _sort => 'recommended');
\if :explain_generic
SET LOCAL plan_cache_mode = force_generic_plan;
\echo
\echo '== EXPLAIN (ANALYZE, BUFFERS, TIMING OFF): V1 under a GENERIC cached plan, Driver profile =='
SELECT * FROM pg_temp.v1_explain_notiming(_limit => 14, _sort => 'recommended');
SET LOCAL plan_cache_mode = force_custom_plan;
\endif
SELECT set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true) FROM b_cand WHERE n = 3;
\echo
\echo '== EXPLAIN (ANALYZE, BUFFERS, TIMING ON): V1, ColdStart profile =='
SELECT * FROM pg_temp.v1_explain_timing(_limit => 14, _sort => 'recommended');
\endif

ROLLBACK;

-- ---- after rollback: must equal the "before" row printed at the top ----------------------
SELECT 'after_rollback' AS phase,
       (SELECT count(*) FROM public.jobs)               AS jobs,
       (SELECT count(*) FROM public.candidate_profiles) AS candidate_profiles,
       (SELECT count(*) FROM public.applications)       AS applications,
       (SELECT count(*) FROM public.job_impressions)    AS job_impressions,
       (SELECT count(*) FROM auth.users)                AS auth_users,
       pg_size_pretty(pg_total_relation_size('public.jobs')) AS jobs_total_size,
       pg_size_pretty(pg_relation_size('public.idx_jobs_description_embedding')) AS jobs_hnsw_size;
\echo 'Now run: VACUUM (ANALYZE) on the touched tables (and REINDEX TABLE public.jobs if the HNSW index stayed large).'

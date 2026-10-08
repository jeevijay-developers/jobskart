-- verify_seed_local.sql -- proves seed_local.sql fixtures are usable. LOCAL ONLY.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/fixtures/verify_seed_local.sql
-- Exits non-zero on any failed ASSERT. Read-only apart from set_config.

DO $v$
DECLARE
  _n int; _a numeric; _b numeric; _stage text;
  _d1 constant uuid := '00000000-0000-4000-8000-00000000d001';
  _driver constant uuid := '00000000-0000-4000-8000-00000000c001';
  _cold constant uuid := '00000000-0000-4000-8000-00000000c013';
  _cold2 constant uuid := '00000000-0000-4000-8000-00000000c014';
  _admin constant uuid := '00000000-0000-4000-8000-00000000a001';
  _cap int; _ncomp int; _top int; _i int; _c record;
BEGIN
  -- ---- counts ----------------------------------------------------------
  SELECT count(*) INTO _n FROM public.candidate_profiles WHERE onboarding_completed;
  ASSERT _n >= 14, format('expected >=14 onboarded candidates, got %s', _n);
  SELECT count(*) INTO _n FROM public.jobs WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now());
  ASSERT _n >= 40, format('expected >=40 servable active jobs, got %s', _n);
  SELECT count(*) INTO _n FROM public.companies;
  ASSERT _n >= 3, 'expected >=3 companies';
  ASSERT (SELECT count(*) FROM public.companies WHERE is_verified) >= 1, 'need a verified company';
  ASSERT (SELECT count(*) FROM public.platform_roles WHERE role = 'super_admin') >= 1, 'need a super_admin';
  SELECT count(*) INTO _n FROM public.jobs
   WHERE id IN (SELECT ('00000000-0000-4000-8000-00000000b0' || nn)::uuid FROM (VALUES ('41'),('42'),('43'),('44')) v(nn))
     AND NOT (status = 'active' AND (expires_at IS NULL OR expires_at > now()));
  ASSERT _n = 4, format('expected 4 non-servable fixture jobs, got %s', _n);
  ASSERT (SELECT count(*) FROM public.job_boosts WHERE ends_at > now()) >= 3, 'need >=3 active boosts';
  ASSERT (SELECT count(*) FROM public.jobs WHERE company_id = _d1 AND status = 'active') >= 8, 'd001 must own >=8 active jobs';
  ASSERT (SELECT count(*) FROM public.jobs WHERE description_embedding IS NOT NULL) > 0
     AND (SELECT count(*) FROM public.jobs WHERE description_embedding IS NULL AND status = 'active') > 0,
     'need both embedded and NULL-embedding jobs';
  ASSERT (SELECT count(*) FROM public.candidate_profiles WHERE profile_embedding IS NULL AND onboarding_completed) >= 2,
     'need NULL-embedding candidates';
  ASSERT (SELECT count(*) FROM public.applications) >= 10, 'need >=10 applications';
  ASSERT (SELECT count(*) FROM public.saved_jobs) >= 6, 'need >=6 saved jobs';

  -- ---- role helpers ---------------------------------------------------------
  ASSERT public.has_platform_role(_admin, 'super_admin'), 'admin must be platform super_admin';
  ASSERT public.has_company_membership('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d003'),
         'employer3 must be member of d003';

  -- ---- Driver candidate: impersonate ---------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _driver, 'role', 'authenticated')::text, false);
  ASSERT auth.uid() = _driver, 'impersonation failed';

  SELECT count(*) INTO _n FROM public.recommend_jobs_for_candidate(_limit => 20, _sort => 'recommended');
  ASSERT _n > 0, 'driver got no rows';

  SELECT avg(score) INTO _a FROM (
    SELECT r.score FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'recommended') r
    JOIN public.jobs j ON j.id = r.id WHERE j.category = 'Driver' ORDER BY r.score DESC LIMIT 5) x;
  SELECT avg(r.score) INTO _b FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'recommended') r
    JOIN public.jobs j ON j.id = r.id WHERE j.category = 'Sales';
  ASSERT _a IS NOT NULL AND _b IS NOT NULL AND _a > _b,
         format('driver should score Driver jobs (%s) above Sales jobs (%s)', _a, _b);

  -- applied jobs b001 and b005 never shown to c001
  ASSERT NOT EXISTS (SELECT 1 FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'recommended') r
                     WHERE r.id IN ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b005')),
         'applied jobs leaked into driver feed';
  ASSERT EXISTS (SELECT 1 FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'recommended') r
                 WHERE r.id = '00000000-0000-4000-8000-00000000b002'), 'unapplied Driver job b002 missing';

  -- Company diversity cap. Rows with per-company rank <= max_same_company_in_top sort first, so
  -- the first LEAST(10, cap * distinct_companies) rows may hold at most cap rows per company.
  -- (Rows after that are overflow and may legitimately come from one company.)
  SELECT max_same_company_in_top INTO _cap FROM public.recommendation_settings WHERE id = 1;
  SELECT count(DISTINCT company_id) INTO _ncomp FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'recommended');
  _top := LEAST(10, _cap * _ncomp);
  ASSERT _top >= 6, 'too few companies to test the cap';
  SELECT count(*) INTO _n FROM public.recommend_jobs_for_candidate(_limit => _top, _sort => 'recommended') WHERE company_id = _d1;
  ASSERT _n <= _cap, format('company d001 holds %s of first %s rows (cap %s)', _n, _top, _cap);
  -- without the cap d001 could dominate: it owns more eligible jobs than the cap
  ASSERT (SELECT count(*) FROM public.recommend_jobs_for_candidate(_limit => 100, _sort => 'newest') WHERE company_id = _d1) > _cap,
         'd001 should own more eligible jobs than the cap';

  -- ---- non-servable / applied jobs never appear for ANY fixture candidate -------------
  FOR _c IN SELECT user_id FROM public.candidate_profiles
            WHERE onboarding_completed AND user_id::text LIKE '00000000-0000-4000-8000-00000000c0%' LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _c.user_id, 'role', 'authenticated')::text, false);
    ASSERT auth.uid() = _c.user_id, 'impersonation failed in loop';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.recommend_jobs_for_candidate(_limit => 200, _sort => 'recommended') r
      JOIN public.jobs j ON j.id = r.id
      WHERE j.status <> 'active' OR (j.expires_at IS NOT NULL AND j.expires_at <= now())),
      format('non-servable job leaked for candidate %s', _c.user_id);
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.recommend_jobs_for_candidate(_limit => 200, _sort => 'recommended') r
      JOIN public.applications a ON a.job_id = r.id AND a.candidate_id = _c.user_id),
      format('applied job leaked for candidate %s', _c.user_id);
  END LOOP;

  -- ---- cold-start candidates (both) -------------------------------------------------------
  FOR _i IN 0..1 LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', CASE _i WHEN 0 THEN _cold ELSE _cold2 END, 'role', 'authenticated')::text, false);
    SELECT count(*), min(recommendation_stage) INTO _n, _stage
      FROM public.recommend_jobs_for_candidate(_limit => 20, _sort => 'recommended');
    ASSERT _n > 0, 'cold-start candidate got no rows';
    ASSERT _stage <> 'personalized', format('cold-start stage must not be personalized, got %s', _stage);
  END LOOP;

  PERFORM set_config('request.jwt.claims', '', false);
  RAISE NOTICE 'verify_seed_local: ALL ASSERTIONS PASSED (driver % vs sales % avg score; d001 cap % over first % rows)',
    round(_a, 4), round(_b, 4), _cap, LEAST(10, _cap * _ncomp);
END
$v$;

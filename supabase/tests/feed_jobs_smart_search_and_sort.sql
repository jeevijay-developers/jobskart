-- feed_jobs_smart_search_and_sort.sql -- tests for 20261012130000_feed_jobs_smart_search_and_sort.sql.
-- LOCAL ONLY. Requires supabase/tests/fixtures/seed_local.sql to be loaded.
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/feed_jobs_smart_search_and_sort.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

SELECT count(*) AS jobs_before FROM public.jobs \gset

BEGIN;

DO $t$
DECLARE
  _n int;
  _titles text[];
  _company_a uuid;
  _company_b uuid;
  _old_sales uuid;
  _new_bde uuid;
  _old_dev uuid;
  _new_bd_eng uuid;
  _newest_title text;
BEGIN
  -- precondition: exactly one feed_jobs overload (the stale 18-arg one must be gone)
  SELECT count(*) INTO _n FROM pg_proc WHERE proname = 'feed_jobs';
  ASSERT _n = 1, format('precondition: expected exactly 1 feed_jobs overload, found %s', _n);

  SELECT id INTO _company_a FROM public.companies LIMIT 1;
  SELECT id INTO _company_b FROM public.companies OFFSET 1 LIMIT 1;
  ASSERT _company_a IS NOT NULL AND _company_b IS NOT NULL, 'precondition: need 2 companies';

  -- 1. Searching "sales" must catch a related title that does not literally contain "sales"
  --    (the bug: plain ILIKE missed this; job_matches_search()/role_category() catch it).
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category)
  VALUES (_company_a, (SELECT user_id FROM public.employer_members WHERE company_id = _company_a LIMIT 1),
          'Business Development Executive', 'x', 'active', 'Sales')
  RETURNING id INTO _new_bde;
  SELECT array_agg(title) INTO _titles FROM public.feed_jobs(_q => 'sales', _limit => 200);
  ASSERT 'Business Development Executive' = ANY(_titles),
    format('1: searching "sales" should match "Business Development Executive" via job_matches_search, got %s', _titles);

  -- 2. A literal title match for an unrelated word still works (ILIKE path kept as a fallback, not replaced).
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category)
  VALUES (_company_a, (SELECT user_id FROM public.employer_members WHERE company_id = _company_a LIMIT 1),
          'Zzqq Operator', 'x', 'active', NULL)
  RETURNING id INTO _old_sales;
  SELECT array_agg(title) INTO _titles FROM public.feed_jobs(_q => 'zzqq', _limit => 200);
  ASSERT 'Zzqq Operator' = ANY(_titles), format('2: literal ILIKE match must still work, got %s', _titles);

  -- 3. A query matching no job's title/category/skills returns nothing (no over-matching).
  SELECT array_agg(title) INTO _titles FROM public.feed_jobs(_q => 'zzqqnonexistentxyz', _limit => 200);
  ASSERT _titles IS NULL, format('3: nonsense query should match nothing, got %s', _titles);

  -- 4. _sort = 'newest' actually orders by created_at desc (not the boost/freshness/quality score).
  --    now() is frozen for the whole transaction, so give every other test row an explicit, clearly
  --    older created_at and this one clock_timestamp() (which does advance), rather than relying on
  --    insertion order or the id tiebreak to decide it.
  UPDATE public.jobs SET created_at = now() - interval '1 day' WHERE id IN (_new_bde, _old_sales);
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category, created_at)
  VALUES (_company_b, (SELECT user_id FROM public.employer_members WHERE company_id = _company_b LIMIT 1),
          'Brand New Zzqq Role', 'x', 'active', NULL, clock_timestamp())
  RETURNING id INTO _old_dev;
  SELECT title INTO _newest_title FROM public.feed_jobs(_sort => 'newest', _limit => 1);
  ASSERT _newest_title = 'Brand New Zzqq Role', format('4: newest sort should surface the just-created job first, got %s', _newest_title);

  -- 5. Omitting _sort keeps the old default behaviour (backward compatible for any existing caller).
  SELECT count(*) INTO _n FROM public.feed_jobs(_limit => 1);
  ASSERT _n = 1, '5: default call (no _sort arg) must still work';

  -- 6. Unknown/garbage _sort values fall back to the recommended (score) order instead of erroring.
  PERFORM 1 FROM public.feed_jobs(_sort => 'not_a_real_sort', _limit => 1);

  -- 7. category/city/salary filters are unaffected by the new matching (still exact/ILIKE, not fuzzy).
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category, city)
  VALUES (_company_a, (SELECT user_id FROM public.employer_members WHERE company_id = _company_a LIMIT 1),
          'Category Filter Probe', 'x', 'active', 'Security', 'ZzqqCity')
  RETURNING id INTO _new_bd_eng;
  SELECT count(*) INTO _n FROM public.feed_jobs(_category => 'Security', _city => 'zzqqcity', _limit => 200);
  ASSERT _n >= 1, '7: category + city filters must still narrow results';
END $t$;

ROLLBACK;

SELECT count(*) = :jobs_before AS clean FROM public.jobs \gset
\if :clean
\echo 'feed_jobs_smart_search_and_sort: all assertions passed, jobs table unchanged (rolled back cleanly)'
\else
DO $$ BEGIN RAISE EXCEPTION 'feed_jobs_smart_search_and_sort: jobs row count changed - the test left residue'; END $$;
\endif

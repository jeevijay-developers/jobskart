-- job_impressions_lockdown.sql -- tests for 20261008102545_job_impressions_server_only_writes.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql to be loaded (candidates ...c001, ...c002, active jobs).
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/job_impressions_lockdown.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

BEGIN;

-- d. privileges (catalog level)
DO $t$
BEGIN
  ASSERT NOT has_table_privilege('authenticated', 'public.job_impressions', 'INSERT'), 'd: authenticated must NOT have INSERT';
  ASSERT NOT has_table_privilege('authenticated', 'public.job_impressions', 'UPDATE'), 'd: authenticated must NOT have UPDATE';
  ASSERT NOT has_table_privilege('authenticated', 'public.job_impressions', 'DELETE'), 'd: authenticated must NOT have DELETE';
  ASSERT NOT has_table_privilege('authenticated', 'public.job_impressions', 'TRUNCATE'), 'd: authenticated must NOT have TRUNCATE';
  ASSERT has_table_privilege('authenticated', 'public.job_impressions', 'SELECT'), 'd: authenticated must keep SELECT';
  ASSERT NOT has_table_privilege('anon', 'public.job_impressions', 'INSERT'), 'd: anon must NOT have INSERT';
  ASSERT NOT has_table_privilege('anon', 'public.job_impressions', 'SELECT'), 'd: anon must NOT have SELECT';
  -- the INSERT policy is gone, SELECT policies remain
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_impressions' AND cmd IN ('INSERT','ALL')),
    'd: no INSERT/ALL policy may remain on job_impressions';
  ASSERT (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='job_impressions' AND cmd='SELECT') = 2,
    'd: both SELECT policies must remain';
  -- feedback table is unaffected
  ASSERT has_table_privilege('authenticated', 'public.job_recommendation_feedback', 'INSERT'), 'e: feedback INSERT grant must remain';
END
$t$;

-- Seed one impression per candidate as the table owner (postgres).
INSERT INTO public.job_impressions (candidate_user_id, job_id, source, "position")
SELECT u.id, (SELECT id FROM public.jobs WHERE status = 'active' ORDER BY id LIMIT 1), 'recommended', 1
  FROM (VALUES ('00000000-0000-4000-8000-00000000c001'::uuid), ('00000000-0000-4000-8000-00000000c002'::uuid)) u(id);

-- a + b + c + e as authenticated candidate c001
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-4000-8000-00000000c001','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $t$
DECLARE _job uuid; _n int; _before int; _after int;
BEGIN
  ASSERT auth.uid() = '00000000-0000-4000-8000-00000000c001', 'setup: auth.uid() must be c001';
  ASSERT current_user = 'authenticated', 'setup: role must be authenticated';
  SELECT id INTO _job FROM public.jobs WHERE status = 'active' ORDER BY id LIMIT 1;
  ASSERT _job IS NOT NULL, 'setup: need an active job';

  -- a1. insert for self denied
  BEGIN
    INSERT INTO public.job_impressions (candidate_user_id, job_id, source) VALUES (auth.uid(), _job, 'recommended');
    ASSERT false, 'a: authenticated INSERT for own id must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- a2. insert for another candidate denied
  BEGIN
    INSERT INTO public.job_impressions (candidate_user_id, job_id, source)
    VALUES ('00000000-0000-4000-8000-00000000c002', _job, 'recommended');
    ASSERT false, 'a: authenticated INSERT for another candidate must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- a3. update / delete denied as well
  BEGIN
    UPDATE public.job_impressions SET "position" = 99;
    ASSERT false, 'a: authenticated UPDATE must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.job_impressions;
    ASSERT false, 'a: authenticated DELETE must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- b. select own rows only
  SELECT count(*) INTO _n FROM public.job_impressions;
  ASSERT _n = 1, format('b: c001 must see exactly its own 1 impression, saw %s', _n);
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_impressions WHERE candidate_user_id <> auth.uid()),
    'b: c001 must not see other candidates impressions';

  -- c. router still writes impressions (SECURITY DEFINER bypasses the revoked INSERT)
  SELECT count(*) INTO _before FROM public.job_impressions;
  PERFORM count(*) FROM public.recommend_jobs_routed(_limit => 10, _offset => 0, _sort => 'recommended', _surface => 'dashboard');
  SELECT count(*) INTO _after FROM public.job_impressions;
  ASSERT _after > _before, format('c: router must still write impressions (before %s, after %s)', _before, _after);

  -- e. feedback table unaffected: own insert ok, other user's rejected by RLS
  INSERT INTO public.job_recommendation_feedback (candidate_user_id, job_id, action) VALUES (auth.uid(), _job, 'saved');
  BEGIN
    INSERT INTO public.job_recommendation_feedback (candidate_user_id, job_id, action)
    VALUES ('00000000-0000-4000-8000-00000000c002', _job, 'saved');
    ASSERT false, 'e: feedback INSERT for another user must be rejected by RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$t$;

RESET ROLE;

-- anon cannot read
SET LOCAL ROLE anon;
DO $t$
BEGIN
  BEGIN
    PERFORM 1 FROM public.job_impressions LIMIT 1;
    ASSERT false, 'd: anon SELECT must be denied';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$t$;
RESET ROLE;

ROLLBACK;

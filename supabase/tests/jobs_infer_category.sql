-- jobs_infer_category.sql -- tests for 20261012120000_jobs_infer_missing_category.sql. LOCAL ONLY.
-- Requires supabase/tests/fixtures/seed_local.sql to be loaded (jobs ...b001.. exist).
-- Run: docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--        -v ON_ERROR_STOP=1 -q < supabase/tests/jobs_infer_category.sql
-- Exits non-zero on any failed ASSERT. Everything runs inside BEGIN..ROLLBACK, no data is left behind.

SELECT count(*) AS jobs_before FROM public.jobs \gset

BEGIN;

DO $t$
DECLARE
  _tmpl public.jobs%ROWTYPE;
  _id uuid;
  _cat text;
  _hash text;
BEGIN
  SELECT * INTO _tmpl FROM public.jobs WHERE id = '00000000-0000-4000-8000-00000000b001';
  ASSERT _tmpl.id IS NOT NULL, 'precondition: fixture job b001 must exist';

  -- 1. NULL category + classifiable title -> inferred from the title
  INSERT INTO public.jobs (company_id, posted_by, title, description, status)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'Backend Developer', 'x', 'draft') RETURNING id INTO _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'IT', format('1: NULL category + "Backend Developer" should infer IT, got %s', _cat);

  -- 2. explicit category is never overwritten, even when the title would classify differently
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'Backend Developer', 'x', 'draft', 'Sales') RETURNING id INTO _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'Sales', format('2: explicit category must be kept, got %s', _cat);

  -- 3. empty / whitespace category counts as missing
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'Telecaller', 'x', 'draft', '  ') RETURNING id INTO _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'Telecaller', format('3: blank category should infer Telecaller, got %s', _cat);

  -- 4. unclassifiable title stays NULL (NOT "Other": NULL passes the department gate, "Other" would hide the job)
  INSERT INTO public.jobs (company_id, posted_by, title, description, status)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'UI/UX Designer', 'x', 'draft') RETURNING id INTO _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat IS NULL, format('4: unclassifiable title must keep NULL category, got %s', _cat);

  -- 5. renaming the job later infers the category when it is still empty
  UPDATE public.jobs SET title = 'Warehouse Operations Supervisor' WHERE id = _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'Warehouse', format('5: title update should infer Warehouse, got %s', _cat);

  -- 6. renaming a job that already has a category does not change it
  UPDATE public.jobs SET title = 'Backend Developer' WHERE id = _id;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'Warehouse', format('6: existing category must survive a title change, got %s', _cat);

  -- 7. a category filled in by the trigger on UPDATE must still invalidate the job's embedding hash
  --    (the trigger name sorts before invalidate_job_embedding on purpose)
  INSERT INTO public.jobs (company_id, posted_by, title, description, status, category)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'Frontend Developer', 'x', 'draft', 'Sales') RETURNING id INTO _id;
  UPDATE public.jobs SET description_embedding_hash = 'h' WHERE id = _id;
  SELECT description_embedding_hash INTO _hash FROM public.jobs WHERE id = _id;
  ASSERT _hash = 'h', '7 precondition: hash must be settable';
  UPDATE public.jobs SET category = NULL WHERE id = _id;
  SELECT category, description_embedding_hash INTO _cat, _hash FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'IT', format('7: clearing category should re-infer IT from "Frontend Developer", got %s', _cat);
  ASSERT _hash IS NULL, '7: category change made by the trigger must clear the embedding hash';

  -- 8. the migration's one-time backfill statement fixes rows that slipped in without the trigger
  ALTER TABLE public.jobs DISABLE TRIGGER aa_jobs_infer_category;
  INSERT INTO public.jobs (company_id, posted_by, title, description, status)
  VALUES (_tmpl.company_id, _tmpl.posted_by, 'Data Entry Operator', 'x', 'draft') RETURNING id INTO _id;
  ALTER TABLE public.jobs ENABLE TRIGGER aa_jobs_infer_category;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat IS NULL, '8 precondition: row inserted with trigger disabled has no category';
  UPDATE public.jobs SET category = public.role_category(title)
  WHERE (category IS NULL OR btrim(category) = '') AND public.role_category(title) IS NOT NULL;
  SELECT category INTO _cat FROM public.jobs WHERE id = _id;
  ASSERT _cat = 'Data Entry', format('8: backfill should set Data Entry, got %s', _cat);
END $t$;

ROLLBACK;

SELECT count(*) = :jobs_before AS clean FROM public.jobs \gset
\if :clean
\echo 'jobs_infer_category: all assertions passed, jobs table unchanged (rolled back cleanly)'
\else
DO $$ BEGIN RAISE EXCEPTION 'jobs_infer_category: jobs row count changed - the test left residue'; END $$;
\endif

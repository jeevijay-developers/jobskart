-- ============================================================
-- Jobs: never leave `category` empty when the title tells us the department.
--
-- Problem: jobs created through any path that does not set `category` (bulk Excel upload, MCP, imports)
-- ended up with category = NULL. The recommendation engine's department logic (department gate, role
-- score, V2 "similar jobs" intent signal) all key off jobs.category, so those jobs were invisible to it.
-- On the live data 15 of 60 active jobs had no category, including plain "Backend Developer" /
-- "Frontend Developer" postings.
--
-- Fix (database level, so every posting path is covered):
--   1. BEFORE INSERT / UPDATE OF title, category trigger: when category is empty, fill it from
--      public.role_category(title). An explicitly chosen category is never overwritten.
--      When role_category() cannot classify the title it returns NULL and the category stays NULL
--      on purpose: NULL passes the department gate, whereas guessing "Other" would hide the job from
--      every candidate that has a department signal.
--   2. One-time backfill of existing jobs the same way.
--
-- Trigger name starts with "aa_" so it fires BEFORE invalidate_job_embedding (BEFORE triggers fire in
-- name order): category is part of the job's embedding text, so a category change made here must be
-- visible to that trigger so it marks the embedding stale.
--
-- Side effects checked: tg_jobs_alert_event only fires on INSERT / UPDATE OF status (no alerts are
-- sent by this backfill); tg_jobs_lock_window only on expires_at. Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION public.tg_jobs_infer_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.category IS NULL OR btrim(NEW.category) = '' THEN
        NEW.category := public.role_category(NEW.title);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_jobs_infer_category ON public.jobs;
CREATE TRIGGER aa_jobs_infer_category
    BEFORE INSERT OR UPDATE OF title, category ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_infer_category();

-- One-time backfill: only rows with no category where the title can be classified.
UPDATE public.jobs
SET category = public.role_category(title)
WHERE (category IS NULL OR btrim(category) = '')
  AND public.role_category(title) IS NOT NULL;

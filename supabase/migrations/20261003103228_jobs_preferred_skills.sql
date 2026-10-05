-- Split a job's skills into required vs nice-to-have. jobs.skills keeps its
-- existing meaning (required — the recommendation/ranking RPCs and the quality
-- score read it as-is); preferred_skills is purely additive. Used by the resume
-- builder's "Tailor to a job" check, where required skills count double.
-- Additive and re-runnable; existing rows get an empty list.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS preferred_skills text[] NOT NULL DEFAULT '{}';

-- The 18-argument overload of recommend_jobs_for_candidate predates the
-- _relevant_only flag (20261002080905). Every caller (src/lib/job-feed.ts)
-- passes _relevant_only, so the 19-argument version is the only one in use.
-- Keeping both leaves an ambiguous overload behind, so drop the old one.

DROP FUNCTION IF EXISTS public.recommend_jobs_for_candidate(
    integer, integer, text, text, text, text, text, integer, integer, integer, integer,
    timestamp with time zone, text, text, text, text, boolean, boolean
);

-- Drop the stale duplicate recommend_jobs_for_candidate(...) overload.
--
-- Context: 20261007120000_job_search_by_intent.sql (recovered 2026-10-08 from the
-- live database — see that file's header for the full story) re-created
-- recommend_jobs_for_candidate() targeting the OLD 19-argument signature (no
-- _sort), instead of updating the current 20-argument signature (with _sort)
-- that 20261006093130_recommend_jobs_for_candidate_sort.sql had already
-- introduced the day before. Postgres treats differing argument lists as
-- different functions, so this did not replace anything — it left TWO
-- "recommend_jobs_for_candidate" functions live at once:
--   * 19-arg (no _sort)  — stale, calls the new job_matches_search() helper
--   * 20-arg (with _sort) — the one every real caller uses (job-feed.ts always
--     passes _sort), still has the OLD title-ILIKE-only search matching
--
-- Two concrete problems this caused:
--   1. Any named-argument call omitting _sort is ambiguous and errors with
--      "function recommend_jobs_for_candidate(...) is not unique" (reproduced
--      2026-10-08 against the linked project).
--   2. The smarter "search by intent" matching (job_matches_search: token
--      coverage, department match, related-term families — see that
--      function's own comment) has been dead code since the day it shipped:
--      it is only wired into the 19-arg overload nothing calls.
--
-- This migration removes the stale 19-arg overload only. It does NOT touch
-- job_matches_search() (an independent, still-valid helper) or the live
-- 20-arg function. Porting job_matches_search() into the 20-arg function so
-- the Browse search-by-intent feature actually goes live is a separate,
-- deliberate follow-up — do not fold it into this cleanup migration.

DROP FUNCTION IF EXISTS public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz,
    text, text, text, text, boolean, boolean, boolean
);

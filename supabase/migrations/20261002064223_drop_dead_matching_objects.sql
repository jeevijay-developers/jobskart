-- ============================================================
-- Remove match_scoring_config: a vestigial table from an earlier
-- design that was never read by any function. The live candidate
-- recommendation formula lives in recommendation_settings, consumed
-- by recommend_jobs_for_candidate(); the live recruiter-facing
-- candidate-ranking formula is hardcoded in compute_candidate_match().
-- ============================================================

DROP TABLE IF EXISTS public.match_scoring_config;

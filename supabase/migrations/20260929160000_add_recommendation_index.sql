-- supabase/migrations/20260929160000_add_recommendation_index.sql
--
-- The original version of this migration indexed a table called
-- job_candidate_recommendations, which was never created — the
-- recommendation engine (get_recommended_candidates_for_job in
-- 20260928130001_job_candidate_recommendations.sql) computes match
-- scores on the fly, it never persists them to a table. Replaced
-- with indexes that actually speed up that RPC's query:
--   - applications filters by (job_id, candidate_id) in a NOT EXISTS
--     anti-join to exclude candidates who already applied.
--   - candidate_profiles is filtered by onboarding_completed on
--     every call.

CREATE INDEX IF NOT EXISTS idx_applications_job_candidate
    ON public.applications (job_id, candidate_id);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_onboarded
    ON public.candidate_profiles (user_id)
    WHERE onboarding_completed = true;

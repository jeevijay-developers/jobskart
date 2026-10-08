-- ============================================================
-- job_impressions: server-write-only
-- ============================================================
-- Impressions are now written only by recommend_jobs_routed() (SECURITY DEFINER,
-- owned by the table owner, so it is unaffected by the revoked privilege / dropped
-- policy). Removing the client INSERT path means a candidate can no longer forge
-- scores / variants / positions into their own training data.
--
-- Left intact on purpose: the SELECT grant and both SELECT policies
-- ("Candidates read own impressions", "Platform admins read all impressions").
--
-- job_recommendation_feedback is deliberately NOT touched: JobCard.tsx still
-- inserts saved/applied feedback from the browser, so it stays client-insertable
-- (own rows only, enforced by its existing RLS policy).
--
-- Re-runnable: DROP POLICY IF EXISTS; REVOKE is idempotent.

DROP POLICY IF EXISTS "Candidates insert own impressions" ON public.job_impressions;

-- Supabase's default privileges also hand anon/authenticated UPDATE, DELETE,
-- TRUNCATE (TRUNCATE bypasses RLS entirely), REFERENCES and TRIGGER on new tables.
-- Strip everything except authenticated SELECT so the table is truly read-only
-- to clients. (Only job_impressions; job_recommendation_feedback is unchanged.)
REVOKE ALL ON public.job_impressions FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.job_impressions FROM authenticated;
GRANT SELECT ON public.job_impressions TO authenticated;

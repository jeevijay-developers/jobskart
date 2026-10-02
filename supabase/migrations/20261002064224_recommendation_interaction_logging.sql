-- ============================================================
-- Candidate recommendation interaction logging
-- ============================================================
-- Nothing currently records which recommended jobs a candidate actually
-- saw, viewed, saved, dismissed, or applied to, so the recommendation
-- engine can never be measured or tuned against real behavior. These
-- tables start capturing that history now; no scoring logic consumes
-- it yet (that's future work once there's enough volume), but every day
-- without logging is history that can't be recovered later.

CREATE TABLE IF NOT EXISTS public.job_impressions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('recommended', 'browse', 'search')),
    "position" int,
    shown_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_impressions_candidate ON public.job_impressions (candidate_user_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_impressions_job ON public.job_impressions (job_id);

ALTER TABLE public.job_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Candidates insert own impressions" ON public.job_impressions;
CREATE POLICY "Candidates insert own impressions" ON public.job_impressions
    FOR INSERT TO authenticated WITH CHECK (candidate_user_id = auth.uid());

DROP POLICY IF EXISTS "Candidates read own impressions" ON public.job_impressions;
CREATE POLICY "Candidates read own impressions" ON public.job_impressions
    FOR SELECT TO authenticated USING (candidate_user_id = auth.uid());

DROP POLICY IF EXISTS "Platform admins read all impressions" ON public.job_impressions;
CREATE POLICY "Platform admins read all impressions" ON public.job_impressions
    FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT ON public.job_impressions TO authenticated;

CREATE TABLE IF NOT EXISTS public.job_recommendation_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('viewed', 'saved', 'dismissed', 'applied')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_rec_feedback_candidate ON public.job_recommendation_feedback (candidate_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_rec_feedback_job ON public.job_recommendation_feedback (job_id);

ALTER TABLE public.job_recommendation_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Candidates insert own feedback" ON public.job_recommendation_feedback;
CREATE POLICY "Candidates insert own feedback" ON public.job_recommendation_feedback
    FOR INSERT TO authenticated WITH CHECK (candidate_user_id = auth.uid());

DROP POLICY IF EXISTS "Candidates read own feedback" ON public.job_recommendation_feedback;
CREATE POLICY "Candidates read own feedback" ON public.job_recommendation_feedback
    FOR SELECT TO authenticated USING (candidate_user_id = auth.uid());

DROP POLICY IF EXISTS "Platform admins read all feedback" ON public.job_recommendation_feedback;
CREATE POLICY "Platform admins read all feedback" ON public.job_recommendation_feedback
    FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT ON public.job_recommendation_feedback TO authenticated;

-- ============================================================
-- Candidate Onboarding: Resume/LinkedIn Import, Salary Selection,
-- and Smart Education Flow
-- (resume-linkedin-salary-education-onboarding-implementation-plan.md)
--
-- Scope for this migration — the Phase 1+2 MVP the plan recommends,
-- deliberately excluding LinkedIn OAuth, CSV/ZIP export parsing, and
-- malware scanning (all explicitly gated behind product/legal/infra
-- decisions in the plan itself):
--
--   1. candidate_imports — provenance record for a resume or
--      LinkedIn-PDF upload (source, file metadata, parse status).
--   2. candidate_profiles.expected_salary_period /
--      expected_salary_choice_kind — context for the monthly salary
--      chip picker (Feature 4). expected_salary itself is unchanged.
--   3. candidate_profile_tasks / candidate_profile_events — the
--      progressive-profiling task/nudge model for Feature 5 (smart
--      education flow), plus reused for salary-suggestion telemetry.
--   4. Optional provenance columns on candidate_experiences /
--      candidate_education so imported rows can be traced back to
--      the import that created them.
--
-- All new tables are owner-only via RLS, matching the existing
-- candidate_documents/candidate_experiences pattern.
-- ============================================================

-- ── 1. candidate_imports ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.candidate_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('resume', 'linkedin_pdf', 'linkedin_export', 'other')),
  file_path     text,
  file_name     text,
  mime_type     text,
  size_bytes    integer,
  status        text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'failed')),
  error_code    text,
  parser_version text NOT NULL DEFAULT 'v1',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_imports_candidate ON public.candidate_imports(candidate_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_imports TO authenticated;
GRANT ALL ON public.candidate_imports TO service_role;
ALTER TABLE public.candidate_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own imports" ON public.candidate_imports FOR ALL
  USING (auth.uid() = candidate_id) WITH CHECK (auth.uid() = candidate_id);

-- ── 2. Salary selection context columns ──────────────────────
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS expected_salary_period text NOT NULL DEFAULT 'monthly'
    CHECK (expected_salary_period = 'monthly'),
  ADD COLUMN IF NOT EXISTS expected_salary_choice_kind text
    CHECK (expected_salary_choice_kind IN ('chip', 'custom', 'flexible', 'undisclosed'));

-- ── 3. Progressive-profiling task/event model ────────────────
CREATE TABLE IF NOT EXISTS public.candidate_profile_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_key      text NOT NULL CHECK (task_key IN ('education_highest', 'education_details')),
  status        text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'dismissed', 'completed', 'snoozed')),
  snoozed_until timestamptz,
  last_shown_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, task_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_profile_tasks TO authenticated;
GRANT ALL ON public.candidate_profile_tasks TO service_role;
ALTER TABLE public.candidate_profile_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile tasks" ON public.candidate_profile_tasks FOR ALL
  USING (auth.uid() = candidate_id) WITH CHECK (auth.uid() = candidate_id);
DROP TRIGGER IF EXISTS trg_candidate_profile_tasks_updated ON public.candidate_profile_tasks;
CREATE TRIGGER trg_candidate_profile_tasks_updated BEFORE UPDATE ON public.candidate_profile_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.candidate_profile_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key     text NOT NULL,
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_profile_events_candidate ON public.candidate_profile_events(candidate_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.candidate_profile_events TO authenticated;
GRANT ALL ON public.candidate_profile_events TO service_role;
ALTER TABLE public.candidate_profile_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile events" ON public.candidate_profile_events FOR ALL
  USING (auth.uid() = candidate_id) WITH CHECK (auth.uid() = candidate_id);

-- ── 4. Optional provenance on experiences/education ──────────
ALTER TABLE public.candidate_experiences
  ADD COLUMN IF NOT EXISTS source_import_id uuid REFERENCES public.candidate_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind text;
ALTER TABLE public.candidate_education
  ADD COLUMN IF NOT EXISTS source_import_id uuid REFERENCES public.candidate_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kind text;

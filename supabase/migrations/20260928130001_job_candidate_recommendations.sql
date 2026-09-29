-- ============================================================
-- Phase 2: Job Responses & Recommended Profile System
-- ============================================================
--
-- Changes:
--   1. job_candidate_dismissals table — employer dismisses a
--      recommended candidate for a specific job.
--   2. get_recommended_candidates_for_job() RPC — returns ranked,
--      non-applied, non-dismissed candidates from the candidate DB,
--      computed via compute_candidate_match(), masked if not unlocked.
--   3. invite_candidate_to_apply() RPC — sends an in-app notification
--      to a candidate inviting them to apply to a specific job.
-- ============================================================

-- ── 1. Dismissal table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_candidate_dismissals (
  job_id            uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, candidate_user_id)
);

CREATE INDEX IF NOT EXISTS idx_jcd_job ON public.job_candidate_dismissals(job_id);

GRANT SELECT, INSERT, DELETE ON public.job_candidate_dismissals TO authenticated;
GRANT ALL ON public.job_candidate_dismissals TO service_role;
ALTER TABLE public.job_candidate_dismissals ENABLE ROW LEVEL SECURITY;

-- Members of the job's company can manage dismissals for their jobs
CREATE POLICY "members manage dismissals" ON public.job_candidate_dismissals
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND public.has_company_membership(auth.uid(), j.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND public.has_company_membership(auth.uid(), j.company_id)
    )
  );

-- ── 2. get_recommended_candidates_for_job() ─────────────────
--
-- Returns ranked non-applied, non-dismissed candidates for a job.
-- Masks name/contact for unlocked candidates.
-- Sorted by match_score DESC (highest relevancy first).
--
CREATE OR REPLACE FUNCTION public.get_recommended_candidates_for_job(
  _job_id     uuid,
  _limit      int  DEFAULT 30,
  _offset     int  DEFAULT 0,
  _min_score  int  DEFAULT 40,
  _filter     text DEFAULT NULL   -- 'hot' | 'nearby' | 'active' | NULL (all)
)
RETURNS TABLE (
  user_id             uuid,
  profile_slug        text,
  headline            text,
  last_role           text,
  years_experience    int,
  skills              text[],
  preferred_cities    text[],
  preferred_work_mode text,
  city                text,
  match_score         int,
  match_breakdown     jsonb,
  tags                text[],
  is_unlocked         boolean,
  -- Masked unless unlocked:
  full_name           text,   -- "A••• K•••" until unlocked
  avatar_url          text,
  total_count         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
BEGIN
  -- Resolve company_id and verify the job is active
  SELECT j.company_id INTO _company_id
    FROM public.jobs j
    WHERE j.id = _job_id AND j.status = 'active';

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'db_recommendations_viewed',
    'Viewed AI recommended candidates',
    NULL, '/employer/jobs/' || _job_id::text || '/applicants',
    jsonb_build_object('job_id', _job_id, 'filter', _filter)
  );

  RETURN QUERY
  WITH scored AS (
    SELECT
      cp.user_id,
      cp.profile_slug,
      cp.headline,
      cp.last_role,
      cp.years_experience,
      cp.skills,
      cp.preferred_cities,
      cp.preferred_work_mode,
      p.full_name   AS raw_full_name,
      p.avatar_url  AS raw_avatar_url,
      p.city,
      public.compute_candidate_match(cp.user_id, _job_id, true) AS result
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.user_id
    WHERE
      cp.onboarding_completed = true
      -- Exclude candidates who already applied to this job
      AND NOT EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.job_id = _job_id AND a.candidate_id = cp.user_id
      )
      -- Exclude dismissed candidates
      AND NOT EXISTS (
        SELECT 1 FROM public.job_candidate_dismissals d
        WHERE d.job_id = _job_id AND d.candidate_user_id = cp.user_id
      )
  ),
  filtered AS (
    SELECT
      s.*,
      (s.result->>'score')::int                                   AS score,
      s.result->'breakdown'                                        AS breakdown,
      ARRAY(SELECT jsonb_array_elements_text(s.result->'tags'))   AS tag_arr,
      EXISTS(
        SELECT 1 FROM public.candidate_unlocks cu
        WHERE cu.company_id = _company_id AND cu.candidate_user_id = s.user_id
      )                                                            AS unlocked
    FROM scored s
    WHERE (s.result->>'score')::int >= _min_score
      AND (
        _filter IS NULL
        OR (_filter = 'hot'    AND s.result->'tags' ? 'Hot Profile')
        OR (_filter = 'nearby' AND s.result->'tags' ? 'Nearby Candidate')
        OR (_filter = 'active' AND s.result->'tags' ? 'Recently Active')
      )
  )
  SELECT
    f.user_id,
    f.profile_slug,
    f.headline,
    f.last_role,
    f.years_experience,
    f.skills,
    f.preferred_cities,
    f.preferred_work_mode,
    f.city,
    f.score,
    f.breakdown,
    f.tag_arr,
    f.unlocked,
    -- Mask name if not unlocked
    CASE WHEN f.unlocked THEN f.raw_full_name
         ELSE (
           SELECT string_agg(
             CASE WHEN length(part) > 0 THEN substring(part, 1, 1) || repeat('•', LEAST(3, length(part) - 1)) ELSE '' END,
             ' '
           )
           FROM unnest(string_to_array(COALESCE(f.raw_full_name, 'Candidate'), ' ')) AS part
         )
    END,
    -- Mask avatar if not unlocked
    CASE WHEN f.unlocked THEN f.raw_avatar_url ELSE NULL END,
    count(*) OVER ()
  FROM filtered f
  ORDER BY f.score DESC, f.unlocked DESC
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_recommended_candidates_for_job(uuid, int, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recommended_candidates_for_job(uuid, int, int, int, text) TO authenticated;

-- ── 3. invite_candidate_to_apply() ──────────────────────────
CREATE OR REPLACE FUNCTION public.invite_candidate_to_apply(
  _job_id              uuid,
  _candidate_user_id   uuid,
  _message             text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id   uuid;
  _company_name text;
  _job_title    text;
BEGIN
  -- Validate job and company membership
  SELECT j.company_id, j.title, c.name
    INTO _company_id, _job_title, _company_name
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    WHERE j.id = _job_id AND j.status = 'active';

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  -- Send in-app notification to candidate
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _candidate_user_id,
    'candidate.invited_to_apply',
    _company_name || ' invited you to apply',
    COALESCE(
      _message,
      _company_name || ' thinks you''re a great fit for "' || _job_title || '". Apply now!'
    ),
    '/jobs/' || _job_id::text
  );

  -- Log to activity feed
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'candidate.invited_to_apply',
    'Candidate invited to apply',
    'Invited to "' || _job_title || '"',
    '/employer/jobs/' || _job_id::text || '/applicants',
    jsonb_build_object('candidate_user_id', _candidate_user_id, 'job_id', _job_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_candidate_to_apply(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_candidate_to_apply(uuid, uuid, text) TO authenticated;

-- ── 4. dismiss_recommended_candidate() — convenience RPC ────
CREATE OR REPLACE FUNCTION public.dismiss_recommended_candidate(
  _job_id            uuid,
  _candidate_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _company_id uuid;
BEGIN
  SELECT j.company_id INTO _company_id FROM public.jobs j WHERE j.id = _job_id;
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  INSERT INTO public.job_candidate_dismissals (job_id, candidate_user_id, dismissed_by)
    VALUES (_job_id, _candidate_user_id, auth.uid())
    ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_recommended_candidate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_recommended_candidate(uuid, uuid) TO authenticated;

-- Fix the employer Candidate Database search (/employer/database):
--
-- Root cause of the "Search failed" 400 on every page load: the page queried
-- candidate_profiles from the browser with a PostgREST embed hint
-- `profiles!candidate_profiles_user_id_fkey`, but that constraint is
-- candidate_profiles.user_id -> auth.users(id), not -> public.profiles(id).
-- There has never been a FK between candidate_profiles and profiles, so
-- PostgREST cannot resolve the embed and returns PGRST200 (400) on every
-- call, including the automatic one that fires on mount.
--
-- Even with a valid embed, candidate_profiles RLS only allows a candidate to
-- see their own row (or, since the applicant-data-access fix, an employer to
-- see rows for candidates who applied to their jobs) — never the full
-- candidate pool. So a client-side query can never power a real "browse all
-- candidates" search regardless of the embed hint.
--
-- Fix: move the search server-side into a SECURITY DEFINER RPC, per the
-- "money/access logic lives in Postgres" + "locked candidate data must never
-- reach the frontend" ground rules. It checks membership + the existing
-- job-post gate, and returns only non-locked columns (no mobile/email —
-- those still only ever come back via unlock_candidate()).

CREATE OR REPLACE FUNCTION public.search_candidates_for_company(
  _company_id uuid,
  _query text DEFAULT NULL,
  _cities text[] DEFAULT NULL,
  _min_experience int DEFAULT NULL
) RETURNS TABLE (
  user_id uuid,
  profile_slug text,
  headline text,
  last_role text,
  years_experience int,
  skills text[],
  preferred_cities text[],
  preferred_work_mode text,
  full_name text,
  avatar_url text,
  city text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _term text := NULLIF(btrim(_query), '');
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.company_id = _company_id
      AND j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'no_active_job';
  END IF;

  RETURN QUERY
  SELECT
    cp.user_id, cp.profile_slug, cp.headline, cp.last_role, cp.years_experience,
    cp.skills, cp.preferred_cities, cp.preferred_work_mode,
    p.full_name, p.avatar_url, p.city
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.onboarding_completed = true
    AND (_min_experience IS NULL OR cp.years_experience >= _min_experience)
    AND (
      _cities IS NULL OR cardinality(_cities) = 0
      OR cp.preferred_cities && _cities
      OR p.city = ANY(_cities)
    )
    AND (
      _term IS NULL
      OR cp.headline ILIKE ('%' || _term || '%')
      OR cp.last_role ILIKE ('%' || _term || '%')
      OR EXISTS (SELECT 1 FROM unnest(cp.skills) s WHERE s ILIKE ('%' || _term || '%'))
    )
  ORDER BY cp.profile_strength DESC, cp.years_experience DESC
  LIMIT 40;
END;
$$;

REVOKE ALL ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int) TO authenticated;

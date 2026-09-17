-- Add pagination to search_candidates_for_company(): the employer Candidate
-- Database page now paginates its results using the same shared pagination
-- pattern as the rest of the app, so the RPC needs an offset/limit and a
-- total count. Return type changes (adds total_count), so the old function
-- signature is dropped and recreated rather than CREATE OR REPLACE'd.

DROP FUNCTION IF EXISTS public.search_candidates_for_company(uuid, text, text[], int);

CREATE OR REPLACE FUNCTION public.search_candidates_for_company(
  _company_id uuid,
  _query text DEFAULT NULL,
  _cities text[] DEFAULT NULL,
  _min_experience int DEFAULT NULL,
  _limit int DEFAULT 40,
  _offset int DEFAULT 0
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
  city text,
  total_count bigint
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
    p.full_name, p.avatar_url, p.city,
    count(*) OVER() AS total_count
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
  LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_candidates_for_company(uuid, text, text[], int, int, int) TO authenticated;

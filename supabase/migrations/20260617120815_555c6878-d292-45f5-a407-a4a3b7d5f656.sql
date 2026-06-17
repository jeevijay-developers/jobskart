
CREATE OR REPLACE FUNCTION public.get_public_candidate(_slug text)
RETURNS TABLE (
  user_id uuid, profile_slug text, full_name text, city text, avatar_url text,
  headline text, last_role text, skills text[], years_experience integer,
  experience_status text, bio text, preferred_job_types text[],
  preferred_cities text[], kyc_status text, profile_strength integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cp.user_id, cp.profile_slug, p.full_name, p.city, p.avatar_url,
         cp.headline, cp.last_role, cp.skills, cp.years_experience,
         cp.experience_status::text, cp.bio, cp.preferred_job_types,
         cp.preferred_cities, cp.kyc_status, cp.profile_strength
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.profile_slug = _slug
    AND (cp.onboarding_completed = true OR cp.profile_strength >= 50)
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_candidate(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_profile_views(_slug text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.candidate_profiles SET profile_views = profile_views + 1 WHERE profile_slug = _slug;
$$;
GRANT EXECUTE ON FUNCTION public.increment_profile_views(text) TO anon, authenticated;

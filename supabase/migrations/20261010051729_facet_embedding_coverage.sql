-- Extends recommendation_embedding_coverage() (embedding_freshness migration) with 4 more rows
-- for the skills/role facets: same shape, same admin-only guard, same "stale" definition.
-- Note: n_missing for *_skills / *_role also counts rows whose skills/role text is legitimately
-- empty (nothing to embed), so those rows can never reach 100% current.
CREATE OR REPLACE FUNCTION public.recommendation_embedding_coverage(_current_model text DEFAULT NULL)
RETURNS TABLE (entity text, n_total bigint, n_embedded bigint, n_missing bigint, n_stale bigint, pct_current numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;

    RETURN QUERY
    SELECT 'jobs'::text, count(*)::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NOT NULL AND (j.description_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND j.description_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE j.description_embedding IS NOT NULL AND j.description_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR j.description_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.jobs j WHERE j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now())
    UNION ALL
    SELECT 'jobs_skills'::text, count(*)::bigint,
           (count(*) FILTER (WHERE j.skills_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE j.skills_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE j.skills_embedding IS NOT NULL AND (j.skills_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND j.skills_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE j.skills_embedding IS NOT NULL AND j.skills_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR j.skills_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.jobs j WHERE j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now())
    UNION ALL
    SELECT 'jobs_role'::text, count(*)::bigint,
           (count(*) FILTER (WHERE j.role_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE j.role_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE j.role_embedding IS NOT NULL AND (j.role_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND j.role_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE j.role_embedding IS NOT NULL AND j.role_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR j.role_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.jobs j WHERE j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now())
    UNION ALL
    SELECT 'candidates'::text, count(*)::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL AND (cp.profile_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND cp.profile_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL AND cp.profile_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR cp.profile_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.candidate_profiles cp WHERE cp.onboarding_completed = true
    UNION ALL
    SELECT 'candidates_skills'::text, count(*)::bigint,
           (count(*) FILTER (WHERE cp.skills_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE cp.skills_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE cp.skills_embedding IS NOT NULL AND (cp.skills_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND cp.skills_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE cp.skills_embedding IS NOT NULL AND cp.skills_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR cp.skills_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.candidate_profiles cp WHERE cp.onboarding_completed = true
    UNION ALL
    SELECT 'candidates_role'::text, count(*)::bigint,
           (count(*) FILTER (WHERE cp.role_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE cp.role_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE cp.role_embedding IS NOT NULL AND (cp.role_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND cp.role_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE cp.role_embedding IS NOT NULL AND cp.role_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR cp.role_embedding_model = _current_model)) / NULLIF(count(*), 0), 1)
    FROM public.candidate_profiles cp WHERE cp.onboarding_completed = true;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_embedding_coverage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_embedding_coverage(text) TO authenticated;

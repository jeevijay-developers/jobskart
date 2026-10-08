-- ============================================================
-- Embedding freshness: hash + model tracking, auto-invalidation, coverage
-- ============================================================
-- Why: embed() re-ran on every save even for unchanged text; failures were
-- swallowed and never retried; and vectors from different models (Gemini vs
-- OpenAI, chosen from env at call time) could be mixed in one column, which
-- makes cosine similarity meaningless. Additive and re-runnable.

-- ── 1. Columns ──────────────────────────────────────────────
ALTER TABLE public.candidate_profiles
    ADD COLUMN IF NOT EXISTS profile_embedding_hash text,
    ADD COLUMN IF NOT EXISTS profile_embedding_model text,
    ADD COLUMN IF NOT EXISTS profile_embedded_at timestamptz;

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS description_embedding_hash text,
    ADD COLUMN IF NOT EXISTS description_embedding_model text,
    ADD COLUMN IF NOT EXISTS description_embedded_at timestamptz;

-- ── 2. Auto-invalidation: content change => hash cleared ────
-- The embed writers only touch embedding columns, so they never fire these.
CREATE OR REPLACE FUNCTION public.tg_invalidate_profile_embedding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF (NEW.headline, NEW.bio, NEW.skills, NEW.years_experience, NEW.last_role)
       IS DISTINCT FROM
       (OLD.headline, OLD.bio, OLD.skills, OLD.years_experience, OLD.last_role) THEN
        NEW.profile_embedding_hash := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_profile_embedding ON public.candidate_profiles;
CREATE TRIGGER invalidate_profile_embedding
    BEFORE UPDATE ON public.candidate_profiles
    FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_profile_embedding();

CREATE OR REPLACE FUNCTION public.tg_invalidate_profile_embedding_from_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF (NEW.full_name, NEW.city) IS DISTINCT FROM (OLD.full_name, OLD.city) THEN
        UPDATE public.candidate_profiles
        SET profile_embedding_hash = NULL
        WHERE user_id = NEW.id AND profile_embedding_hash IS NOT NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_profile_embedding_from_profiles ON public.profiles;
CREATE TRIGGER invalidate_profile_embedding_from_profiles
    AFTER UPDATE OF full_name, city ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_profile_embedding_from_profiles();

CREATE OR REPLACE FUNCTION public.tg_invalidate_job_embedding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF (NEW.title, NEW.category, NEW.skills, NEW.city, NEW.description)
       IS DISTINCT FROM
       (OLD.title, OLD.category, OLD.skills, OLD.city, OLD.description) THEN
        NEW.description_embedding_hash := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_job_embedding ON public.jobs;
CREATE TRIGGER invalidate_job_embedding
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_job_embedding();

-- ── 3. Hash/model-aware writers (old signatures replaced) ───
DROP FUNCTION IF EXISTS public.update_candidate_profile_embedding(vector);
CREATE OR REPLACE FUNCTION public.update_candidate_profile_embedding(
    _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    UPDATE public.candidate_profiles
    SET profile_embedding = _embedding,
        profile_embedding_hash = _input_hash,
        profile_embedding_model = _model,
        profile_embedded_at = now()
    WHERE user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.update_candidate_profile_embedding(vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_candidate_profile_embedding(vector, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.update_job_description_embedding(uuid, vector);
CREATE OR REPLACE FUNCTION public.update_job_description_embedding(
    _job_id uuid, _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    _company_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT company_id INTO _company_id FROM public.jobs WHERE id = _job_id;
    IF _company_id IS NULL OR NOT public.has_company_membership(auth.uid(), _company_id) THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;

    UPDATE public.jobs
    SET description_embedding = _embedding,
        description_embedding_hash = _input_hash,
        description_embedding_model = _model,
        description_embedded_at = now()
    WHERE id = _job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_job_description_embedding(uuid, vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_job_description_embedding(uuid, vector, text, text) TO authenticated;

-- ── 4. "Is the stored embedding already current?" ───────────
CREATE OR REPLACE FUNCTION public.candidate_embedding_is_current(_hash text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.candidate_profiles cp
        WHERE cp.user_id = auth.uid()
          AND cp.profile_embedding IS NOT NULL
          AND cp.profile_embedding_hash IS NOT NULL
          AND cp.profile_embedding_hash = _hash
    )
$$;

REVOKE ALL ON FUNCTION public.candidate_embedding_is_current(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_embedding_is_current(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.job_embedding_is_current(_job_id uuid, _hash text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id
          AND public.has_company_membership(auth.uid(), j.company_id)
          AND j.description_embedding IS NOT NULL
          AND j.description_embedding_hash IS NOT NULL
          AND j.description_embedding_hash = _hash
    )
$$;

REVOKE ALL ON FUNCTION public.job_embedding_is_current(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_embedding_is_current(uuid, text) TO authenticated;

-- ── 5. Coverage report (platform admins only) ───────────────
-- "stale" = embedded but hash cleared (content changed / legacy row) or, when
-- _current_model is given, embedded with a different model.
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
    SELECT 'jobs'::text,
           count(*)::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE j.description_embedding IS NOT NULL AND (
                j.description_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND j.description_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE j.description_embedding IS NOT NULL
                AND j.description_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR j.description_embedding_model = _current_model))
                / NULLIF(count(*), 0), 1)
    FROM public.jobs j
    WHERE j.status = 'active' AND (j.expires_at IS NULL OR j.expires_at > now())
    UNION ALL
    SELECT 'candidates'::text,
           count(*)::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL))::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NULL))::bigint,
           (count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL AND (
                cp.profile_embedding_hash IS NULL
                OR (_current_model IS NOT NULL AND cp.profile_embedding_model IS DISTINCT FROM _current_model))))::bigint,
           round(100.0 * count(*) FILTER (WHERE cp.profile_embedding IS NOT NULL
                AND cp.profile_embedding_hash IS NOT NULL
                AND (_current_model IS NULL OR cp.profile_embedding_model = _current_model))
                / NULLIF(count(*), 0), 1)
    FROM public.candidate_profiles cp
    WHERE cp.onboarding_completed = true;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_embedding_coverage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_embedding_coverage(text) TO authenticated;

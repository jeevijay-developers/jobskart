-- ============================================================
-- Canonical Skills & Candidate Preferences for Recommendations
-- ============================================================
-- Phase 1 of Flow 3: Candidate-specific recommendation system
-- Provides normalized skills taxonomy and candidate preference storage

-- ── 1. Canonical Skills Taxonomy ───────────────────────────
CREATE TABLE IF NOT EXISTS public.canonical_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    aliases text[] NOT NULL DEFAULT '{}',
    category text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_skills_category ON public.canonical_skills (category);
CREATE INDEX IF NOT EXISTS idx_canonical_skills_aliases ON public.canonical_skills USING gin (aliases);

ALTER TABLE public.canonical_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active canonical skills" ON public.canonical_skills
    FOR SELECT TO authenticated USING (is_active);
GRANT SELECT ON public.canonical_skills TO authenticated;
GRANT ALL ON public.canonical_skills TO service_role;

-- ── 2. Candidate Preferences (normalized, fresh) ───────────
CREATE TABLE IF NOT EXISTS public.candidate_preferences (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    skill_ids uuid[] NOT NULL DEFAULT '{}',
    city_ids uuid[] NOT NULL DEFAULT '{}',
    min_salary_monthly int,
    max_salary_monthly int,
    job_types text[] NOT NULL DEFAULT '{}',
    work_modes text[] NOT NULL DEFAULT '{}',
    min_experience_years int,
    max_experience_years int,
    source text NOT NULL DEFAULT 'explicit',
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.candidate_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates manage their own preferences" ON public.candidate_preferences
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_preferences TO authenticated;
GRANT ALL ON public.candidate_preferences TO service_role;

CREATE TRIGGER candidate_preferences_set_updated_at
    BEFORE UPDATE ON public.candidate_preferences
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── 3. Cities table (reference data for location matching) ──
CREATE TABLE IF NOT EXISTS public.cities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    state text NOT NULL,
    country text NOT NULL DEFAULT 'India',
    lat double precision,
    lon double precision,
    is_metro boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_name_state ON public.cities (name, state) WHERE is_active;

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active cities" ON public.cities
    FOR SELECT TO authenticated USING (is_active);
GRANT SELECT ON public.cities TO authenticated;
GRANT ALL ON public.cities TO service_role;

-- ── 4. Seed major Indian cities (MUST BEFORE backfill) ──────
-- Ensure is_metro and slug columns exist (idempotent for partial migration runs)
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS is_metro boolean NOT NULL DEFAULT false;
ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS slug text;
-- Generate slug from name if missing (idempotent)
UPDATE public.cities SET slug = lower(regexp_replace(name, '\s+', '-', 'g')) WHERE slug IS NULL;

INSERT INTO public.cities (name, state, is_metro, slug) VALUES
    ('Mumbai', 'Maharashtra', true, 'mumbai'),
    ('Delhi', 'Delhi', true, 'delhi'),
    ('Bangalore', 'Karnataka', true, 'bangalore'),
    ('Hyderabad', 'Telangana', true, 'hyderabad'),
    ('Chennai', 'Tamil Nadu', true, 'chennai'),
    ('Kolkata', 'West Bengal', true, 'kolkata'),
    ('Pune', 'Maharashtra', true, 'pune'),
    ('Ahmedabad', 'Gujarat', true, 'ahmedabad'),
    ('Jaipur', 'Rajasthan', true, 'jaipur'),
    ('Surat', 'Gujarat', true, 'surat'),
    ('Lucknow', 'Uttar Pradesh', false, 'lucknow'),
    ('Kanpur', 'Uttar Pradesh', false, 'kanpur'),
    ('Nagpur', 'Maharashtra', false, 'nagpur'),
    ('Indore', 'Madhya Pradesh', false, 'indore'),
    ('Thane', 'Maharashtra', false, 'thane'),
    ('Bhopal', 'Madhya Pradesh', false, 'bhopal'),
    ('Visakhapatnam', 'Andhra Pradesh', false, 'visakhapatnam'),
    ('Pimpri-Chinchwad', 'Maharashtra', false, 'pimpri-chinchwad'),
    ('Patna', 'Bihar', false, 'patna'),
    ('Vadodara', 'Gujarat', false, 'vadodara')
ON CONFLICT (name, state) WHERE is_active DO NOTHING;

-- ── 5. Helper: Normalize candidate skills to canonical skill IDs ──
CREATE OR REPLACE FUNCTION public.normalize_candidate_skills(_skills text[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    _result uuid[] := '{}';
    _skill text;
    _canon_id uuid;
BEGIN
    IF _skills IS NULL THEN RETURN '{}'; END IF;
    
    FOREACH _skill IN ARRAY _skills LOOP
        SELECT id INTO _canon_id FROM public.canonical_skills
        WHERE name ILIKE _skill AND is_active
        LIMIT 1;
        
        IF _canon_id IS NULL THEN
            SELECT id INTO _canon_id FROM public.canonical_skills
            WHERE _skill = ANY(aliases) AND is_active
            LIMIT 1;
        END IF;
        
        IF _canon_id IS NULL THEN
            INSERT INTO public.canonical_skills (name, aliases, category)
            VALUES (_skill, ARRAY[lower(_skill)], 'Uncategorized')
            ON CONFLICT (name) DO UPDATE SET updated_at = now()
            RETURNING id INTO _canon_id;
        END IF;
        
        _result := _result || _canon_id;
    END LOOP;
    
    RETURN (SELECT array_agg(DISTINCT x) FROM unnest(_result) AS x);
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_candidate_skills(text[]) TO authenticated, service_role;

-- ── 5. Backfill: Seed canonical_skills from existing jobs & candidate_profiles ──
DO $$
DECLARE
    _skill text;
    _all_skills text[] := '{}';
BEGIN
    SELECT array_agg(DISTINCT s) INTO _all_skills
    FROM public.jobs j, unnest(j.skills) s
    WHERE j.status = 'active' AND j.skills IS NOT NULL;
    
    SELECT array_agg(DISTINCT s) INTO _all_skills
    FROM public.candidate_profiles cp, unnest(cp.skills) s
    WHERE cp.skills IS NOT NULL AND _all_skills IS NOT NULL;
    
    IF _all_skills IS NOT NULL THEN
        FOREACH _skill IN ARRAY _all_skills LOOP
            INSERT INTO public.canonical_skills (name, aliases, category)
            VALUES (_skill, ARRAY[lower(_skill)], 'Uncategorized')
            ON CONFLICT (name) DO NOTHING;
        END LOOP;
    END IF;
END $$;

-- ── 7. Backfill: Create candidate_preferences from existing candidate_profiles ──
INSERT INTO public.candidate_preferences (user_id, skill_ids, city_ids, min_salary_monthly, max_salary_monthly, job_types, work_modes, source)
SELECT
    cp.user_id,
    public.normalize_candidate_skills(cp.skills) as skill_ids,
    CASE 
        WHEN p.city IS NOT NULL THEN
            COALESCE((SELECT array_agg(id) FROM public.cities WHERE name ILIKE p.city AND is_active), '{}'::uuid[])
        ELSE '{}'::uuid[]
    END as city_ids,
    NULL, NULL,
    cp.preferred_job_types,
    '{}',
    'inferred_from_resume'
FROM public.candidate_profiles cp
JOIN public.profiles p ON p.id = cp.user_id
WHERE cp.onboarding_completed = true
ON CONFLICT (user_id) DO NOTHING;
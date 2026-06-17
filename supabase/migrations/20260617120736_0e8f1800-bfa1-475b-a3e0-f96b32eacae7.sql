
-- Extend candidate_profiles
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female','other','prefer_not')),
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS current_salary integer,
  ADD COLUMN IF NOT EXISTS expected_salary integer,
  ADD COLUMN IF NOT EXISTS notice_period_days integer,
  ADD COLUMN IF NOT EXISTS preferred_cities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_work_mode text,
  ADD COLUMN IF NOT EXISTS assets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS government_id_type text,
  ADD COLUMN IF NOT EXISTS government_id_last4 text,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS resume_url text,
  ADD COLUMN IF NOT EXISTS resume_name text,
  ADD COLUMN IF NOT EXISTS profile_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS profile_views integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- profiles avatar
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Experience
CREATE TABLE IF NOT EXISTS public.candidate_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_title text NOT NULL,
  company_name text NOT NULL,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_experiences TO authenticated;
GRANT ALL ON public.candidate_experiences TO service_role;
ALTER TABLE public.candidate_experiences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own experiences" ON public.candidate_experiences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_cexp_updated BEFORE UPDATE ON public.candidate_experiences FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Education
CREATE TABLE IF NOT EXISTS public.candidate_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level text NOT NULL,
  board_or_university text,
  institute text,
  year_of_passing integer,
  marks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_education TO authenticated;
GRANT ALL ON public.candidate_education TO service_role;
ALTER TABLE public.candidate_education ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own education" ON public.candidate_education FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_cedu_updated BEFORE UPDATE ON public.candidate_education FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Languages
CREATE TABLE IF NOT EXISTS public.candidate_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language text NOT NULL,
  proficiency text NOT NULL CHECK (proficiency IN ('basic','conversational','fluent','native')),
  can_read boolean NOT NULL DEFAULT true,
  can_write boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, language)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_languages TO authenticated;
GRANT ALL ON public.candidate_languages TO service_role;
ALTER TABLE public.candidate_languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own languages" ON public.candidate_languages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Documents
CREATE TABLE IF NOT EXISTS public.candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('resume','id_proof','certificate','other')),
  file_path text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_documents TO authenticated;
GRANT ALL ON public.candidate_documents TO service_role;
ALTER TABLE public.candidate_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own documents" ON public.candidate_documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Backfill profile_slug
UPDATE public.candidate_profiles
SET profile_slug = 'u-' || substr(user_id::text, 1, 8)
WHERE profile_slug IS NULL;

-- Public candidate view (safe columns only)
CREATE OR REPLACE VIEW public.public_candidate_view AS
SELECT
  cp.user_id,
  cp.profile_slug,
  cp.headline,
  cp.last_role,
  cp.skills,
  cp.years_experience,
  cp.experience_status,
  cp.bio,
  cp.preferred_job_types,
  cp.preferred_cities,
  cp.kyc_status,
  cp.profile_strength,
  p.full_name,
  p.city,
  p.avatar_url
FROM public.candidate_profiles cp
JOIN public.profiles p ON p.id = cp.user_id
WHERE cp.onboarding_completed = true OR cp.profile_strength >= 50;

GRANT SELECT ON public.public_candidate_view TO anon, authenticated;

-- Storage RLS for candidate-docs bucket (bucket created separately via tool)
CREATE POLICY "candidate-docs read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'candidate-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "candidate-docs insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'candidate-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "candidate-docs update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'candidate-docs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "candidate-docs delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'candidate-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Avatars bucket policies (public bucket created separately)
CREATE POLICY "avatars public read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatars delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

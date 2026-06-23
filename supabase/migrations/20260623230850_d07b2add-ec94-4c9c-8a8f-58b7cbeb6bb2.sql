
-- 1. Extend candidate_profiles
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS highest_qualification text,
  ADD COLUMN IF NOT EXISTS interested_roles text[] NOT NULL DEFAULT '{}';

-- 2. job_titles_master
CREATE TABLE IF NOT EXISTS public.job_titles_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL UNIQUE,
  is_custom boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_titles_master TO anon, authenticated;
GRANT INSERT ON public.job_titles_master TO authenticated;
GRANT ALL ON public.job_titles_master TO service_role;
ALTER TABLE public.job_titles_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_titles read" ON public.job_titles_master FOR SELECT USING (is_active);
CREATE POLICY "job_titles insert custom" ON public.job_titles_master FOR INSERT TO authenticated WITH CHECK (is_custom = true);
CREATE POLICY "job_titles admin manage" ON public.job_titles_master FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_job_titles_updated BEFORE UPDATE ON public.job_titles_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. candidate_assets_master
CREATE TABLE IF NOT EXISTS public.candidate_assets_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general', -- 'field' | 'desk' | 'general'
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.candidate_assets_master TO anon, authenticated;
GRANT ALL ON public.candidate_assets_master TO service_role;
ALTER TABLE public.candidate_assets_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets read" ON public.candidate_assets_master FOR SELECT USING (is_active);
CREATE POLICY "assets admin manage" ON public.candidate_assets_master FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON public.candidate_assets_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. languages_master
CREATE TABLE IF NOT EXISTS public.languages_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.languages_master TO anon, authenticated;
GRANT ALL ON public.languages_master TO service_role;
ALTER TABLE public.languages_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "languages read" ON public.languages_master FOR SELECT USING (is_active);
CREATE POLICY "languages admin manage" ON public.languages_master FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_languages_updated BEFORE UPDATE ON public.languages_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. candidate_nudges
CREATE TABLE IF NOT EXISTS public.candidate_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL, -- 'profile_completion' | 'verification_awareness' | 'digilocker'
  last_shown_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_nudges TO authenticated;
GRANT ALL ON public.candidate_nudges TO service_role;
ALTER TABLE public.candidate_nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nudges own" ON public.candidate_nudges FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. Seed job titles
INSERT INTO public.job_titles_master (title) VALUES
  ('Sales Executive'),('Telecaller'),('Customer Support Executive'),('Delivery Executive'),
  ('Field Sales Officer'),('Cashier'),('Accountant'),('Data Entry Operator'),
  ('Receptionist'),('Office Assistant'),('Driver'),('Security Guard'),
  ('Warehouse Associate'),('Store Manager'),('Retail Sales Associate'),('Beautician'),
  ('Electrician'),('Plumber'),('Mechanic'),('Carpenter'),('Cook'),('Housekeeper'),
  ('Software Engineer'),('Frontend Developer'),('Backend Developer'),('Full Stack Developer'),
  ('Mobile App Developer'),('QA Engineer'),('DevOps Engineer'),('Data Analyst'),
  ('Data Scientist'),('Product Manager'),('Project Manager'),('UI/UX Designer'),
  ('Graphic Designer'),('Content Writer'),('Digital Marketing Executive'),('SEO Executive'),
  ('Social Media Manager'),('HR Executive'),('HR Manager'),('Recruiter'),('Operations Manager'),
  ('Business Development Executive'),('Relationship Manager'),('Branch Manager'),
  ('Nurse'),('Pharmacist'),('Lab Technician'),('Teacher'),('Tutor')
ON CONFLICT (title) DO NOTHING;

-- 7. Seed assets
INSERT INTO public.candidate_assets_master (slug, label, category, sort_order) VALUES
  ('two_wheeler','Two-wheeler','field',1),
  ('car','Car','field',2),
  ('driving_licence','Driving Licence','field',3),
  ('smartphone','Smartphone','general',4),
  ('laptop','Laptop','desk',5),
  ('wifi','WiFi at home','desk',6),
  ('headset','Headset / Mic','desk',7)
ON CONFLICT (slug) DO NOTHING;

-- 8. Seed languages
INSERT INTO public.languages_master (name, sort_order) VALUES
  ('Hindi',1),('English',2),('Marathi',3),('Tamil',4),('Telugu',5),('Kannada',6),
  ('Bengali',7),('Gujarati',8),('Punjabi',9),('Malayalam',10),('Odia',11),
  ('Assamese',12),('Urdu',13)
ON CONFLICT (name) DO NOTHING;

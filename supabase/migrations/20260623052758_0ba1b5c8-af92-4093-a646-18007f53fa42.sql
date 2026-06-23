
-- Platform roles
CREATE TYPE public.app_platform_role AS ENUM ('super_admin');

CREATE TABLE public.platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_platform_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.platform_roles TO authenticated;
GRANT ALL ON public.platform_roles TO service_role;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_platform_role(_user_id uuid, _role public.app_platform_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "admins read roles" ON public.platform_roles FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin') OR user_id = auth.uid());
CREATE POLICY "admins manage roles" ON public.platform_roles FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

-- Admin seed (mobile w/o +, or email)
CREATE TABLE public.admin_seed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL UNIQUE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_seed TO authenticated;
GRANT ALL ON public.admin_seed TO service_role;
ALTER TABLE public.admin_seed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage seed" ON public.admin_seed FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

INSERT INTO public.admin_seed (identifier, note) VALUES
  ('919098326235', 'initial super admin'),
  ('9098326235', 'initial super admin (raw)');

-- Trigger: auto-grant super_admin when seeded user signs up / logs in
CREATE OR REPLACE FUNCTION public.tg_grant_seeded_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.admin_seed s
     WHERE s.identifier = NEW.phone OR s.identifier = NEW.email
  ) THEN
    INSERT INTO public.platform_roles(user_id, role)
      VALUES (NEW.id, 'super_admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_admin
  AFTER INSERT OR UPDATE OF email, phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_grant_seeded_admin();

-- profiles.status
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_chk CHECK (status IN ('active','suspended'));

-- Master data
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  state text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cities TO anon, authenticated;
GRANT ALL ON public.cities TO service_role;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read cities" ON public.cities FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage cities" ON public.cities FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER cities_updated BEFORE UPDATE ON public.cities FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.skills_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.skills_master TO anon, authenticated;
GRANT ALL ON public.skills_master TO service_role;
ALTER TABLE public.skills_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read skills" ON public.skills_master FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage skills" ON public.skills_master FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER skills_updated BEFORE UPDATE ON public.skills_master FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.industries TO anon, authenticated;
GRANT ALL ON public.industries TO service_role;
ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read industries" ON public.industries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage industries" ON public.industries FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER industries_updated BEFORE UPDATE ON public.industries FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.job_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_categories TO anon, authenticated;
GRANT ALL ON public.job_categories TO service_role;
ALTER TABLE public.job_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read jobcats" ON public.job_categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins manage jobcats" ON public.job_categories FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER jobcats_updated BEFORE UPDATE ON public.job_categories FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Promo banners
CREATE TABLE public.promo_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  image_url text,
  cta_label text,
  cta_url text,
  audience text NOT NULL DEFAULT 'both' CHECK (audience IN ('candidate','employer','both')),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.promo_banners TO anon, authenticated;
GRANT ALL ON public.promo_banners TO service_role;
ALTER TABLE public.promo_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read active banners" ON public.promo_banners FOR SELECT TO anon, authenticated
  USING (is_active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now()));
CREATE POLICY "admins manage banners" ON public.promo_banners FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER banners_updated BEFORE UPDATE ON public.promo_banners FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Learning resources
CREATE TABLE public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  cover_url text,
  content_url text NOT NULL,
  kind text NOT NULL DEFAULT 'article' CHECK (kind IN ('video','article')),
  category text,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.learning_resources TO anon, authenticated;
GRANT ALL ON public.learning_resources TO service_role;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read published" ON public.learning_resources FOR SELECT TO anon, authenticated USING (is_published = true);
CREATE POLICY "admins manage learning" ON public.learning_resources FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
CREATE TRIGGER learning_updated BEFORE UPDATE ON public.learning_resources FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

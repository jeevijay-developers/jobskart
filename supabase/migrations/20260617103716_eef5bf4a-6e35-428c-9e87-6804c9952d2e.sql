
CREATE TYPE public.user_type AS ENUM ('candidate', 'employer');
CREATE TYPE public.experience_status AS ENUM ('fresher', 'experienced', 'student');
CREATE TYPE public.employer_role AS ENUM ('super_admin', 'hr_admin', 'recruiter');
CREATE TYPE public.company_type AS ENUM ('proprietorship', 'pvt_ltd', 'llp', 'public_ltd', 'ngo', 'government');
CREATE TYPE public.company_size AS ENUM ('1-10', '11-50', '51-200', '201-500', '500+');

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  mobile text,
  avatar_url text,
  city text,
  user_type public.user_type NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- candidate_profiles
CREATE TABLE public.candidate_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_status public.experience_status NOT NULL DEFAULT 'fresher',
  years_experience int NOT NULL DEFAULT 0,
  last_role text,
  skills text[] NOT NULL DEFAULT '{}',
  preferred_job_types text[] NOT NULL DEFAULT '{}',
  bio text,
  profile_strength int NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_profiles TO authenticated;
GRANT ALL ON public.candidate_profiles TO service_role;
ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Candidates manage their own candidate profile" ON public.candidate_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER candidate_profiles_set_updated_at BEFORE UPDATE ON public.candidate_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_type public.company_type,
  industry text,
  size public.company_size,
  website text,
  logo_url text,
  description text,
  primary_city text,
  pincode text,
  is_verified boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- employer_members
CREATE TABLE public.employer_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.employer_role NOT NULL DEFAULT 'recruiter',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employer_members TO authenticated;
GRANT ALL ON public.employer_members TO service_role;
ALTER TABLE public.employer_members ENABLE ROW LEVEL SECURITY;

-- helpers
CREATE OR REPLACE FUNCTION public.has_company_membership(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id);
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(_user_id uuid, _company_id uuid, _role public.employer_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.user_companies(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.employer_members WHERE user_id = _user_id;
$$;

-- company policies
CREATE POLICY "Members can view their companies" ON public.companies
  FOR SELECT TO authenticated USING (public.has_company_membership(auth.uid(), id));
CREATE POLICY "Authenticated users can create a company" ON public.companies
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Admins can update their company" ON public.companies
  FOR UPDATE TO authenticated
  USING (public.has_company_role(auth.uid(), id, 'super_admin') OR public.has_company_role(auth.uid(), id, 'hr_admin'))
  WITH CHECK (public.has_company_role(auth.uid(), id, 'super_admin') OR public.has_company_role(auth.uid(), id, 'hr_admin'));
CREATE POLICY "Super admins can delete their company" ON public.companies
  FOR DELETE TO authenticated USING (public.has_company_role(auth.uid(), id, 'super_admin'));

-- employer_members policies
CREATE POLICY "Members can view teammates within same company" ON public.employer_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR company_id IN (SELECT public.user_companies(auth.uid())));
CREATE POLICY "User can insert own membership" ON public.employer_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Super admins can update team memberships" ON public.employer_members
  FOR UPDATE TO authenticated
  USING (public.has_company_role(auth.uid(), company_id, 'super_admin'))
  WITH CHECK (public.has_company_role(auth.uid(), company_id, 'super_admin'));
CREATE POLICY "Super admins can remove team memberships" ON public.employer_members
  FOR DELETE TO authenticated USING (public.has_company_role(auth.uid(), company_id, 'super_admin'));

-- handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _user_type public.user_type;
BEGIN
  _user_type := COALESCE((NEW.raw_user_meta_data ->> 'user_type')::public.user_type, 'candidate');
  INSERT INTO public.profiles (id, email, full_name, mobile, user_type)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), NEW.raw_user_meta_data ->> 'mobile', _user_type)
  ON CONFLICT (id) DO NOTHING;
  IF _user_type = 'candidate' THEN
    INSERT INTO public.candidate_profiles (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

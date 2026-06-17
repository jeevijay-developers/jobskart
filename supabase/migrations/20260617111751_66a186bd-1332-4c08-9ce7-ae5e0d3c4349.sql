
ALTER TABLE public.companies ALTER COLUMN created_by DROP NOT NULL;

CREATE TYPE public.job_type AS ENUM ('full_time','part_time','contract','internship','temporary');
CREATE TYPE public.job_shift AS ENUM ('day','night','rotational','flexible');
CREATE TYPE public.work_mode AS ENUM ('onsite','remote','hybrid','field');
CREATE TYPE public.job_status AS ENUM ('draft','active','paused','closed','expired');
CREATE TYPE public.application_status AS ENUM ('applied','shortlisted','interview','hired','rejected','withdrawn');

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text,
  role_type text,
  job_type public.job_type NOT NULL DEFAULT 'full_time',
  shift public.job_shift,
  work_mode public.work_mode NOT NULL DEFAULT 'onsite',
  city text, state text, locality text, pincode text,
  min_salary integer, max_salary integer,
  salary_period text DEFAULT 'monthly',
  fixed_pay boolean DEFAULT true,
  incentives_text text,
  min_experience_years integer DEFAULT 0,
  max_experience_years integer,
  education text, english_level text,
  gender_pref text DEFAULT 'any',
  age_min integer, age_max integer,
  skills text[] DEFAULT '{}',
  perks text[] DEFAULT '{}',
  openings integer DEFAULT 1,
  contact_pref text DEFAULT 'in_app',
  walkin boolean DEFAULT false,
  walkin_details text,
  status public.job_status NOT NULL DEFAULT 'active',
  quality_score integer DEFAULT 0,
  views_count integer DEFAULT 0,
  applications_count integer DEFAULT 0,
  boosted_until timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jobs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active jobs are public" ON public.jobs FOR SELECT
  USING (status = 'active' OR public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Company members can insert jobs" ON public.jobs FOR INSERT
  WITH CHECK (auth.uid() = posted_by AND public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Company members can update jobs" ON public.jobs FOR UPDATE
  USING (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Company members can delete jobs" ON public.jobs FOR DELETE
  USING (public.has_company_membership(auth.uid(), company_id));

CREATE INDEX idx_jobs_status_created ON public.jobs(status, created_at DESC);
CREATE INDEX idx_jobs_city ON public.jobs(city);
CREATE INDEX idx_jobs_category ON public.jobs(category);
CREATE INDEX idx_jobs_company ON public.jobs(company_id);
CREATE TRIGGER tg_jobs_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status public.application_status NOT NULL DEFAULT 'applied',
  cover_note text, expected_salary integer, available_from date,
  employer_notes text, viewed_by_employer_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, candidate_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO authenticated;
GRANT ALL ON public.applications TO service_role;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View applications" ON public.applications FOR SELECT
  USING (auth.uid() = candidate_id OR public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Candidates apply" ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = candidate_id);
CREATE POLICY "Update applications" ON public.applications FOR UPDATE
  USING (auth.uid() = candidate_id OR public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Candidate withdraw" ON public.applications FOR DELETE
  USING (auth.uid() = candidate_id);
CREATE INDEX idx_apps_candidate ON public.applications(candidate_id, created_at DESC);
CREATE INDEX idx_apps_job ON public.applications(job_id, created_at DESC);
CREATE INDEX idx_apps_company ON public.applications(company_id, created_at DESC);
CREATE TRIGGER tg_apps_updated_at BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.saved_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);
GRANT SELECT, INSERT, DELETE ON public.saved_jobs TO authenticated;
GRANT ALL ON public.saved_jobs TO service_role;
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own saved jobs" ON public.saved_jobs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

WITH new_companies AS (
  INSERT INTO public.companies (name, company_type, industry, size, website, description, primary_city, is_verified)
  VALUES
    ('BlueCart Logistics','pvt_ltd','Logistics','201-500','https://bluecart.example.com','Last-mile delivery across western India.','Mumbai',true),
    ('SafeGuard Securities','pvt_ltd','Security Services','500+','https://safeguard.example.com','Trusted security personnel for offices and residences.','Delhi',true),
    ('SwiftSales Retail','pvt_ltd','Retail','51-200','https://swiftsales.example.com','Pan-India retail chain hiring sales associates.','Bengaluru',false)
  RETURNING id, name
)
INSERT INTO public.jobs (company_id, title, description, category, job_type, shift, work_mode, city, state, locality, min_salary, max_salary, min_experience_years, max_experience_years, education, english_level, skills, perks, openings, status, quality_score)
SELECT c.id, j.title, j.description, j.category, j.jt::public.job_type, j.sh::public.job_shift, j.wm::public.work_mode, j.city, j.state, j.locality, j.min_salary, j.max_salary, j.min_exp, j.max_exp, j.education, j.english_level, j.skills, j.perks, j.openings, 'active'::public.job_status, j.quality_score
FROM new_companies c
JOIN (VALUES
  ('BlueCart Logistics','Delivery Boy','Deliver packages across Mumbai using company-provided two-wheeler. Daily route assigned via app.','Delivery','full_time','day','field','Mumbai','Maharashtra','Andheri',15000,22000,0,2,'10th Pass','Basic',ARRAY['Two-wheeler','Smartphone','City knowledge'],ARRAY['Fuel reimbursement','Daily incentive','Insurance'],10,75),
  ('BlueCart Logistics','Warehouse Associate','Sort, pack and load shipments at our Bhiwandi hub. Night shift available.','Warehouse','full_time','rotational','onsite','Thane','Maharashtra','Bhiwandi',14000,18000,0,3,'10th Pass','None',ARRAY['Loading','Sorting','Inventory'],ARRAY['Free meals','PF','Overtime pay'],25,68),
  ('SafeGuard Securities','Security Guard','Day-shift security guard for residential society in South Delhi. Valid PSARA license preferred.','Security','full_time','day','onsite','New Delhi','Delhi','Saket',16000,20000,1,5,'8th Pass','Basic',ARRAY['PSARA','First Aid','Discipline'],ARRAY['Uniform','PF','Yearly bonus'],8,72),
  ('SafeGuard Securities','Female Security Guard','Hiring female guards for tech park reception checks. Day shift only.','Security','full_time','day','onsite','Gurgaon','Haryana','Cyber City',18000,24000,0,3,'10th Pass','Basic',ARRAY['Communication','Patience'],ARRAY['PF','ESI','Pickup-drop'],5,70),
  ('SwiftSales Retail','Sales Associate','Greet customers, demo products, handle billing at Indiranagar outlet.','Sales','full_time','day','onsite','Bengaluru','Karnataka','Indiranagar',18000,28000,0,4,'12th Pass','Good',ARRAY['Sales','Customer service','Billing'],ARRAY['Incentives','Health insurance','Discounts'],6,78),
  ('SwiftSales Retail','Telecaller','Outbound calling to existing customers for repeat purchases. Hindi + English mandatory.','Telecaller','full_time','day','onsite','Bengaluru','Karnataka','Koramangala',16000,25000,0,2,'12th Pass','Good',ARRAY['Hindi','English','CRM'],ARRAY['Weekly incentive','PF','Cab after 9pm'],15,80)
) AS j(co_name,title,description,category,jt,sh,wm,city,state,locality,min_salary,max_salary,min_exp,max_exp,education,english_level,skills,perks,openings,quality_score)
  ON c.name = j.co_name;

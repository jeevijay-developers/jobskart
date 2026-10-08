-- =====================================================================
-- seed_local.sql -- reusable test fixtures for Recommendation V2 work.
--
-- LOCAL ONLY. NEVER apply to a linked/remote Supabase project.
-- Idempotent: safe to run repeatedly (fixed IDs, ON CONFLICT upserts).
--
-- Load:
--   docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres \
--     -v ON_ERROR_STOP=1 -q < supabase/tests/fixtures/seed_local.sql
--
-- ID MAP (all UUIDs are 00000000-0000-4000-8000-<12 hex>):
--   platform super_admin : ...0000a001            admin@fixture.local
--   employers/users      : ...00e001 .. 00e003    employer1..3@fixture.local
--                          e001 super_admin of d001, e002 hr_admin of d002,
--                          e003 recruiter of d003
--   companies            : ...00d001 .. 00d003    (spelled d0NN: d001..d003)
--                          d001 verified, owns 16 active jobs (cap testing)
--                          d002 14 active + 2 non-servable, d003 10 active + 1
--   candidates           : ...00c001 .. 00c014    (c0NN)
--     01 Driver/Delhi 6y    02 Driver/Pune 3y     03 Delivery/Delhi 1y
--     04 Delivery/Mumbai 2y (NO embedding)        05 Security/Jaipur 8y (has prefs)
--     06 Warehouse packer/Pune 2y                 07 Sales/Delhi 4y (has prefs)
--     08 Telecaller/Jaipur 1y                     09 Customer support/Mumbai 3y
--     10 Data entry/Delhi 0y                      11 Cook, Hinglish headline/Jaipur 4y
--     12 Retail salesman/Mumbai 2y
--     13, 14 COLD START (no skills/city/roles/headline; no embedding)
--   jobs (active, servable): ...00b001 .. 00b040 (b0NN), 4 per category:
--     01-04 Driver, 05-08 Delivery, 09-12 Security, 13-16 Warehouse,
--     17-20 Telecaller, 21-24 Customer Support, 25-28 Data Entry,
--     29-32 Sales, 33-36 Retail, 37-40 Cook.  Every 5th job (05,10,..,40)
--     has NO description_embedding.
--   jobs (NOT servable)  : b041 paused, b042 closed, b043 active but
--     expires_at in the past, b044 status expired
--   job_boosts (active)  : ...00f005, f017, f037 (on b005, b017, b037)
--   applications         : 11 rows (c01..c12 -> assorted jobs; see below)
--   saved_jobs           : 7 rows
--   NOTE: migrations themselves seed ~6 demo jobs / 3 demo companies
--   (BlueCart, SafeGuard, SwiftSales); they are left alone and show up in
--   recommendation output, so tests must not assume fixture-only results.
--   canonical_skills / cities are EMPTY after migrations and are not seeded;
--   skill matching therefore exercises the free-text (lower(name)) path.
--
-- Embeddings: vector(1536). Each category has a fixed base sin() wave;
-- each row adds a small deterministic perturbation; vectors L2-normalised.
-- Same-category cosine ~0.95+, cross-category ~0. Built with a pg_temp
-- helper (no permanent objects are created).
-- =====================================================================

-- ---- safety guard: refuse to run on anything that looks real ---------
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email IS NULL OR email NOT LIKE '%@fixture.local') THEN
    RAISE EXCEPTION 'seed_local.sql refuses to run: database contains non-fixture users (is this a real project?)';
  END IF;
END
$guard$;

BEGIN;

-- ---- pg_temp helper: deterministic structured embedding ---------------
CREATE OR REPLACE FUNCTION pg_temp.fx_vec(_cat text, _noise int) RETURNS vector
LANGUAGE sql IMMUTABLE AS $f$
  WITH p AS (
    SELECT 0.31 + 0.53 * array_position(
      ARRAY['Driver','Delivery','Security','Warehouse','Telecaller',
            'Customer Support','Data Entry','Sales','Retail','Cook'], _cat) AS seed
  ), raw AS (
    SELECT i, sin(i * p.seed) + 0.25 * sin(i * (1.9 + _noise * 0.013) + _noise) AS x
    FROM p, generate_series(1, 1536) i
  ), n AS (SELECT sqrt(sum(x * x)) AS norm FROM raw)
  SELECT (array_agg(raw.x / n.norm ORDER BY raw.i))::float8[]::vector(1536) FROM raw, n
$f$;

-- ---- auth.users (profiles + candidate_profiles created by trigger) ----
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token
)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', u.full_name, 'user_type', u.utype),
       now(), now(), '', '', '', '', '', '', '', ''
FROM (VALUES
  ('00000000-0000-4000-8000-00000000a001'::uuid, 'admin@fixture.local',     'Fixture Admin',      'employer'),
  ('00000000-0000-4000-8000-00000000e001'::uuid, 'employer1@fixture.local', 'Employer One',       'employer'),
  ('00000000-0000-4000-8000-00000000e002'::uuid, 'employer2@fixture.local', 'Employer Two',       'employer'),
  ('00000000-0000-4000-8000-00000000e003'::uuid, 'employer3@fixture.local', 'Employer Three',     'employer'),
  ('00000000-0000-4000-8000-00000000c001'::uuid, 'driver.delhi@fixture.local',   'Rajesh Kumar',     'candidate'),
  ('00000000-0000-4000-8000-00000000c002'::uuid, 'driver.pune@fixture.local',    'Santosh Patil',    'candidate'),
  ('00000000-0000-4000-8000-00000000c003'::uuid, 'rider.delhi@fixture.local',    'Amit Singh',       'candidate'),
  ('00000000-0000-4000-8000-00000000c004'::uuid, 'rider.mumbai@fixture.local',   'Imran Shaikh',     'candidate'),
  ('00000000-0000-4000-8000-00000000c005'::uuid, 'guard.jaipur@fixture.local',   'Mohan Lal',        'candidate'),
  ('00000000-0000-4000-8000-00000000c006'::uuid, 'packer.pune@fixture.local',    'Sachin More',      'candidate'),
  ('00000000-0000-4000-8000-00000000c007'::uuid, 'sales.delhi@fixture.local',    'Neha Sharma',      'candidate'),
  ('00000000-0000-4000-8000-00000000c008'::uuid, 'telecaller.jaipur@fixture.local','Pooja Meena',     'candidate'),
  ('00000000-0000-4000-8000-00000000c009'::uuid, 'support.mumbai@fixture.local', 'Priya Nair',       'candidate'),
  ('00000000-0000-4000-8000-00000000c010'::uuid, 'dataentry.delhi@fixture.local','Rahul Verma',      'candidate'),
  ('00000000-0000-4000-8000-00000000c011'::uuid, 'cook.jaipur@fixture.local',    'Ramesh Bhatt',     'candidate'),
  ('00000000-0000-4000-8000-00000000c012'::uuid, 'retail.mumbai@fixture.local',  'Sunita Gaikwad',   'candidate'),
  ('00000000-0000-4000-8000-00000000c013'::uuid, 'cold1@fixture.local',          'Cold Start One',   'candidate'),
  ('00000000-0000-4000-8000-00000000c014'::uuid, 'cold2@fixture.local',          'Cold Start Two',   'candidate')
) AS u(id, email, full_name, utype)
ON CONFLICT (id) DO NOTHING;

-- ---- profiles (city) ---------------------------------------------------
UPDATE public.profiles p SET city = v.city
FROM (VALUES
  ('00000000-0000-4000-8000-00000000c001'::uuid, 'Delhi'),
  ('00000000-0000-4000-8000-00000000c002'::uuid, 'Pune'),
  ('00000000-0000-4000-8000-00000000c003'::uuid, 'Delhi'),
  ('00000000-0000-4000-8000-00000000c004'::uuid, 'Mumbai'),
  ('00000000-0000-4000-8000-00000000c005'::uuid, 'Jaipur'),
  ('00000000-0000-4000-8000-00000000c006'::uuid, 'Pune'),
  ('00000000-0000-4000-8000-00000000c007'::uuid, 'Delhi'),
  ('00000000-0000-4000-8000-00000000c008'::uuid, 'Jaipur'),
  ('00000000-0000-4000-8000-00000000c009'::uuid, 'Mumbai'),
  ('00000000-0000-4000-8000-00000000c010'::uuid, 'Delhi'),
  ('00000000-0000-4000-8000-00000000c011'::uuid, 'Jaipur'),
  ('00000000-0000-4000-8000-00000000c012'::uuid, 'Mumbai')
) v(id, city)
WHERE p.id = v.id;
-- cold-start users keep profiles.city NULL on purpose
UPDATE public.profiles SET city = NULL
WHERE id IN ('00000000-0000-4000-8000-00000000c013', '00000000-0000-4000-8000-00000000c014');

-- ---- candidate_profiles (row already exists from signup trigger) --------
INSERT INTO public.candidate_profiles (
  user_id, experience_status, years_experience, last_role, headline, skills,
  interested_roles, preferred_cities, expected_salary, highest_qualification,
  onboarding_completed, profile_embedding
)
SELECT ('00000000-0000-4000-8000-00000000c0' || lpad(c.nn::text, 2, '0'))::uuid,
       c.xs::experience_status, c.yrs, c.last_role, c.headline, c.skills,
       c.roles, c.cities, c.exp_sal, c.qual, true,
       CASE WHEN c.emb_cat IS NULL THEN NULL ELSE pg_temp.fx_vec(c.emb_cat, c.nn) END
FROM (VALUES
  (1,  'experienced', 6, 'Driver',  'Experienced Driver with clean record', ARRAY['driving','valid license','city navigation'], ARRAY['Driver','Delivery'], ARRAY['Delhi'],  22000, '10th', 'Driver'),
  (2,  'experienced', 3, 'Truck Driver', 'Heavy vehicle driver',            ARRAY['driving','heavy vehicle license','Night Driving'], ARRAY['Driver'], ARRAY['Pune','Mumbai'], 26000, '10th', 'Driver'),
  (3,  'experienced', 1, 'Delivery Boy', 'Two wheeler delivery rider',      ARRAY['two-wheeler','delivery','navigation'], ARRAY['Delivery Executive'], ARRAY['Delhi'], 17000, '12th', 'Delivery'),
  (4,  'experienced', 2, 'Delivery Rider', 'Courier rider, own bike',       ARRAY['delivery','two-wheeler'], ARRAY['Delivery Partner'], ARRAY['Mumbai'], 18000, '12th', NULL),
  (5,  'experienced', 8, 'Security Guard', 'Ex-serviceman security guard',  ARRAY['security','night shift','fire safety'], ARRAY['Security Guard'], ARRAY['Jaipur'], 16000, '10th', 'Security'),
  (6,  'experienced', 2, 'Warehouse Packer', 'Packer and loader',           ARRAY['packing','inventory','loading'], ARRAY['Warehouse Packer'], ARRAY['Pune'], 15000, '12th', 'Warehouse'),
  (7,  'experienced', 4, 'Sales Executive', 'Field and inside sales',       ARRAY['sales','negotiation','communication','lead generation'], ARRAY['Sales Executive'], ARRAY['Delhi','Jaipur'], 24000, 'Graduate', 'Sales'),
  (8,  'experienced', 1, 'Telecaller', 'Telecaller, Hindi and English',     ARRAY['telecalling','hindi','communication'], ARRAY['Telecaller'], ARRAY['Jaipur'], 14000, '12th', 'Telecaller'),
  (9,  'experienced', 3, 'Customer Support Executive', 'Voice and chat support', ARRAY['customer support','english','crm'], ARRAY['Customer Support Executive'], ARRAY['Mumbai'], 20000, 'Graduate', 'Customer Support'),
  (10, 'fresher',     0, NULL,      'Fresher looking for data entry work',  ARRAY['typing','excel','ms office'], ARRAY['Data Entry Operator'], ARRAY['Delhi'], 12000, 'Graduate', 'Data Entry'),
  (11, 'experienced', 4, 'Cook',    'Mujhe cook ka kaam chahiye, 4 saal ka experience, khana banana aata hai', ARRAY['cooking','north indian','tandoor'], ARRAY['Cook'], ARRAY['Jaipur'], 17000, '8th', 'Cook'),
  (12, 'experienced', 2, 'Salesman', 'Retail salesman and billing',         ARRAY['retail','billing','customer handling','mystery skill xyz'], ARRAY['Retail Executive'], ARRAY['Mumbai'], 16000, '12th', 'Retail'),
  (13, 'fresher',     0, NULL,      NULL, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL),
  (14, 'fresher',     0, NULL,      NULL, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], NULL, NULL, NULL)
) AS c(nn, xs, yrs, last_role, headline, skills, roles, cities, exp_sal, qual, emb_cat)
ON CONFLICT (user_id) DO UPDATE SET
  experience_status = EXCLUDED.experience_status, years_experience = EXCLUDED.years_experience,
  last_role = EXCLUDED.last_role, headline = EXCLUDED.headline, skills = EXCLUDED.skills,
  interested_roles = EXCLUDED.interested_roles, preferred_cities = EXCLUDED.preferred_cities,
  expected_salary = EXCLUDED.expected_salary, highest_qualification = EXCLUDED.highest_qualification,
  onboarding_completed = true, profile_embedding = EXCLUDED.profile_embedding;

-- ---- candidate_preferences (only two candidates; others have none) ------
INSERT INTO public.candidate_preferences (
  user_id, min_salary_monthly, max_salary_monthly, job_types, work_modes,
  min_experience_years, max_experience_years
) VALUES
  ('00000000-0000-4000-8000-00000000c005', 12000, 20000, ARRAY['full_time'], ARRAY['onsite'], 0, 10),
  ('00000000-0000-4000-8000-00000000c007', 15000, 35000, ARRAY['full_time'], ARRAY['onsite','field'], 0, 6)
ON CONFLICT (user_id) DO UPDATE SET
  min_salary_monthly = EXCLUDED.min_salary_monthly, max_salary_monthly = EXCLUDED.max_salary_monthly,
  job_types = EXCLUDED.job_types, work_modes = EXCLUDED.work_modes,
  min_experience_years = EXCLUDED.min_experience_years, max_experience_years = EXCLUDED.max_experience_years;

-- ---- platform admin role -------------------------------------------------
INSERT INTO public.platform_roles (user_id, role)
VALUES ('00000000-0000-4000-8000-00000000a001', 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- ---- companies -------------------------------------------------------------
INSERT INTO public.companies (id, name, industry, primary_city, is_verified, verification_status, created_by, onboarding_completed, description)
VALUES
  ('00000000-0000-4000-8000-00000000d001', 'Fixture Logistics Pvt Ltd', 'Logistics',   'Delhi',  true,  'verified',   '00000000-0000-4000-8000-00000000e001', true, 'Fixture company 1 (verified, owns many jobs)'),
  ('00000000-0000-4000-8000-00000000d002', 'Fixture Services LLP',      'Services',    'Pune',   false, 'unverified', '00000000-0000-4000-8000-00000000e002', true, 'Fixture company 2'),
  ('00000000-0000-4000-8000-00000000d003', 'Fixture Retail Traders',    'Retail',      'Jaipur', false, 'unverified', '00000000-0000-4000-8000-00000000e003', true, 'Fixture company 3')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_verified = EXCLUDED.is_verified;

INSERT INTO public.employer_members (user_id, company_id, role, status)
VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d001', 'super_admin', 'active'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d002', 'hr_admin',    'active'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d003', 'recruiter',   'active')
ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

-- ---- jobs -------------------------------------------------------------------
-- (nn, company nn, category, title, city, min_sal, max_sal, skills, min_exp, max_exp,
--  work_mode, job_type, tier, days_ago, status, expired)
INSERT INTO public.jobs (
  id, company_id, posted_by, title, description, category, city, state,
  min_salary, max_salary, skills, min_experience_years, max_experience_years,
  work_mode, job_type, tier, status, created_at, expires_at, description_embedding
)
SELECT ('00000000-0000-4000-8000-00000000b0' || lpad(j.nn::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000d00' || j.comp)::uuid,
       ('00000000-0000-4000-8000-00000000e00' || j.comp)::uuid,
       j.title, j.title || ' needed in ' || j.city || '. Category: ' || j.cat || '.',
       j.cat, j.city, 'Fixture State',
       j.minsal, j.maxsal, j.skills, j.minexp, j.maxexp,
       j.wm::work_mode, j.jt::job_type, j.tier::job_tier, j.status::job_status,
       now() - make_interval(days => j.days),
       CASE WHEN j.expired THEN now() - interval '1 day' ELSE now() + interval '30 days' END,
       CASE WHEN j.nn % 5 = 0 THEN NULL ELSE pg_temp.fx_vec(j.cat, 100 + j.nn) END
FROM (VALUES
  ( 1,1,'Driver','Car Driver','Delhi',18000,24000,ARRAY['driving','valid license'],2,8,'onsite','full_time','trending',2,'active',false),
  ( 2,1,'Driver','Truck Driver','Pune',22000,30000,ARRAY['driving','heavy vehicle license'],3,10,'onsite','full_time','classic',5,'active',false),
  ( 3,2,'Driver','Personal Chauffeur','Delhi',20000,28000,ARRAY['driving','city navigation'],1,6,'onsite','full_time','classic_plus',9,'active',false),
  ( 4,3,'Driver','Cab Driver','Jaipur',16000,22000,ARRAY['driving'],0,5,'field','contract','classic',14,'active',false),
  ( 5,1,'Delivery','Delivery Executive','Delhi',15000,22000,ARRAY['two-wheeler','delivery','navigation'],0,3,'field','full_time','classic',1,'active',false),
  ( 6,1,'Delivery','Delivery Partner','Mumbai',17000,25000,ARRAY['two-wheeler','delivery'],0,4,'field','part_time','trending',3,'active',false),
  ( 7,2,'Delivery','Courier Rider','Pune',14000,20000,ARRAY['delivery','two-wheeler'],0,2,'field','full_time','classic',7,'active',false),
  ( 8,2,'Delivery','Last Mile Delivery Rider','Jaipur',13000,18000,ARRAY['delivery'],0,2,'field','temporary','classic',20,'active',false),
  ( 9,1,'Security','Security Guard','Delhi',14000,18000,ARRAY['security','night shift'],1,10,'onsite','full_time','classic',4,'active',false),
  (10,3,'Security','Security Guard','Jaipur',13000,17000,ARRAY['security'],0,8,'onsite','full_time','classic_plus',11,'active',false),
  (11,3,'Security','Security Supervisor','Pune',20000,26000,ARRAY['security','team handling'],4,10,'onsite','full_time','classic',16,'active',false),
  (12,2,'Security','Watchman','Mumbai',12000,16000,ARRAY['security'],0,6,'onsite','full_time','classic',25,'active',false),
  (13,1,'Warehouse','Warehouse Packer','Pune',14000,19000,ARRAY['packing','inventory'],0,3,'onsite','full_time','classic',2,'active',false),
  (14,1,'Warehouse','Forklift Operator','Delhi',18000,25000,ARRAY['forklift','warehouse'],2,7,'onsite','full_time','classic',6,'active',false),
  (15,2,'Warehouse','Inventory Associate','Mumbai',15000,21000,ARRAY['inventory','data entry'],1,4,'onsite','full_time','classic_plus',10,'active',false),
  (16,3,'Warehouse','Loader','Jaipur',12000,16000,ARRAY['loading','packing'],0,3,'onsite','contract','classic',18,'active',false),
  (17,1,'Telecaller','Telecaller','Delhi',13000,20000,ARRAY['telecalling','hindi','communication'],0,3,'onsite','full_time','trending',1,'active',false),
  (18,2,'Telecaller','Telesales Executive','Jaipur',14000,22000,ARRAY['telecalling','sales','communication'],0,4,'onsite','full_time','classic',8,'active',false),
  (19,2,'Telecaller','Telecaller (Work From Home)','Delhi',12000,18000,ARRAY['telecalling'],0,2,'remote','part_time','classic',13,'active',false),
  (20,3,'Telecaller','Telecaller','Pune',13000,19000,ARRAY['telecalling','communication'],0,3,'onsite','full_time','classic',22,'active',false),
  (21,1,'Customer Support','Customer Support Executive','Mumbai',16000,24000,ARRAY['customer support','english','crm'],1,5,'onsite','full_time','classic_plus',3,'active',false),
  (22,2,'Customer Support','Customer Care Executive','Delhi',15000,22000,ARRAY['customer support','communication'],0,4,'hybrid','full_time','classic',12,'active',false),
  (23,2,'Customer Support','Call Center Agent','Pune',14000,21000,ARRAY['customer support','english'],0,3,'onsite','full_time','classic',17,'active',false),
  (24,3,'Customer Support','Helpdesk Associate','Jaipur',13000,18000,ARRAY['customer support'],0,3,'onsite','full_time','classic',27,'active',false),
  (25,1,'Data Entry','Data Entry Operator','Delhi',12000,17000,ARRAY['data entry','excel','typing'],0,2,'onsite','full_time','classic',5,'active',false),
  (26,2,'Data Entry','Computer Operator','Mumbai',13000,18000,ARRAY['data entry','ms office'],0,3,'onsite','full_time','classic',9,'active',false),
  (27,3,'Data Entry','Back Office Executive','Pune',14000,20000,ARRAY['data entry','excel'],1,4,'onsite','full_time','classic',15,'active',false),
  (28,3,'Data Entry','Data Entry Operator','Jaipur',11000,15000,ARRAY['data entry','typing'],0,1,'remote','part_time','classic',21,'active',false),
  (29,1,'Sales','Sales Executive','Delhi',16000,30000,ARRAY['sales','negotiation','communication'],1,5,'field','full_time','trending',2,'active',false),
  (30,1,'Sales','Business Development Executive','Mumbai',20000,35000,ARRAY['sales','lead generation'],2,6,'field','full_time','classic_plus',6,'active',false),
  (31,2,'Sales','Sales Executive','Pune',15000,26000,ARRAY['sales','communication'],0,4,'field','full_time','classic',14,'active',false),
  (32,2,'Sales','Sales Manager','Jaipur',22000,32000,ARRAY['sales','team handling'],4,9,'onsite','full_time','classic',19,'active',false),
  (33,1,'Retail','Retail Store Executive','Delhi',14000,20000,ARRAY['retail','billing','customer handling'],0,3,'onsite','full_time','classic',4,'active',false),
  (34,1,'Retail','Cashier','Mumbai',13000,18000,ARRAY['billing','cashier'],0,3,'onsite','full_time','classic',8,'active',false),
  (35,2,'Retail','Salesman','Pune',12000,17000,ARRAY['retail','sales'],0,3,'onsite','full_time','classic',23,'active',false),
  (36,3,'Retail','Store Manager','Jaipur',20000,28000,ARRAY['retail','team handling','inventory'],3,8,'onsite','full_time','classic_plus',12,'active',false),
  (37,1,'Cook','Cook','Delhi',15000,22000,ARRAY['cooking','north indian'],2,8,'onsite','full_time','classic',3,'active',false),
  (38,1,'Cook','Chef de Partie','Mumbai',20000,28000,ARRAY['cooking','continental'],3,9,'onsite','full_time','classic',10,'active',false),
  (39,2,'Cook','Kitchen Helper','Pune',11000,15000,ARRAY['cooking','cleaning'],0,2,'onsite','full_time','classic',24,'active',false),
  (40,3,'Cook','Tandoor Cook','Jaipur',14000,20000,ARRAY['cooking','tandoor'],1,6,'onsite','full_time','classic',29,'active',false),
  -- non-servable: must never appear in recommendations
  (41,2,'Driver','Paused Driver Job','Delhi',18000,24000,ARRAY['driving'],0,5,'onsite','full_time','classic',3,'paused',false),
  (42,3,'Delivery','Closed Delivery Job','Pune',15000,20000,ARRAY['delivery'],0,3,'field','full_time','classic',4,'closed',false),
  (43,1,'Sales','Expired Sales Job (active but past expiry)','Delhi',16000,26000,ARRAY['sales'],0,4,'field','full_time','classic',28,'active',true),
  (44,2,'Cook','Expired Status Cook Job','Mumbai',14000,19000,ARRAY['cooking'],0,3,'onsite','full_time','classic',29,'expired',true)
) AS j(nn, comp, cat, title, city, minsal, maxsal, skills, minexp, maxexp, wm, jt, tier, days, status, expired)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, city = EXCLUDED.city,
  min_salary = EXCLUDED.min_salary, max_salary = EXCLUDED.max_salary, skills = EXCLUDED.skills,
  min_experience_years = EXCLUDED.min_experience_years, max_experience_years = EXCLUDED.max_experience_years,
  work_mode = EXCLUDED.work_mode, job_type = EXCLUDED.job_type, tier = EXCLUDED.tier,
  status = EXCLUDED.status, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
  description_embedding = EXCLUDED.description_embedding;

-- ---- active boosts on 3 jobs (trigger maintains jobs.boosted_until) -----------
INSERT INTO public.job_boosts (id, company_id, job_id, starts_at, ends_at, credits_spent, boosted_by, source)
VALUES
  ('00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000b005', now() - interval '2 hours', now() + interval '22 hours', 1, '00000000-0000-4000-8000-00000000e001', 'wallet'),
  ('00000000-0000-4000-8000-00000000f017', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000b017', now() - interval '6 hours', now() + interval '18 hours', 1, '00000000-0000-4000-8000-00000000e001', 'wallet'),
  ('00000000-0000-4000-8000-00000000f037', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000b037', now() - interval '1 hour',  now() + interval '23 hours', 1, '00000000-0000-4000-8000-00000000e001', 'wallet')
ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at;

-- ---- applications (candidate nn, job nn, status, days_ago) ---------------------
INSERT INTO public.applications (job_id, candidate_id, company_id, status, created_at)
SELECT ('00000000-0000-4000-8000-00000000b0' || lpad(a.job::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000c0' || lpad(a.cand::text, 2, '0'))::uuid,
       j.company_id, a.st::application_status, now() - make_interval(days => a.days)
FROM (VALUES
  (1, 1, 'applied', 3), (1, 5, 'shortlisted', 2), (2, 2, 'applied', 4),
  (3, 5, 'applied', 1), (3, 7, 'interview', 5), (5, 9, 'applied', 2),
  (7, 29, 'applied', 2), (8, 17, 'rejected', 6), (9, 21, 'applied', 1),
  (10, 25, 'applied', 4), (11, 37, 'hired', 8)
) AS a(cand, job, st, days)
JOIN public.jobs j ON j.id = ('00000000-0000-4000-8000-00000000b0' || lpad(a.job::text, 2, '0'))::uuid
ON CONFLICT (job_id, candidate_id) DO NOTHING;

-- ---- saved jobs ---------------------------------------------------------------------
INSERT INTO public.saved_jobs (user_id, job_id)
SELECT ('00000000-0000-4000-8000-00000000c0' || lpad(s.cand::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000b0' || lpad(s.job::text, 2, '0'))::uuid
FROM (VALUES (1, 3), (1, 6), (2, 13), (3, 8), (5, 10), (7, 30), (10, 27)) AS s(cand, job)
ON CONFLICT (user_id, job_id) DO NOTHING;

COMMIT;

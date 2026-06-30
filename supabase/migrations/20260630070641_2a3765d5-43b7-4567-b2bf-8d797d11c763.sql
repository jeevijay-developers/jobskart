
-- 1) Bulk-grant Data API access to authenticated + service_role for every public table.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE c.relkind='r' AND n.nspname='public'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', r.relname);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.relname);
  END LOOP;
END $$;

-- 2) Anon SELECT for publicly browseable tables (jobs already has public policy; companies needed for joins on the public job-detail page).
GRANT SELECT ON public.jobs TO anon;
GRANT SELECT ON public.companies TO anon;
GRANT SELECT ON public.cities TO anon;
GRANT SELECT ON public.industries TO anon;
GRANT SELECT ON public.job_categories TO anon;
GRANT SELECT ON public.skills_master TO anon;
GRANT SELECT ON public.job_titles_master TO anon;
GRANT SELECT ON public.languages_master TO anon;
GRANT SELECT ON public.learning_resources TO anon;
GRANT SELECT ON public.promo_banners TO anon;

-- Anon SELECT policy for companies so job detail page can show employer name & logo
DROP POLICY IF EXISTS "Public can view companies" ON public.companies;
CREATE POLICY "Public can view companies" ON public.companies
  FOR SELECT TO anon, authenticated USING (true);

-- 3) Allow members to insert/update their company wallet (onboarding seeds it).
DROP POLICY IF EXISTS "Members can insert wallet" ON public.employer_credit_wallets;
CREATE POLICY "Members can insert wallet" ON public.employer_credit_wallets
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "Members can update wallet" ON public.employer_credit_wallets;
CREATE POLICY "Members can update wallet" ON public.employer_credit_wallets
  FOR UPDATE TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id))
  WITH CHECK (public.has_company_membership(auth.uid(), company_id));

-- 4) Allow notification inserts from triggers/server (trigger runs SECURITY DEFINER but explicit grant prevents edge failures).
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "System can insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- 5) Atomic company-create RPC so onboarding never fails mid-way.
CREATE OR REPLACE FUNCTION public.create_company_with_owner(
  _name text,
  _industry text,
  _size company_size,
  _hq_city text,
  _website text,
  _about text,
  _founded_year int,
  _gst text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE _uid uuid := auth.uid(); _cid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.companies (name, industry, size, hq_city, primary_city, website, about, founded_year, gst_number, created_by, onboarding_completed)
    VALUES (_name, NULLIF(_industry,''), _size, NULLIF(_hq_city,''), NULLIF(_hq_city,''), NULLIF(_website,''), NULLIF(_about,''), _founded_year, NULLIF(_gst,''), _uid, true)
    RETURNING id INTO _cid;
  INSERT INTO public.employer_members (user_id, company_id, role) VALUES (_uid, _cid, 'super_admin')
    ON CONFLICT (user_id, company_id) DO NOTHING;
  INSERT INTO public.employer_credit_wallets (company_id, balance) VALUES (_cid, 0)
    ON CONFLICT (company_id) DO NOTHING;
  RETURN _cid;
END $$;

GRANT EXECUTE ON FUNCTION public.create_company_with_owner(text,text,company_size,text,text,text,int,text) TO authenticated;

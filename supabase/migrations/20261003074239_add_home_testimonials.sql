-- Super-admin-editable testimonials shown in the "Real People. Real Jobs." section on the public home page.
CREATE TABLE IF NOT EXISTS public.home_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role_text text NOT NULL,
  quote text NOT NULL,
  initials text NOT NULL,
  rating int NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  is_active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.home_testimonials TO anon, authenticated;
GRANT ALL ON public.home_testimonials TO service_role;

ALTER TABLE public.home_testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone read active testimonials" ON public.home_testimonials;
CREATE POLICY "anyone read active testimonials" ON public.home_testimonials FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "admins manage testimonials" ON public.home_testimonials;
CREATE POLICY "admins manage testimonials" ON public.home_testimonials FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));

DROP TRIGGER IF EXISTS home_testimonials_updated ON public.home_testimonials;
CREATE TRIGGER home_testimonials_updated BEFORE UPDATE ON public.home_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.home_testimonials (name, role_text, quote, initials, sort)
SELECT * FROM (VALUES
  ('Sunil Verma', 'Delivery Rider • Noida, UP', 'Earlier agents asked for ₹2,000 just for interview passes. On JobsKart I directly called the Swiggy hub manager in Noida and joined as a rider within 24 hours. My first month salary was credited directly to my bank.', 'SV', 1),
  ('Pooja Jadhav', 'Retail Executive • Thane, Mumbai', 'The filter by neighbourhood helped me find a store executive role just 1.5 km from my home in Thane. The app works fast even on 4G, and the verification badge gave me confidence that the company was genuine.', 'PJ', 2),
  ('Anand Kulkarni', 'Warehouse Sorter • Bhiwandi, MH', 'I applied for Warehouse Sorter role at Flipkart Bhiwandi. Got an interview call within 30 minutes! Salary structure with overtime allowance was clearly listed upfront. Very transparent platform.', 'AK', 3)
) AS seed(name, role_text, quote, initials, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.home_testimonials);

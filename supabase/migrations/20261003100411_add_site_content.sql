-- Super-admin-editable public site content (currently: contact details shown in the home page Contact Us section).
CREATE TABLE IF NOT EXISTS public.site_content (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.site_content TO anon, authenticated;
GRANT ALL ON public.site_content TO service_role;
GRANT INSERT, UPDATE ON public.site_content TO authenticated;

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone read site content" ON public.site_content;
CREATE POLICY "anyone read site content" ON public.site_content FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "admins manage site content" ON public.site_content;
CREATE POLICY "admins manage site content" ON public.site_content FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));

DROP TRIGGER IF EXISTS site_content_updated ON public.site_content;
CREATE TRIGGER site_content_updated BEFORE UPDATE ON public.site_content
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.site_content (key, value) VALUES (
  'contact',
  '{"phone":"+91 90000 00001","email":"test@jobskart.in","whatsapp":"+91 90000 00002","address":"Test office, Sector 00, City, State - 000000","hours":"Mon – Sat, 9:30 AM – 7:00 PM IST"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

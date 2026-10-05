-- Contact Us form submissions from the public home page. Anyone may insert; only platform super_admins can read or update.
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT ALL ON public.contact_messages TO service_role;
GRANT SELECT, UPDATE ON public.contact_messages TO authenticated;

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone submit contact message" ON public.contact_messages;
CREATE POLICY "anyone submit contact message" ON public.contact_messages FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(name) BETWEEN 2 AND 100 AND char_length(message) BETWEEN 10 AND 2000);

DROP POLICY IF EXISTS "admins read contact messages" ON public.contact_messages;
CREATE POLICY "admins read contact messages" ON public.contact_messages FOR SELECT TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admins update contact messages" ON public.contact_messages;
CREATE POLICY "admins update contact messages" ON public.contact_messages FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));

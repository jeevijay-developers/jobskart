-- Certificate generation for certifications.
--   * certifications.certificate_enabled / certificate_config  – admin configuration
--     (template + logo + signatures are Storage paths in the private "certificates" bucket;
--      validity reuses the existing certifications.validity_months).
--   * public.certificates – one row per EARNED certificate (unique per candidate + certification).
--     certificate_file_url holds the generated PDF's Storage path (never a public URL).
--   * private "certificates" bucket:  templates/…  assets/…  generated/<candidate_id>/<certificate_id>.pdf
-- Additive only; existing certifications keep working with certificates disabled.

ALTER TABLE public.certifications
  ADD COLUMN IF NOT EXISTS certificate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id text NOT NULL UNIQUE,
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.cert_attempts(id) ON DELETE SET NULL,
  candidate_name text NOT NULL,
  course_name text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  issued_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  certificate_file_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, certification_id)
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
-- Rows are written only by the server (service role) when an exam is passed.
GRANT ALL ON public.certificates TO service_role;
GRANT SELECT ON public.certificates TO authenticated;

DROP POLICY IF EXISTS "Candidates read own certificates" ON public.certificates;
CREATE POLICY "Candidates read own certificates" ON public.certificates
  FOR SELECT TO authenticated USING (candidate_id = auth.uid());

DROP POLICY IF EXISTS "Admins read certificates" ON public.certificates;
CREATE POLICY "Admins read certificates" ON public.certificates
  FOR SELECT TO authenticated USING (public.has_platform_role(auth.uid(), 'super_admin'));

-- Private bucket for templates, branding assets and generated PDFs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('certificates', 'certificates', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Admins manage templates/assets (and can read everything for support).
DROP POLICY IF EXISTS "Admins manage certificate files" ON storage.objects;
CREATE POLICY "Admins manage certificate files" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'certificates' AND public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (bucket_id = 'certificates' AND public.has_platform_role(auth.uid(), 'super_admin'));

-- A candidate may read only their own generated PDFs: generated/<their uid>/…
DROP POLICY IF EXISTS "Candidates read own generated certificates" ON storage.objects;
CREATE POLICY "Candidates read own generated certificates" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (storage.foldername(name))[1] = 'generated'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- 1. Fixed search_path on slugify
CREATE OR REPLACE FUNCTION public.slugify(_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT regexp_replace(lower(trim(_text)), '[^a-z0-9]+', '-', 'g');
$$;

-- 2. Lock down privileged SECURITY DEFINER functions (server/trigger use only)
REVOKE EXECUTE ON FUNCTION public.apply_credit_delta(uuid, integer, credit_txn_kind, jsonb, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_candidate(uuid, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_credit_pack_invoice(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_employer_activity(uuid, uuid, text, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.find_auth_user_by_phone_or_email(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_grant_seeded_admin() FROM anon, authenticated;

-- Authenticated-only surfaces (drop anon access)
REVOKE EXECUTE ON FUNCTION public.accept_invite(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_invite_by_token(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_company_with_owner(text, text, company_size, text, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_member_role(uuid, uuid, employer_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_download(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_whatsapp_send(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_verification(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_launch_state(text) FROM anon;

-- 3. Replace always-true write policies
DROP POLICY IF EXISTS "Anyone can submit a job report" ON public.job_reports;
CREATE POLICY "Signed-in users can report a job" ON public.job_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND char_length(reason) BETWEEN 2 AND 200 AND (details IS NULL OR char_length(details) <= 2000));

DROP POLICY IF EXISTS "Anyone can submit contact message" ON public.contact_messages;
CREATE POLICY "Anyone can submit a validated contact message" ON public.contact_messages
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(btrim(name)) BETWEEN 2 AND 120
    AND email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
    AND char_length(email) <= 200
    AND char_length(btrim(body)) BETWEEN 5 AND 5000
    AND (subject IS NULL OR char_length(subject) <= 200)
  );

-- Notifications are inserted by SECURITY DEFINER triggers; no direct client inserts.
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;

-- 4. Companies: stop exposing tax IDs / internal verification data
REVOKE SELECT ON public.companies FROM anon, authenticated;
GRANT SELECT (
  id, name, company_type, industry, size, website, logo_url, description,
  primary_city, pincode, is_verified, created_by, created_at, updated_at,
  cover_url, about, founded_year, hq_city, slug, verification_status,
  social_links, onboarding_completed, is_consultant, allow_brand_display
) ON public.companies TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_company_private(_company_id uuid)
RETURNS TABLE(gst_number text, pan_number text, verification_notes text, spam_suspected boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.gst_number, c.pan_number, c.verification_notes, c.spam_suspected
  FROM public.companies c
  WHERE c.id = _company_id
    AND public.has_company_membership(auth.uid(), c.id);
$$;

REVOKE EXECUTE ON FUNCTION public.get_company_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_private(uuid) TO authenticated, service_role;
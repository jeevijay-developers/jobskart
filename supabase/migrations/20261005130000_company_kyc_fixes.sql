-- KYC & verification fixes.
--
-- 1) company-docs storage policies. The subquery reads FROM public.companies c,
--    which has a `name` column, so the unqualified `name` in
--    storage.foldername(name) bound to companies.name instead of
--    storage.objects.name. The folder check compared a company id against the
--    folder of its name, was always false, and every company document upload
--    (including Manual KYC) was rejected by RLS. Qualify the column explicitly.
--
-- 2) Platform super admins need to open uploaded KYC documents from the KYC
--    queue (createSignedUrl needs a SELECT policy), but they are not company
--    members, so the member-only read policy blocked them.
--
-- 3) admin_set_verification() now also sets companies.is_verified (the flag job
--    listings read), notifies the company's active members in-app, and writes an
--    employer_activity row. Approving any one method (GST/PAN/CIN, business email,
--    or manual KYC) marks the company verified.

DROP POLICY IF EXISTS "Members read company docs" ON storage.objects;
DROP POLICY IF EXISTS "Members write company docs" ON storage.objects;
DROP POLICY IF EXISTS "Members delete company docs" ON storage.objects;

CREATE POLICY "Members read company docs" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(storage.objects.name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );

CREATE POLICY "Members write company docs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(storage.objects.name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );

CREATE POLICY "Members delete company docs" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(storage.objects.name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );

DROP POLICY IF EXISTS "Platform admins read company docs" ON storage.objects;
CREATE POLICY "Platform admins read company docs" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'company-docs' AND public.has_platform_role(auth.uid(), 'super_admin')
  );

CREATE OR REPLACE FUNCTION public.admin_set_verification(_id uuid, _status text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid uuid;
  _method text;
  _company_name text;
  _method_label text;
  _title text;
  _body text;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- Only a pending submission can be decided, so a double click can't send
  -- the notification twice.
  UPDATE public.company_verifications
     SET status = _status::public.kyc_status,
         notes = COALESCE(NULLIF(_notes, ''), notes),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = _id AND status = 'pending'
  RETURNING company_id, method::text INTO _cid, _method;

  IF _cid IS NULL THEN
    RAISE EXCEPTION 'verification_not_pending';
  END IF;

  SELECT name INTO _company_name FROM public.companies WHERE id = _cid;
  _method_label := CASE _method
    WHEN 'gst' THEN 'GST / PAN / CIN'
    WHEN 'email' THEN 'business email'
    ELSE 'manual KYC'
  END;

  IF _status = 'verified' THEN
    UPDATE public.companies
       SET verification_status = 'verified', is_verified = true
     WHERE id = _cid;
    _title := 'Company verified';
    _body := 'Your ' || _method_label || ' verification for ' || COALESCE(_company_name, 'your company') || ' was approved. Your company now shows a Verified badge.';
  ELSE
    -- A rejected submission must not un-verify a company that another method
    -- already verified.
    IF NOT EXISTS (
      SELECT 1 FROM public.company_verifications
       WHERE company_id = _cid AND status = 'verified'
    ) THEN
      UPDATE public.companies
         SET verification_status = 'rejected', is_verified = false
       WHERE id = _cid;
    END IF;
    _title := 'Verification rejected';
    _body := 'Your ' || _method_label || ' verification for ' || COALESCE(_company_name, 'your company') || ' was rejected.'
      || CASE WHEN NULLIF(_notes, '') IS NOT NULL THEN ' Reason: ' || _notes ELSE '' END;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT em.user_id,
         'verification.' || _status,
         _title,
         _body,
         '/employer/verification'
    FROM public.employer_members em
   WHERE em.company_id = _cid AND em.status = 'active';

  PERFORM public.log_employer_activity(
    _cid, auth.uid(), 'verification.' || _status, _title, _body, '/employer/verification',
    jsonb_build_object('verification_id', _id, 'method', _method)
  );
END $$;

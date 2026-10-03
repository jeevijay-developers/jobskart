-- WhatsApp-centric UX, Phase 5: employer-side WhatsApp (D10). Closes
-- README's "Call Now + WhatsApp button after unlock" promise. See
-- whatsapp-centric-ux-implementation-improved.md for the full design.

-- Logs an employer's outbound WhatsApp click against an unlocked candidate,
-- enforcing the same per-post cap (D6/assert_whatsapp_post_cap, built in
-- Phase 1) that would apply to an automated send. Returns the candidate's
-- WhatsApp number so the caller can build the wa.me link — the frontend
-- never has this number on its own; it only reaches the browser once this
-- RPC (or unlock_candidate) returns it, same leakage-protection rule as
-- phone/email (CLAUDE.md rule 3).
CREATE OR REPLACE FUNCTION public.log_employer_whatsapp_outreach(
  _company_id uuid, _job_id uuid, _candidate_user_id uuid, _actor uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _number text;
  _opt_in boolean;
  _status text;
  _job_title text;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  -- Contact is "free" either because the candidate was paid-unlocked from the
  -- DB search (candidate_unlocks), or because they applied to this company's
  -- own job directly (applications never sit behind the unlock paywall).
  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_unlocks
    WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE j.company_id = _company_id AND a.candidate_id = _candidate_user_id
  ) THEN
    RAISE EXCEPTION 'candidate_not_unlocked';
  END IF;

  SELECT whatsapp_number, whatsapp_opt_in, whatsapp_number_status
    INTO _number, _opt_in, _status
  FROM public.candidate_profiles WHERE user_id = _candidate_user_id;

  IF _number IS NULL OR NOT _opt_in OR _status = 'invalid' THEN
    RAISE EXCEPTION 'whatsapp_unavailable';
  END IF;

  -- Raises on cap/Rajasthan-gate breach — propagates to the caller as-is.
  PERFORM public.assert_whatsapp_post_cap(_job_id, _candidate_user_id);

  SELECT title INTO _job_title FROM public.jobs WHERE id = _job_id;

  INSERT INTO public.whatsapp_messages
    (recipient_user, recipient_number, category, source, reference, provider, status, sent_at)
  VALUES (
    _candidate_user_id, _number, 'utility', 'employer_outreach',
    jsonb_build_object('job_id', _job_id, 'company_id', _company_id),
    'employer_device', 'sent', now()
  );

  PERFORM public.log_employer_activity(
    _company_id, _actor, 'whatsapp_outreach',
    'Messaged a candidate on WhatsApp',
    COALESCE(_job_title, 'a job'),
    NULL,
    jsonb_build_object('job_id', _job_id, 'candidate_user_id', _candidate_user_id)
  );

  RETURN _number;
END $$;
REVOKE ALL ON FUNCTION public.log_employer_whatsapp_outreach(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_employer_whatsapp_outreach(uuid, uuid, uuid, uuid) TO authenticated;

-- Lets a member set their OWN WhatsApp number/consent for a company they
-- belong to — the blanket "Super admins can update team memberships" UPDATE
-- policy on employer_members (20260617103716) only lets super_admins write
-- this table, which is right for role/status but wrong for a member's own
-- notification preferences. auth.uid() is always the row being changed, so
-- no privilege check beyond membership existing is needed.
CREATE OR REPLACE FUNCTION public.set_my_employer_whatsapp(
  _company_id uuid, _number text, _opt_in boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.employer_members
  SET whatsapp_number = _number, whatsapp_opt_in = _opt_in
  WHERE company_id = _company_id AND user_id = _uid AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_my_employer_whatsapp(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_employer_whatsapp(uuid, text, boolean) TO authenticated;

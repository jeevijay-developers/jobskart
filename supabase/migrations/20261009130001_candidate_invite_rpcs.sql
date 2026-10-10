-- Rewrites invite_candidate_to_apply() to charge credits_per_invite from the
-- company's contact_balance (same pool as Unlock Profile) on the FIRST invite
-- to a given candidate for a given job; repeat invites for that same pair are
-- free. Return type changes from void to jsonb so the caller (the
-- inviteCandidateToApply server fn) knows whether this was a fresh charge
-- (so a total delivery failure should trigger refund_candidate_invite) or a
-- free resend (so it should not).

DROP FUNCTION IF EXISTS public.invite_candidate_to_apply(uuid, uuid, text);

CREATE FUNCTION public.invite_candidate_to_apply(
  _job_id              uuid,
  _candidate_user_id   uuid,
  _message             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id   uuid;
  _company_name text;
  _job_title    text;
  _cost         int;
  _invite_id    uuid;
  _is_new       boolean := false;
BEGIN
  -- Validate job and company membership
  SELECT j.company_id, j.title, c.name
    INTO _company_id, _job_title, _company_name
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    WHERE j.id = _job_id AND j.status = 'active';

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT credits_per_invite INTO _cost FROM public.plan_settings WHERE id = 1;
  _cost := COALESCE(_cost, 2);

  -- Atomic dedupe: only a genuinely new (job, candidate) pair gets charged.
  INSERT INTO public.candidate_invites (company_id, job_id, candidate_user_id, invited_by, credits_spent)
    VALUES (_company_id, _job_id, _candidate_user_id, auth.uid(), _cost)
    ON CONFLICT (job_id, candidate_user_id) DO NOTHING
    RETURNING id INTO _invite_id;

  IF _invite_id IS NOT NULL THEN
    _is_new := true;
    BEGIN
      PERFORM public.apply_credit_delta(
        _company_id, -_cost, 'invite'::public.credit_txn_kind,
        jsonb_build_object('invite_id', _invite_id, 'candidate_user_id', _candidate_user_id, 'job_id', _job_id),
        auth.uid(), 'contact'::public.benefit_type
      );
    EXCEPTION WHEN OTHERS THEN
      DELETE FROM public.candidate_invites WHERE id = _invite_id;
      IF SQLERRM = 'Insufficient credits' THEN
        RAISE EXCEPTION 'no_credits';
      END IF;
      RAISE;
    END;
  ELSE
    SELECT id INTO _invite_id FROM public.candidate_invites
      WHERE job_id = _job_id AND candidate_user_id = _candidate_user_id;
    _cost := 0;
  END IF;

  -- Send in-app notification to candidate (every click, charged or not)
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _candidate_user_id,
    'candidate.invited_to_apply',
    _company_name || ' invited you to apply',
    COALESCE(
      _message,
      _company_name || ' thinks you''re a great fit for "' || _job_title || '". Apply now!'
    ),
    '/jobs/' || _job_id::text
  );

  -- Log to activity feed
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'candidate.invited_to_apply',
    'Candidate invited to apply',
    'Invited to "' || _job_title || '"' ||
      CASE WHEN _is_new THEN ' (' || _cost || ' credits)' ELSE ' (resend, free)' END,
    '/employer/jobs/' || _job_id::text || '/applicants',
    jsonb_build_object(
      'candidate_user_id', _candidate_user_id, 'job_id', _job_id,
      'invite_id', _invite_id, 'credits_spent', _cost, 'is_new', _is_new
    )
  );

  RETURN jsonb_build_object(
    'invite_id', _invite_id, 'is_new', _is_new, 'credits_spent', _cost,
    'job_title', _job_title, 'company_name', _company_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_candidate_to_apply(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_candidate_to_apply(uuid, uuid, text) TO authenticated;

-- System-triggered refund: called (service_role only) by the
-- inviteCandidateToApply server fn when both email and WhatsApp delivery
-- fail for a freshly-charged invite. Modeled on admin_refund_job_post_credit's
-- idempotency/refund shape, minus the admin-role check since this is an
-- automated outcome, not an admin action.
CREATE OR REPLACE FUNCTION public.refund_candidate_invite(_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row     public.candidate_invites%ROWTYPE;
  _balance int;
BEGIN
  SELECT * INTO _row FROM public.candidate_invites WHERE id = _invite_id FOR UPDATE;
  IF _row IS NULL THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF _row.refunded OR _row.credits_spent = 0 THEN
    RETURN jsonb_build_object('already_refunded', true);
  END IF;

  _balance := public.apply_credit_delta(
    _row.company_id, _row.credits_spent, 'refund'::public.credit_txn_kind,
    jsonb_build_object('refund_of_invite_id', _invite_id), _row.invited_by,
    'contact'::public.benefit_type
  );

  UPDATE public.candidate_invites SET refunded = true WHERE id = _invite_id;

  PERFORM public.log_employer_activity(
    _row.company_id, _row.invited_by, 'credits.refunded', 'Invite credit refunded',
    'Could not reach candidate by email or WhatsApp', '/employer/credits',
    jsonb_build_object('invite_id', _invite_id, 'amount', _row.credits_spent)
  );

  RETURN jsonb_build_object('already_refunded', false, 'refunded', _row.credits_spent, 'balance_after', _balance);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_candidate_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_candidate_invite(uuid) TO service_role;

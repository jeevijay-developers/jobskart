-- Admin-initiated job-post-credit refund (see
-- employer-monetization-detailed-implementation-plan.md Phase 1, Task 1.9).
--
-- The strategy doc's packs policy says "refund a credit automatically if
-- JobsKart rejects the job before it becomes active." No such state can
-- exist today: activate_job_with_tier() charges the credit and flips the
-- job to 'active' in the same atomic call — a job is never "charged but
-- pending review". Building a real pre-activation moderation queue is a
-- separate, larger feature, out of scope here.
--
-- This is the minimal viable refund path that CAN exist today: an admin
-- refunding a job-post credit for an already-charged, already-active job
-- that Platform Admin later closes for a policy violation.

CREATE OR REPLACE FUNCTION public.admin_refund_job_post_credit(_job_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _tier_source text;
  _title text;
  _debited_delta int;
  _already_refunded boolean;
  _balance int;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT company_id, tier_source, title INTO _company_id, _tier_source, _title
    FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF _tier_source IS DISTINCT FROM 'credits' THEN
    -- Plan-quota-sourced post: nothing was charged, nothing to refund.
    RAISE EXCEPTION 'no_credit_charge_to_refund';
  END IF;

  -- Idempotency guard: a second refund attempt for the same job is a no-op.
  SELECT EXISTS(
    SELECT 1 FROM public.credit_transactions
    WHERE kind = 'refund' AND reference->>'refund_of_job_post_job_id' = _job_id::text
  ) INTO _already_refunded;
  IF _already_refunded THEN
    SELECT job_post_balance INTO _balance FROM public.employer_credit_wallets WHERE company_id = _company_id;
    RETURN jsonb_build_object('already_refunded', true, 'balance_after', COALESCE(_balance, 0));
  END IF;

  -- Find the exact amount originally debited for this job's post.
  SELECT -delta INTO _debited_delta
    FROM public.credit_transactions
    WHERE kind = 'job_post' AND reference->>'job_id' = _job_id::text
    ORDER BY created_at DESC
    LIMIT 1;
  IF _debited_delta IS NULL OR _debited_delta <= 0 THEN
    RAISE EXCEPTION 'no_credit_charge_to_refund';
  END IF;

  _balance := public.apply_credit_delta(
    _company_id, _debited_delta, 'refund'::public.credit_txn_kind,
    jsonb_build_object('refund_of_job_post_job_id', _job_id, 'reason', _reason), auth.uid(),
    'job_post'::public.benefit_type
  );

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'credits.refunded', 'Job post credit refunded',
    _title, '/employer/credits',
    jsonb_build_object('job_id', _job_id, 'amount', _debited_delta, 'reason', _reason)
  );

  RETURN jsonb_build_object('already_refunded', false, 'refunded', _debited_delta, 'balance_after', _balance);
END $$;

REVOKE ALL ON FUNCTION public.admin_refund_job_post_credit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_job_post_credit(uuid, text) TO service_role;

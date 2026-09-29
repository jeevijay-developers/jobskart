-- Tag refunds correctly in the new benefit ledger.
-- ============================================================
--
-- apply_credit_delta()'s dual-write (20260928130006_benefit_grants_and_ledger.sql)
-- mirrors every positive delta as a 'grant' ledger event, regardless of
-- _kind. A refund (e.g. admin_refund_job_post_credit()) is a positive delta
-- with _kind='refund', so today it's recorded as event='grant' in the new
-- ledger — reconciliation still balances correctly (the arithmetic is
-- right), but Section 11's acceptance checklist explicitly wants ledger
-- reconciliation and support explanations to work "across ... refund" as
-- its own distinguishable event, not indistinguishable from an ordinary
-- purchase/trial grant.
--
-- Fix: grant_company_benefit() takes an optional _event parameter (still
-- defaulting to 'grant', so every existing caller is unaffected), and
-- apply_credit_delta() passes 'refund' through when _kind = 'refund'.

CREATE OR REPLACE FUNCTION public.grant_company_benefit(
  _company_id uuid,
  _benefit_type public.benefit_type,
  _quantity int,
  _validity_days int DEFAULT NULL,
  _source text DEFAULT 'admin_adjustment',
  _reference jsonb DEFAULT '{}'::jsonb,
  _actor uuid DEFAULT NULL,
  _event text DEFAULT 'grant'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _grant_id uuid;
  _expires timestamptz;
BEGIN
  IF _quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  IF _event NOT IN ('grant', 'refund') THEN
    RAISE EXCEPTION 'invalid_event';
  END IF;
  _expires := CASE WHEN _validity_days IS NULL THEN NULL ELSE now() + (_validity_days || ' days')::interval END;

  INSERT INTO public.company_benefit_grants
      (company_id, benefit_type, quantity, remaining, source, expires_at, reference, created_by)
    VALUES (_company_id, _benefit_type, _quantity, _quantity, _source, _expires, _reference, _actor)
    RETURNING id INTO _grant_id;

  INSERT INTO public.company_benefit_ledger
      (company_id, benefit_type, event, delta, grant_id, reference, created_by)
    VALUES (_company_id, _benefit_type, _event, _quantity, _grant_id, _reference, _actor);

  RETURN _grant_id;
END $$;

REVOKE ALL ON FUNCTION public.grant_company_benefit(uuid, public.benefit_type, int, int, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_company_benefit(uuid, public.benefit_type, int, int, text, jsonb, uuid, text) TO service_role;

-- apply_credit_delta(): pass 'refund' through when _kind = 'refund'. Every
-- other line is unchanged from 20260928130006_benefit_grants_and_ledger.sql.
CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  _company_id uuid,
  _delta int,
  _kind public.credit_txn_kind,
  _reference jsonb DEFAULT NULL,
  _actor uuid DEFAULT NULL,
  _benefit_type public.benefit_type DEFAULT 'job_post'
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance int;
  _col text;
BEGIN
  INSERT INTO public.employer_credit_wallets (company_id, job_post_balance)
    VALUES (_company_id, 0)
    ON CONFLICT (company_id) DO NOTHING;

  _col := CASE _benefit_type
    WHEN 'job_post' THEN 'job_post_balance'
    WHEN 'contact' THEN 'contact_balance'
    WHEN 'boost' THEN 'boost_balance'
  END;

  EXECUTE format(
    'UPDATE public.employer_credit_wallets SET %I = %I + $1, updated_at = now() WHERE company_id = $2 RETURNING %I',
    _col, _col, _col
  ) INTO _new_balance USING _delta, _company_id;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, reference, created_by, benefit_type)
    VALUES (_company_id, _kind, _delta, _new_balance, _reference, _actor, _benefit_type);

  BEGIN
    IF _delta > 0 THEN
      PERFORM public.grant_company_benefit(
        _company_id, _benefit_type, _delta, NULL,
        'apply_credit_delta:' || _kind::text, COALESCE(_reference, '{}'::jsonb), _actor,
        CASE WHEN _kind = 'refund' THEN 'refund' ELSE 'grant' END
      );
    ELSIF _delta < 0 THEN
      PERFORM public.consume_company_benefit(
        _company_id, _benefit_type, -_delta, NULL,
        COALESCE(_reference, '{}'::jsonb) || jsonb_build_object('via', 'apply_credit_delta', 'kind', _kind::text), _actor
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'benefit ledger mirror failed for company % (% %): %', _company_id, _kind, _benefit_type, SQLERRM;
  END;

  RETURN _new_balance;
END $$;

REVOKE ALL ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_delta(uuid, int, public.credit_txn_kind, jsonb, uuid, public.benefit_type) TO service_role;

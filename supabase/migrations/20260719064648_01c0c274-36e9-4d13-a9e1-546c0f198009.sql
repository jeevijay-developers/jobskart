
CREATE OR REPLACE FUNCTION public.unlock_candidate(_company_id uuid, _candidate_user_id uuid, _actor uuid DEFAULT NULL::uuid)
 RETURNS TABLE(already_unlocked boolean, balance_after integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _exists boolean; _bal int; _cost int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.candidate_unlocks
                WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id) INTO _exists;
  IF _exists THEN
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    RETURN QUERY SELECT true, COALESCE(_bal, 0);
    RETURN;
  END IF;
  SELECT COALESCE(credits_per_unlock, 5) INTO _cost FROM public.plan_settings WHERE id = 1;
  IF _cost IS NULL THEN _cost := 5; END IF;
  _bal := public.apply_credit_delta(
    _company_id, -_cost, 'unlock'::public.credit_txn_kind,
    jsonb_build_object('candidate_user_id', _candidate_user_id, 'credits_spent', _cost), _actor
  );
  INSERT INTO public.candidate_unlocks (company_id, candidate_user_id, unlocked_by, credits_spent)
    VALUES (_company_id, _candidate_user_id, _actor, _cost);
  RETURN QUERY SELECT false, _bal;
END $function$;

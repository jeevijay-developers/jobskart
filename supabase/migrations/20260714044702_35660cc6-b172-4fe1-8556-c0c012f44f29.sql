CREATE OR REPLACE FUNCTION public.create_company_with_owner(_name text, _industry text, _size company_size, _hq_city text, _website text, _about text, _founded_year integer, _gst text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _cid uuid; _existing int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.companies (name, industry, size, hq_city, primary_city, website, about, founded_year, gst_number, created_by, onboarding_completed)
    VALUES (_name, NULLIF(_industry,''), _size, NULLIF(_hq_city,''), NULLIF(_hq_city,''), NULLIF(_website,''), NULLIF(_about,''), _founded_year, NULLIF(_gst,''), _uid, true)
    RETURNING id INTO _cid;
  INSERT INTO public.employer_members (user_id, company_id, role) VALUES (_uid, _cid, 'super_admin')
    ON CONFLICT (user_id, company_id) DO NOTHING;
  INSERT INTO public.employer_credit_wallets (company_id, balance) VALUES (_cid, 0)
    ON CONFLICT (company_id) DO NOTHING;
  -- Trial credits: only if wallet has never received a grant before
  SELECT count(*) INTO _existing FROM public.credit_transactions WHERE company_id = _cid AND kind = 'grant';
  IF _existing = 0 THEN
    PERFORM public.apply_credit_delta(_cid, 5, 'grant'::public.credit_txn_kind,
      jsonb_build_object('reason','welcome_trial'), _uid);
  END IF;
  RETURN _cid;
END $function$;
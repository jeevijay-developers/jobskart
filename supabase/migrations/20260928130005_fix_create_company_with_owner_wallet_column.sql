-- Fix: create_company_with_owner() → 42703 "column \"balance\" of relation
-- \"employer_credit_wallets\" does not exist"
-- ============================================================
--
-- 20260928061654_benefit_type_split.sql renamed
-- employer_credit_wallets.balance -> job_post_balance but never updated this
-- function's own `INSERT INTO employer_credit_wallets (company_id, balance)`
-- line, which still targets the now-gone column name. Since that INSERT runs
-- unconditionally on every employer signup, EVERY new employer company
-- creation has been failing since that migration landed (confirmed live: a
-- real signed-in employer calling this RPC gets exactly this 42703 error).
--
-- Fix: drop this function's own wallet-row insert entirely. It's redundant
-- anyway — apply_credit_delta() already does
-- `INSERT INTO employer_credit_wallets (company_id, job_post_balance)
--  VALUES (_company_id, 0) ON CONFLICT (company_id) DO NOTHING` on every
-- call, including the welcome-trial grant a few lines below, so the wallet
-- row is still guaranteed to exist before it's ever read. No other behavior
-- changes.

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
  -- Trial credits: only if wallet has never received a grant before
  SELECT count(*) INTO _existing FROM public.credit_transactions WHERE company_id = _cid AND kind = 'grant';
  IF _existing = 0 THEN
    PERFORM public.apply_credit_delta(_cid, 5, 'grant'::public.credit_txn_kind,
      jsonb_build_object('reason','welcome_trial'), _uid);
  END IF;
  RETURN _cid;
END $function$;

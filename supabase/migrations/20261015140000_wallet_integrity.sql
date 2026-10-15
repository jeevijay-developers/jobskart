-- Wallet integrity: the database itself refuses negative balances (previously only an IF inside
-- apply_credit_delta did). Added NOT VALID first so existing rows never block the deploy, then
-- validated; a failed validation is reported but does not abort (bad rows need a human).
-- See prompt structure/credits-wallet-correction.md (P5). Re-runnable.

DO $$
DECLARE _c text; _cols text[] := ARRAY['job_post_balance', 'contact_balance', 'boost_balance'];
BEGIN
  FOREACH _c IN ARRAY _cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.employer_credit_wallets'::regclass AND conname = 'employer_credit_wallets_' || _c || '_nonneg'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.employer_credit_wallets ADD CONSTRAINT %I CHECK (%I >= 0) NOT VALID',
        'employer_credit_wallets_' || _c || '_nonneg', _c);
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.employer_credit_wallets VALIDATE CONSTRAINT %I', 'employer_credit_wallets_' || _c || '_nonneg');
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'employer_credit_wallets.% has negative rows; constraint left NOT VALID until they are fixed', _c;
    END;
  END LOOP;
END $$;

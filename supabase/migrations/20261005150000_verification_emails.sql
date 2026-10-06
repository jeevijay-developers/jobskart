-- Employer business email + verification emails.
--
-- 1) companies.business_email: the official work email entered at employer
--    signup. Verification emails go here (plus the submitter's login email).
-- 2) A trigger on company_verifications calls the verification-notify Edge
--    Function via pg_net:
--      * on INSERT                         -> event 'submitted'
--      * on UPDATE of status to verified/rejected -> event 'verified' / 'rejected'
--    Same pattern as application-received-notify. Failures are logged as a
--    warning and never block the verification insert or the admin decision.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS business_email text;

CREATE OR REPLACE FUNCTION public.tg_company_verifications_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event := 'submitted';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('verified', 'rejected') THEN
    _event := NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/verification-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := jsonb_build_object('verificationId', NEW.id, 'event', _event)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'verification-notify enqueue failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS company_verifications_notify_insert ON public.company_verifications;
CREATE TRIGGER company_verifications_notify_insert
  AFTER INSERT ON public.company_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_verifications_notify();

DROP TRIGGER IF EXISTS company_verifications_notify_update ON public.company_verifications;
CREATE TRIGGER company_verifications_notify_update
  AFTER UPDATE OF status ON public.company_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_company_verifications_notify();

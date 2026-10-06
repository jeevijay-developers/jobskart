-- Instant GST verification: the gst-verify Edge Function can insert a row that
-- is already 'verified'. The notify trigger must then send the approval email,
-- not the "submitted" one. Everything else in tg_company_verifications_notify
-- stays the same (see 20261005150000_verification_emails.sql).

CREATE OR REPLACE FUNCTION public.tg_company_verifications_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'verified' THEN
      _event := 'verified';
    ELSE
      _event := 'submitted';
    END IF;
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

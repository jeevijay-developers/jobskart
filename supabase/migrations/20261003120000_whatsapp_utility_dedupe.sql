-- WhatsApp hardening: application_status_update and interview_scheduled sends
-- had no dedup guard — sendWhatsappForEvent() logged the whatsapp_messages
-- row only AFTER calling the provider, so a duplicate invocation (client
-- double-click, network retry re-firing the fire-and-forget edge function
-- call) would send the same WhatsApp message twice before the dedup check
-- ever ran. alert-instant-notify/alert-digest already avoided this because
-- their caller inserts into alert_job_notifications (a separate dedup table)
-- BEFORE calling sendWhatsappForEvent at all.
--
-- Fix: a generic dedupe_key column, claimed with an INSERT before the send
-- (not after), so a second concurrent/retried call hits the unique
-- constraint and never reaches the provider at all.
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_dedupe_key ON public.whatsapp_messages(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- "Invite to Apply" becomes a paid, delivered action: it now costs credits
-- (same contact_balance pool as Unlock Profile) and the caller learns whether
-- this is a fresh charge or a free resend, so the edge function that actually
-- sends email+WhatsApp (supabase/functions/send-candidate-invite-to-apply)
-- knows whether a delivery failure should trigger a refund.
-- See CLAUDE.md: schema changes land only as new migration files.

ALTER TYPE public.credit_txn_kind ADD VALUE IF NOT EXISTS 'invite';

ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS credits_per_invite integer NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS public.candidate_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid,
  credits_spent int NOT NULL DEFAULT 0,
  refunded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_user_id)
);

ALTER TABLE public.candidate_invites ENABLE ROW LEVEL SECURITY;
-- No direct client SELECT/INSERT/UPDATE policies: all access goes through the
-- SECURITY DEFINER functions below, same pattern as employer_invites / candidate_deletion_requests.

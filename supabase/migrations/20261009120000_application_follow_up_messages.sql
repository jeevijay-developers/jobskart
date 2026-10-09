-- Follow-up conversation thread attached to a candidate's application: the
-- candidate's "Follow up with employer" dialog (My Applications) writes
-- sender_role = 'candidate' rows here; the employer Inbox (/employer/inbox)
-- reads/replies with sender_role = 'employer'. One row per application = one
-- chat, matching "one candidate on one job".
CREATE TABLE IF NOT EXISTS public.application_follow_up_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('candidate', 'employer')),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_application_follow_up_messages_application
  ON public.application_follow_up_messages(application_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.application_follow_up_messages TO authenticated;
GRANT ALL ON public.application_follow_up_messages TO service_role;
ALTER TABLE public.application_follow_up_messages ENABLE ROW LEVEL SECURITY;

-- Candidate: read/insert on their own application only.
DROP POLICY IF EXISTS "candidate reads own application messages" ON public.application_follow_up_messages;
CREATE POLICY "candidate reads own application messages" ON public.application_follow_up_messages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND a.candidate_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "candidate sends own application message" ON public.application_follow_up_messages;
CREATE POLICY "candidate sends own application message" ON public.application_follow_up_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_role = 'candidate'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND a.candidate_id = auth.uid()
    )
  );

-- Employer: read/insert on applications whose job belongs to a company this
-- user is an active member of (same has_company_membership() check used
-- elsewhere for applicant-data access).
DROP POLICY IF EXISTS "employer reads company application messages" ON public.application_follow_up_messages;
CREATE POLICY "employer reads company application messages" ON public.application_follow_up_messages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "employer sends company application message" ON public.application_follow_up_messages;
CREATE POLICY "employer sends company application message" ON public.application_follow_up_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_role = 'employer'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

-- read_at: only the receiving side may mark a message read (the side that did
-- NOT send it) — a candidate marks employer messages read and vice versa.
-- USING = who may touch the row at all; WITH CHECK = the row must still
-- satisfy the same "not the sender" condition after the update.
DROP POLICY IF EXISTS "candidate marks employer messages read" ON public.application_follow_up_messages;
CREATE POLICY "candidate marks employer messages read" ON public.application_follow_up_messages
  FOR UPDATE TO authenticated USING (
    sender_role = 'employer'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND a.candidate_id = auth.uid()
    )
  ) WITH CHECK (sender_role = 'employer');

DROP POLICY IF EXISTS "employer marks candidate messages read" ON public.application_follow_up_messages;
CREATE POLICY "employer marks candidate messages read" ON public.application_follow_up_messages
  FOR UPDATE TO authenticated USING (
    sender_role = 'candidate'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = application_follow_up_messages.application_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  ) WITH CHECK (sender_role = 'candidate');

-- RLS alone can gate which rows an UPDATE may touch, not which columns it
-- may change — a client could otherwise call .update() with read_at AND a
-- rewritten message/sender_id and still pass the two policies above. This
-- trigger rejects any UPDATE that changes a column other than read_at.
CREATE OR REPLACE FUNCTION public.tg_follow_up_messages_only_read_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.sender_role IS DISTINCT FROM OLD.sender_role
    OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
    OR NEW.message IS DISTINCT FROM OLD.message
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only read_at may be updated on application_follow_up_messages';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follow_up_messages_only_read_at ON public.application_follow_up_messages;
CREATE TRIGGER follow_up_messages_only_read_at
  BEFORE UPDATE ON public.application_follow_up_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_follow_up_messages_only_read_at();

-- No delete policy: rows are permanent once sent.

-- Realtime: so a new message / read_at update appears live without a refresh
-- in both the candidate dialog and the employer Inbox.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.application_follow_up_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

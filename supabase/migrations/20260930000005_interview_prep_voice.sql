-- ============================================================
-- Interview prep, part 3: opt-in voice practice (record-and-submit).
-- Audio is transcribed in memory by a server function and is NEVER stored;
-- only the (editable) transcript is kept, as the answer text.
-- ============================================================

-- 1) Explicit, versioned, revocable voice consent -----------------------------
-- The server refuses to accept audio without a row here, so consent is enforced,
-- not just displayed. Revoking = deleting the row.
CREATE TABLE IF NOT EXISTS public.interview_prep_voice_consent (
  candidate_id uuid PRIMARY KEY,
  version int NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interview_prep_voice_consent ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.interview_prep_voice_consent TO authenticated;
GRANT ALL ON public.interview_prep_voice_consent TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_voice_consent' AND policyname='owner select voice consent') THEN
    CREATE POLICY "owner select voice consent" ON public.interview_prep_voice_consent
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner insert voice consent" ON public.interview_prep_voice_consent
      FOR INSERT TO authenticated WITH CHECK (candidate_id = auth.uid());
    CREATE POLICY "owner delete voice consent" ON public.interview_prep_voice_consent
      FOR DELETE TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 2) Answers can now come from speech; keep neutral, coachable metrics only ---
ALTER TABLE public.interview_prep_answers
  ADD COLUMN IF NOT EXISTS voice_metrics jsonb;   -- { duration_sec, wpm, fillers: { word: count } } — no emotion/accent/tone

ALTER TABLE public.interview_prep_answers DROP CONSTRAINT IF EXISTS interview_prep_answers_source_check;
ALTER TABLE public.interview_prep_answers
  ADD CONSTRAINT interview_prep_answers_source_check CHECK (source IN ('typed','voice'));

-- 3) Quota: a third bucket for transcriptions ---------------------------------
ALTER TABLE public.interview_prep_usage_ledger DROP CONSTRAINT IF EXISTS interview_prep_usage_ledger_kind_check;
ALTER TABLE public.interview_prep_usage_ledger
  ADD CONSTRAINT interview_prep_usage_ledger_kind_check CHECK (kind IN ('session','feedback','voice'));

CREATE OR REPLACE FUNCTION public.consume_interview_prep_quota(_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _limit int;
  _used int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('session','feedback','voice') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  _limit := CASE _kind WHEN 'session' THEN 10 WHEN 'voice' THEN 30 ELSE 40 END;   -- per rolling 24h

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':ip:' || _kind, 0));

  SELECT count(*) INTO _used FROM public.interview_prep_usage_ledger
   WHERE candidate_id = _uid AND kind = _kind AND created_at > now() - interval '24 hours';
  IF _used >= _limit THEN RAISE EXCEPTION 'quota_exceeded'; END IF;

  INSERT INTO public.interview_prep_usage_ledger (candidate_id, kind) VALUES (_uid, _kind);
END $$;
REVOKE ALL ON FUNCTION public.consume_interview_prep_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_interview_prep_quota(text) TO authenticated, service_role;

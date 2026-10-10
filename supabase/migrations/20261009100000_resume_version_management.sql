-- Resume version management.
--   * resume_versions.name – optional custom name (NULL = show "Version N"), 1–60 characters.
--   * resume_generation_counts – lifetime number of resumes each candidate has generated. A BEFORE
--     INSERT trigger on resume_versions allows at most 5 per candidate EVER: deleting a version does not
--     give a generation back. The per-user advisory lock serialises concurrent requests, and the
--     counter is only writable by the trigger (SECURITY DEFINER; no client policies).
--     Editing a version (UPDATE), renaming, previewing and downloading never insert, so they never count.
--   * Backfill: existing candidates start at GREATEST(versions held, highest version number ever issued) -
--     the best available record of past generations, since version numbers keep increasing.
-- Additive only.

ALTER TABLE public.resume_versions ADD COLUMN IF NOT EXISTS name text;

DO $$ BEGIN
  ALTER TABLE public.resume_versions
    ADD CONSTRAINT resume_versions_name_length
    CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.resume_generation_counts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0)
);
ALTER TABLE public.resume_generation_counts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.resume_generation_counts TO service_role;
-- No grants/policies for anon/authenticated: clients can neither read nor tamper with the counter.

INSERT INTO public.resume_generation_counts (user_id, total)
SELECT user_id, GREATEST(count(*), max(version_number))
FROM public.resume_versions
GROUP BY user_id
ON CONFLICT (user_id) DO NOTHING;

-- Replaces the earlier "5 versions at once" trigger, if it was ever applied.
DROP TRIGGER IF EXISTS resume_versions_limit ON public.resume_versions;
DROP FUNCTION IF EXISTS public.enforce_resume_version_limit();

CREATE OR REPLACE FUNCTION public.enforce_resume_generation_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _used integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('resume_generations:' || NEW.user_id::text, 0));

  SELECT total INTO _used FROM public.resume_generation_counts WHERE user_id = NEW.user_id;
  IF _used IS NULL THEN
    SELECT GREATEST(count(*), COALESCE(max(version_number), 0)) INTO _used
    FROM public.resume_versions WHERE user_id = NEW.user_id;
  END IF;

  IF _used >= 5 THEN
    RAISE EXCEPTION 'resume_generation_limit';
  END IF;

  INSERT INTO public.resume_generation_counts (user_id, total) VALUES (NEW.user_id, _used + 1)
  ON CONFLICT (user_id) DO UPDATE SET total = EXCLUDED.total;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resume_versions_generation_limit ON public.resume_versions;
CREATE TRIGGER resume_versions_generation_limit
  BEFORE INSERT ON public.resume_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_resume_generation_limit();

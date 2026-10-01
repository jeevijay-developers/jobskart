-- Format-validate profiles.email (mirrors the contact_messages email regex).
-- Not UNIQUE: multiple candidates may legitimately share a family/shared email in this segment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_email_format_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_email_format_check
      CHECK (email IS NULL OR (email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' AND char_length(email) <= 200));
  END IF;
END $$;

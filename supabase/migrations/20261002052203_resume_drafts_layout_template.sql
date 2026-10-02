-- Resume Builder: remember the candidate's chosen template and saved Layout &
-- Design settings across visits (previously they lived only in page state and
-- reset on reload). Separate columns from `extras` so the "Edit Your Resume"
-- save and the "Layout & Design" save can each update their own part of the
-- row independently. Both nullable: NULL means "template defaults".
ALTER TABLE public.resume_drafts
  ADD COLUMN IF NOT EXISTS layout jsonb,
  ADD COLUMN IF NOT EXISTS template_id text;

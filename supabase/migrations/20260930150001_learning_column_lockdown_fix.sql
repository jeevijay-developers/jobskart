-- Fix for 20260930150000: a table-level SELECT grant on course_modules,
-- course_lessons and certifications already existed (Supabase's default
-- privileges for new tables in public grant SELECT to anon/authenticated),
-- which a column-level REVOKE cannot override — Postgres only checks "is
-- there ANY grant, table- or column-level, covering this column", so the
-- broad table grant kept every column readable regardless of the
-- column-level REVOKE that migration added. Confirmed live: a direct
-- `select body_md from course_lessons` / `select questions from
-- certifications` as `authenticated` still succeeded after that migration.
--
-- Fix: revoke the table-level grant entirely, then grant back only the
-- safe columns (already-narrow list — unchanged from 20260930150000).
REVOKE SELECT ON public.course_modules FROM anon, authenticated;
REVOKE SELECT ON public.course_lessons FROM anon, authenticated;
REVOKE SELECT ON public.certifications FROM anon, authenticated;

GRANT SELECT (id, course_id, position, title, kind, free_preview, duration_minutes) ON public.course_modules TO anon, authenticated;
GRANT SELECT (id, module_id, position, title, kind, free_preview, duration_minutes) ON public.course_lessons TO anon, authenticated;
GRANT SELECT (id, price_inr, provider, partner_name, pass_mark, max_attempts, validity_months) ON public.certifications TO anon, authenticated;

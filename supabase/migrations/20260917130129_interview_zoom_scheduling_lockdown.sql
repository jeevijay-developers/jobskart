-- Corrective follow-up to 20260917123602_interview_zoom_scheduling.sql.
--
-- REVOKE EXECUTE ... FROM anon, authenticated alone (the pattern used by
-- apply_credit_delta/unlock_candidate in 20260805034834_...sql) turned out to
-- be insufficient for these 4 new functions: CREATE FUNCTION grants EXECUTE
-- to PUBLIC by default in Postgres, and a direct pg_proc.proacl check showed
-- that PUBLIC grant (`=X/postgres`) persisted even after revoking from
-- anon/authenticated specifically, unlike apply_credit_delta/unlock_candidate
-- which never had a PUBLIC grant to begin with. Verified via
-- has_function_privilege('anon'/'authenticated', ..., 'EXECUTE') returning
-- true before this fix and false after.
REVOKE EXECUTE ON FUNCTION public.reserve_video_interview_slot(
  uuid, timestamptz, int, public.interview_provider, public.interview_mode, text, text, text, text, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attach_zoom_meeting_secrets(
  uuid, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_video_interview(
  uuid, timestamptz, int, text, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_video_interview(
  uuid, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_video_interview_slot(
  uuid, timestamptz, int, public.interview_provider, public.interview_mode, text, text, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_zoom_meeting_secrets(
  uuid, text, text, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_video_interview(
  uuid, timestamptz, int, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_video_interview(
  uuid, text, uuid
) TO service_role;

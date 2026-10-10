-- Point 25: the interview link now goes out immediately on schedule and
-- reschedule (interview-scheduled edge function), not 30 minutes before via
-- this cron. Remove the old T-30 reminder schedule only — no other cron job
-- is touched (see the Point 15 investigation report: 14 other jobs exist,
-- none related).
--
-- Wrapped so this does not error if the job is already missing (e.g. if run
-- twice, or if it was never actually live in this environment).
DO $$ BEGIN
  PERFORM cron.unschedule('interview-t30-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Rollback: re-run the original SELECT cron.schedule(...) call from
-- 20260918053901_interview_t30_reminder_cron.sql to restore the T-30 cron.

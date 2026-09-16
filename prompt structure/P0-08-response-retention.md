# P0-08 — 60-Day Response Retention & Purge

Employer access to a job's responses ends 60 days after the job expires. Requires P0-04.

This is a **visibility revocation, not a deletion.** The candidate keeps their own application history. Deleting the record would destroy the evidence base for any future dispute.

## Migration
```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS responses_purge_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_notice_sent_at timestamptz;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS employer_visible boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS applications_job_visible_idx
  ON public.applications (job_id, created_at DESC) WHERE employer_visible;
```

Update the employer-side RLS policy on `applications` to add `AND employer_visible`. Candidate-side policies are unchanged — a candidate always sees their own applications.

Retention days come from `plans.limits.response_retention_days` (default 60), so a premium plan can extend it later without a code change.

## Lifecycle
1. On job expiry or close → set `responses_purge_at = expires_at + response_retention_days`
2. **7 days before purge** → notify all company members (in-app + email + WhatsApp), set `purge_notice_sent_at`, and show a persistent banner on the responses screen with a **Download CSV** action
3. At purge → set `employer_visible = false` for that job's applications

## Scheduled job
A daily task (`pg_cron` if available, else a scheduled server function):
- Mark newly expired jobs (`expires_at < now() AND status='active'` → `status='expired'`) and set `responses_purge_at`
- Send purge notices where `responses_purge_at - now() <= 7 days AND purge_notice_sent_at IS NULL`
- Execute purges where `responses_purge_at <= now()`

Make the task idempotent — running it twice in a day must produce the same result.

## CSV export
Available to HR Admin and Super Admin on any job, at any time before purge. Includes only **unlocked** candidates' contact details; locked candidates export as masked rows. Log every export to `download_events`.

## UI
- Job detail shows: `Responses available until 12 Mar 2027` once expired
- Banner within 7 days: `Responses for this job will no longer be available after 12 Mar. Download them now.` with the CSV button
- After purge: `Responses for this job are no longer available. This job expired on 11 Jan and responses were retained for 60 days.` Explain, do not just show an empty list

## Acceptance
- [ ] An expired job gets `responses_purge_at` set correctly
- [ ] The 7-day notice fires once and only once per job
- [ ] After purge, the employer sees the explanation, not an empty state
- [ ] After purge, the candidate still sees their application in their own history
- [ ] CSV export masks locked candidates
- [ ] Running the daily task twice changes nothing the second time

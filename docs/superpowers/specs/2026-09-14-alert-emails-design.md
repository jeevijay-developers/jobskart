# Alert card UI fix + automated alert-matching emails (Resend + Edge Functions)

## Part 1 — Alert card accidental edit-mode

Investigated `src/routes/_authenticated/candidate/alerts.tsx`: the existing
alert list-item cards already render as plain `<div>`/`<p>` + a delete
button — no `<input>`, `contentEditable`, or dropdown inside them. The
described bug does not reproduce in the current code (likely already fixed
in a prior commit outside this session). This will be re-verified visually
in-browser once Part 2 is implemented; if it still doesn't reproduce, it'll
be reported as already-fixed rather than "fixed" a second time.

## Part 2 — Automated alert emails

### Data sources confirmed

- Frequencies: `instant` / `daily` / `weekly` (the only options in the
  create-alert form's `<select>`).
- `candidate_job_alerts` already has `last_sent_at` and `email_enabled`
  columns (existing schema) — used as the digest window cursor and email-on
  gate respectively.
- No public base URL env var exists anywhere in the app. Per user: add
  `PUBLIC_APP_URL` as a **Supabase secret** (Edge Functions can't see the
  app's `.env`), defaulting to `http://localhost:3000` for now.
- Matching mirrors existing job-search behavior in `src/routes/jobs.tsx`
  (`ilike('%q%')`, case-insensitive substring), for consistency.
- User confirmed: write code + migrations + exact CLI commands for them to
  run — no direct deployment to the live Supabase project via MCP.

### New table

```sql
CREATE TABLE public.alert_job_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.candidate_job_alerts(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, job_id)
);
```

RLS enabled, no policies for `authenticated`/`anon` — internal bookkeeping
only; Edge Functions use the service-role client, which bypasses RLS.

### Matching logic

```
matches(job, alert.query) =
  (!alert.query.keyword || job.title ILIKE '%' || keyword || '%')
  AND
  (!alert.query.city    || job.city  ILIKE '%' || city    || '%')
```

At least one of keyword/city is always present (enforced at alert-creation
time already).

### Edge Functions (`supabase/functions/`)

- `_shared/resend.ts` — `sendEmail()` wrapper around Resend's REST API,
  reading `RESEND_API_KEY` / `RESEND_FROM_EMAIL` via `Deno.env.get`.
- `_shared/templates.ts` — HTML for the confirmation email and the
  match/digest email (built from `PUBLIC_APP_URL` + job fields).
- `_shared/matching.ts` — the matching predicate above, shared by both
  instant and digest functions.
- `send-alert-confirmation` — invoked directly from the client
  (`alerts.tsx`, right after a successful `candidate_job_alerts` insert,
  fire-and-forget, wrapped so a failure here never blocks alert creation).
  Sends the "here's what we're watching for" email once.
- `alert-instant-notify` — invoked by a **Database Webhook** (dashboard
  config, not a migration — Supabase Webhooks are UI/dashboard managed) on
  `INSERT INTO jobs`. Ignores rows where `status != 'active'`. Matches
  against `frequency = 'instant' AND is_active AND email_enabled` alerts,
  dedups via `alert_job_notifications`, sends, records.
- `alert-digest` — invoked by two `pg_cron` schedules (daily / weekly),
  each POSTing `{ "frequency": "daily" | "weekly" }`. For each matching
  alert: window = `last_sent_at ?? created_at` → now, collect matching
  `jobs` created in that window, dedup, send one email per alert if
  matches exist, then update `last_sent_at = now()` **regardless** of
  whether anything matched (keeps the window moving forward).

### Scheduling (`pg_cron` + `pg_net` + Vault)

Enabled via migration: `CREATE EXTENSION IF NOT EXISTS pg_cron;` /
`pg_net`. Two `cron.schedule(...)` jobs call the `alert-digest` function
via `net.http_post`, reading the service-role key from **Supabase Vault**
at run time (`vault.decrypted_secrets`) rather than embedding it in the
migration file. The Vault secret itself is a **one-time manual SQL step**
the user runs in the SQL editor — this is the "not settable purely through
code" piece flagged up front.

### Known scope boundary

The instant webhook fires on `INSERT` only (as specified). A job created as
`draft` and later `UPDATE`d to `active` won't trigger an instant alert —
only the next digest run would catch it (digests query by `created_at`,
independent of when the status changed). Not silently expanded to cover
this; flagged in the final report instead.

### Secrets (all via `supabase secrets set`, values supplied by the user)

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (default if unset: `JobsKart <onboarding@resend.dev>`)
- `PUBLIC_APP_URL` (default if unset: `http://localhost:3000`)

### Manual steps (beyond code/migrations) — documented in the final report

1. `supabase db push` (or `supabase migration up`) to apply the new table +
   cron extensions/schedules.
2. `supabase functions deploy` for each of the three functions.
3. `supabase secrets set` for the three values above.
4. One-time SQL in the Supabase SQL editor to store the service-role key in
   Vault (exact statement provided, value not requested in chat).
5. Dashboard: Database → Webhooks → create webhook on `jobs` / `INSERT` →
   call `alert-instant-notify`.

## Out of scope

- No changes to `job_titles_master`, matching/ranking config, or any other
  notification channel (WhatsApp ledger untouched).
- No UI added for toggling `email_enabled`/`whatsapp_enabled` per alert —
  not requested, and `email_enabled` already defaults to `true`.
- No coverage of the draft→active transition for instant alerts (see scope
  boundary above).

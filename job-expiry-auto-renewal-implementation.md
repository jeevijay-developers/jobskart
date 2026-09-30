# Job Expiry & Auto-Renewal System — Implementation Plan

## Deck rules to implement

| Rule | Meaning |
|---|---|
| Default Validity | A job is valid for 30 days from publish |
| Expiry Action | On expiry the job's status becomes `expired` and it is hidden from search |
| Renewal | Employer can renew manually, or enable auto-renewal |
| Auto-Renew Condition | Auto-renewal runs only if the employer's plan supports it |
| Notification | Employer is reminded before expiry |

## Current state (verified in codebase)

**Exists:**
- `job_status` enum already includes `'expired'` — but **nothing ever sets it**
- `jobs.expires_at timestamptz DEFAULT now() + interval '30 days'` — the deck's default validity, already in schema
- `plan_settings.free_validity_days` (default 30) — platform-wide validity knob already exists
- Trigger `tg_jobs_lock_window_upd` (migration `20260719064619`): on any `expires_at`
  update, `responses_locked_after = expires_at + 7 days` — **renewal automatically extends
  the response-retention window for free**; do not bypass it
- Candidate DB search RPCs already filter `expires_at > now()`
- Scheduling precedent: pg_cron + pg_net → POST to Supabase Edge Function with service-role
  key, atomic-claim pattern (`alert-digest`, `interview-reminder`); `_shared/resend.ts` for email
- `notifications` table (per-user in-app), `whatsapp_send_ledger` (capped sends)
- `plans` catalog with `limits jsonb` — **but no company↔plan link exists anywhere**; all
  entitlements today are the platform-wide `plan_settings` singleton

**Missing (everything else):**
- Expiry sweeper, manual renew RPC, `auto_renew` column, entitlement gate, reminder
  notifications, employer expiry UI, expiry guard on the public feed

**Gap found:** public feed `src/routes/jobs.tsx` filters `status='active'` only — no
`expires_at` guard. If the sweeper is down, stale jobs stay visible. Must be fixed as
defense-in-depth.

## Architecture decisions

1. **One server-side batch RPC does the state transitions** (`process_job_expiry_batch`),
   invoked by an Edge Function on pg_cron. The RPC is idempotent (`UPDATE ... WHERE
   status='active' AND expires_at <= now()`), so cron retries or double-fires are harmless.
   All money/entitlement/state logic stays in Postgres (standing rule 2).
2. **Expiry is also enforced at read time**, not only by the sweeper: every candidate-facing
   query adds `expires_at IS NULL OR expires_at > now()`. Cron downtime then degrades to
   "status column is stale", never to "expired job visible to candidates".
3. **Auto-renew is an entitlement, not a purchase**: gated by plan (`plans.limits` keys) with
   a platform default in `plan_settings`. No credits consumed — renewal is a retention
   feature; charging for it would punish the exact employers we're nudging.
4. **Auto-renew is capped** (`auto_renew_max_times`, default 3 consecutive) so a forgotten
   job can't sit live forever — after the cap the job expires and the employer must
   consciously renew. Keeps the marketplace fresh (same philosophy as boost decay).
5. **Company↔plan link**: add nullable `companies.plan_id → plans.id`. Null = platform
   default from `plan_settings`. This is the minimal foundation for per-plan entitlements
   without building billing/subscriptions now.
6. **Reminders use the existing dedup pattern** (`alert_job_notifications`): a
   `job_expiry_reminders(job_id, threshold_days)` unique table guarantees one reminder per
   job per threshold, immune to cron retries.

## Phase 1 — Database

Migration: `supabase/migrations/<ts>_job_expiry_renewal.sql`
(scaffold: `supabase migration new job_expiry_renewal`; guarded, re-runnable DDL)

1. Columns on `jobs`:
   - `auto_renew boolean NOT NULL DEFAULT false`
   - `renewed_count integer NOT NULL DEFAULT 0` (consecutive auto-renewals; manual renew resets to 0)
   - `last_renewed_at timestamptz`
2. `companies.plan_id uuid REFERENCES public.plans(id)` (nullable; existing rows stay null)
3. `plan_settings` additions:
   - `auto_renew_enabled boolean NOT NULL DEFAULT false` (platform default when no plan linked)
   - `auto_renew_max_times integer NOT NULL DEFAULT 3`
   - `expiry_reminder_days integer[] NOT NULL DEFAULT '{7,3,1}'`
4. Entitlement resolver `company_auto_renew(_company_id uuid) RETURNS record(enabled boolean, max_times int)`:
   `COALESCE(plans.limits->>'auto_renew', plan_settings.auto_renew_enabled)`, same for
   `auto_renew_max` — plan overrides platform default
5. RPC `renew_job(_job_id uuid) RETURNS jsonb` — `SECURITY DEFINER`, `SET search_path = public`:
   - role check `has_company_role(..., ARRAY['super_admin','hr_admin','recruiter'])` → `insufficient_permissions`
   - job must be `expired` or `active` (paused/closed/draft → `job_not_renewable`)
   - `expires_at := GREATEST(now(), old expires_at) + free_validity_days` (early renew stacks, never loses days)
   - `status := 'active'`, `renewed_count := 0`, `last_renewed_at := now()`
   - `employer_activity` row `job_renewed` in same transaction
   - existing trigger extends `responses_locked_after` automatically
   - returns `{ expires_at, renewed_count }`
6. RPC `set_job_auto_renew(_job_id uuid, _enabled boolean) RETURNS void`:
   - role check; enabling requires entitlement enabled → else `auto_renew_not_in_plan`
   - and `renewed_count < max_times` → else `auto_renew_limit_reached`
   - `employer_activity` row `job_auto_renew_toggled`
7. RPC `process_job_expiry_batch() RETURNS jsonb` — service-role called, single transaction:
   - **Pass 1 auto-renew**: `UPDATE jobs SET expires_at = expires_at + validity, renewed_count = renewed_count + 1, last_renewed_at = now()`
     `WHERE status='active' AND expires_at <= now() AND auto_renew AND entitlement ok AND renewed_count < max`
     (entitlement resolved per company via lateral join to the resolver)
   - **Pass 2 expire**: `UPDATE jobs SET status='expired' WHERE status='active' AND expires_at <= now()`
   - writes `employer_activity` (`job_auto_renewed` / `job_expired`) per affected row
   - returns `{ renewed: [{job_id, company_id, title, expires_at}], expired: [...] }` for the notifier
8. Table `job_expiry_reminders(job_id uuid FK, threshold_days int, sent_at timestamptz,
   UNIQUE(job_id, threshold_days))` — service_role only, no user policies (bookkeeping,
   same pattern as `alert_job_notifications`)
9. RPC `claim_due_expiry_reminders() RETURNS jsonb` — atomic claim: for each threshold in
   `expiry_reminder_days`, jobs `status='active'` whose `expires_at` falls inside that day's
   window and lacking a dedup row → insert dedup rows and return the claim set
   `{ job_id, company_id, title, expires_at, threshold_days, member_user_ids }`

## Phase 2 — Edge Functions + cron

New: `supabase/functions/job-expiry-sweep/index.ts`
- service-role client → `process_job_expiry_batch()`
- for each returned row: insert in-app `notifications` for the company's `super_admin` +
  `hr_admin` members ("Your job X expired — renew to keep receiving applications" /
  "Auto-renewed until <date>"), email via `_shared/resend.ts` template, WhatsApp optional
  through `whatsapp_send_ledger` cap
- cron: `SELECT cron.schedule('job-expiry-sweep', '5 * * * *', ...)` (hourly; upserts by name → re-runnable)

New: `supabase/functions/job-expiry-reminders/index.ts`
- `claim_due_expiry_reminders()` → send T-7 / T-3 / T-1 reminders (in-app + email;
  T-1 also WhatsApp if opted in and ledger allows)
- reminder copy states the action: "Renew now" / "Auto-renew is ON — nothing to do"
  (suppress reminder body urgency when `auto_renew` is on and entitled; still inform)
- cron: daily `0 9 * * *` (09:00 UTC ≈ 14:30 IST, matches alert-digest convention)

Graceful degradation (rule 7): if pg_cron/Edge Functions are down, read-time guards keep
expired jobs hidden; state catches up on next successful sweep.

## Phase 3 — Employer UI

`src/routes/_authenticated/employer/jobs.tsx`:
- **Expiry chip** per job: "Expires in 12d" (neutral) / "5d" (amber ≤7) / "1d" (red ≤2) / "Expired"
- **Renew button** on active (early renew, stacks days) and expired jobs ("Renew & relist");
  confirm dialog shows current → new expiry date; calls `renew_job` server fn
- **Auto-renew toggle** per job: on = switch; when entitlement missing → disabled switch +
  tooltip "Auto-renew is a paid-plan feature" (plans aren't self-serve purchasable yet, so
  upsell = contact admin/sales); when cap reached → "Limit reached (3/3) — renew manually"
- **Expired tab/section**: expired jobs with applications count ("37 candidates applied —
  renew to keep them") — renewal framed as retaining pipeline, not losing it
- Job edit wizard: auto-renew toggle + expiry date display in the publish summary

New server fn file: `src/lib/expiry.functions.ts` — `renewJob`, `setJobAutoRenew`,
`getExpiryState` (per-company: jobs near expiry, entitlement, caps) for one-round-trip UI.

## Phase 4 — Candidate-side correctness (hide expired everywhere)

- `src/routes/jobs.tsx` feed: add `.or("expires_at.is.null,expires_at.gt.<nowIso>")` (the gap found)
- `src/routes/jobs.$jobId.tsx`: if expired or past `expires_at` → application CTA replaced
  with "This job is no longer accepting applications" (page stays viewable, no dead apply button)
- Apply path: reject applications to expired jobs at the DB (trigger or check in the apply
  RPC/policy) — never trust the UI alone
- `src/lib/mcp/tools/search-jobs.ts`: same `expires_at` guard
- Saved jobs / alerts: expired jobs render with an "Expired" tag instead of Apply

## Phase 5 — Admin & analytics

- Admin settings page: edit `auto_renew_enabled`, `auto_renew_max_times`,
  `expiry_reminder_days` (plan_settings editor already has an admin surface)
- Admin plans page: document/edit `limits` keys `auto_renew`, `auto_renew_max`
- Employer analytics: renewals per month, auto-renew adoption %, share of expired jobs
  renewed within 7 days (the retention KPI this feature exists for)
- Admin overview: expired-this-week, auto-renewed-this-week counts

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_job_expiry_renewal.sql` | columns, plan link, settings, 4 RPCs, dedup table |
| `supabase/functions/job-expiry-sweep/index.ts` | new Edge Function + cron schedule |
| `supabase/functions/job-expiry-reminders/index.ts` | new Edge Function + cron schedule |
| `src/lib/expiry.functions.ts` | new server functions |
| `src/routes/_authenticated/employer/jobs.tsx` | expiry chips, renew, auto-renew toggle, expired section |
| `src/components/employer/JobWizard.tsx` | auto-renew toggle + expiry summary |
| `src/routes/jobs.tsx`, `src/routes/jobs.$jobId.tsx` | expiry guards + closed-job state |
| `src/lib/mcp/tools/search-jobs.ts` | expiry guard |
| admin settings/plans pages | new knobs |
| `src/lib/employer-analytics.functions.ts` | renewal KPIs |
| `src/integrations/supabase/types.ts` | regenerate after migration |

## Build order & verification

1. **Migration** — SQL tests: renew an expired job (status flips active, days stack);
   early renew stacks from old expires_at; auto-renew pass renews entitled+capped-ok rows
   only; non-entitled company's auto_renew=true job still expires; batch run twice in a row
   is a no-op (idempotency); reminder claim returns each (job, threshold) exactly once
2. **Edge Functions locally** (`supabase functions serve`) — sweep + reminders against a
   staging DB with backdated `expires_at` rows; verify notifications/emails dedup
3. **Cron** — schedule on staging, confirm `cron.job` entries; kill-switch test (unschedule,
   verify read-time guards still hide expired jobs)
4. **Employer UI** — run-through: chip colors at 12d/5d/1d, renew flow, toggle states
   (entitled / not entitled / cap reached), expired-section renew
5. **Candidate side** — expired job invisible in feed, detail shows closed state, apply
   rejected at DB level, MCP tool excludes it
6. `bun run lint` + `bun run build`

## Key decisions to sign off

- **(a)** Manual renew is free; auto-renew is a plan entitlement (no credits involved)
- **(b)** Auto-renew cap of 3 consecutive renewals, then manual action required
- **(c)** `companies.plan_id` nullable link now (foundation) vs platform-wide toggle only
- **(d)** Reminder thresholds 7 / 3 / 1 days, WhatsApp only for T-1 and within ledger caps
- **(e)** Expired jobs stay renewable indefinitely (data + pipeline preserved) vs archive
  after N days

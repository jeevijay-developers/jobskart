# WhatsApp-Centric UX — Implementation Plan

**Feature 8:** Enable WhatsApp notifications auto-checked wherever possible · Default job-alert opt-in · WhatsApp as the engagement backbone (approved Utility & Marketing templates).

**Status:** PLAN ONLY — nothing implemented yet.
**Companion docs:** `job-discovery-hiring-notification-implementation-plan.md` (already flags WhatsApp as "partially prepared, not implemented end-to-end").

---

## 1. How other job portals & platforms do WhatsApp

| Platform / pattern | What they do | What we copy |
|---|---|---|
| **Apna / WorkIndia** (blue-collar India) | WhatsApp is the primary alert + engagement channel: job-match alerts, application status, interview reminders all land on WhatsApp because email open-rates for this demographic are near zero | WhatsApp-first channel order (WA → email → in-app), vernacular-friendly short templates with one CTA button back into the app |
| **Meta WhatsApp Business Platform** (the rail everyone uses) | Three template categories — **Authentication, Utility, Marketing** — with different pricing and rules; free-form messages only inside a 24 h customer-service window opened by the user; business-initiated messages must use pre-approved templates; explicit **opt-in** required before messaging; quality rating + messaging tiers throttle abusive senders | Template catalog keyed by category; opt-in/consent ledger; frequency caps + quiet hours to protect quality rating; status webhooks for delivered/read/failed |
| **Recruitee / ATS vendors** | "Custom application flows in WhatsApp hiring": screening questions, document collection and interview scheduling run as **WhatsApp Flows** (in-chat forms) so candidates never leave WhatsApp | Phase-6 option: WhatsApp Flow for alert-preference management and quick screening; not needed for v1 |
| **BSP automation playbooks for job boards** (Gupshup / AiSensy / Infobip / LeadNotifi) | Event→template maps: application received, status change, interview reminder, daily job digest, re-engagement drip; each event bound to an approved template ID held in config, never hard-coded | Event→template-key map in DB (`whatsapp_templates`), admin-editable; delivery-status tracking table; STOP-keyword opt-out handling |
| **Indeed / LinkedIn (contrast)** | Email-only alerts; WhatsApp not used at all in western markets | Confirms this is an India-emerging-market differentiator, not a table-stakes feature — our advantage if done compliantly |

**Meta platform rules that shape the design** (sources at the end):
1. **Opt-in before messaging.** Consent must be explicit, scoped ("job alerts & application updates on WhatsApp"), and revocable. Pre-checked boxes are acceptable at the point where the user hands over the number *if* the checkbox is clearly labelled and un-checkable — which is exactly what candidate onboarding already does.
2. **Categories matter.** Utility = updates about something the user initiated (their application, their saved alert, their interview). Marketing = recommendations, digests of jobs they didn't ask for, re-engagement. Marketing costs more, is frequency-capped by Meta, and damages quality rating if reported.
3. **24 h service window.** Free-form replies only within 24 h of a user-initiated message. Everything we send is business-initiated ⇒ always templates.
4. **Messaging tiers.** New WABAs start at a low business-initiated-conversations-per-24 h tier and scale with volume + quality. Batch marketing sends must respect the tier, not blast.
5. **Opt-out must be honoured.** Users can opt out in-app, and Meta expects STOP/keyword opt-outs on incoming messages to be respected.

---

## 2. Current-state audit (repo, 2026-09-28)

### 2.1 What already exists (the foundation)

| Asset | Location | Notes |
|---|---|---|
| `candidate_profiles.whatsapp_number` (E.164) + `whatsapp_opt_in boolean DEFAULT true` | `supabase/migrations/20260623230850_*.sql:4-5` | Global consent flag, already defaults true |
| E.164 normalizer + backfill | `20260818114855_*.sql:2-28` (`normalize_phone_e164`) | Client mirror `toE164` in `src/routes/_authenticated/onboarding/candidate.tsx:50` |
| Onboarding WhatsApp capture + consent checkbox (pre-checked) | `onboarding/candidate.tsx:103-107, 324-325, 671-706` | "Receive updates, alerts, and notifications on WhatsApp" — **this is already the auto-check surface** |
| Per-user daily send cap RPC | `20260719064619_*.sql:110-132` — `whatsapp_send_ledger(user_id, day, count)` + `register_whatsapp_send(int)` SECURITY DEFINER, raises at 50/day | **Never called from anywhere** — ledger always empty |
| Plan-level caps | `plan_settings.free_whatsapp_cap_per_post` (500), `free_whatsapp_rajasthan_only` (true) — admin UI `src/routes/admin/plans.tsx:118-121` | **Never enforced by any code path** |
| Alert-level channel flags | `candidate_job_alerts.whatsapp_enabled DEFAULT false`, `email_enabled DEFAULT true` (`20260714063327_*.sql:92-93`) | Alerts UI (`candidate/alerts.tsx:39-75`) never sets them — DB defaults win |
| Preference JSONB | `candidate_profiles.notification_prefs` default `{"email_alerts":true,"whatsapp_alerts":false,"weekly_digest":true}` (`20260714044818_*.sql:1`) | Toggle exists in `candidate/settings.tsx:17-21,80-82` but **nothing consumes `whatsapp_alerts`** |
| Notification core | `notifications` table (`20260622093545_*.sql:152-172`) + triggers for `application.new`, `application.status`, `interview.scheduled`, `candidate.invited_to_apply`; Realtime bell `NotificationBell.tsx` | In-app channel is solid |
| Email dispatch (the pattern to clone) | Edge fns `alert-digest`, `alert-instant-notify`, `application-status-notify`, `interview-reminder`, `interview-scheduled`, `job-expiry-reminders`, `send-alert-confirmation` — all Resend-only via `_shared/resend.ts` | `alert-instant-notify` fires from a Database Webhook on `jobs` INSERT; `alert-digest` from pg_cron `0 9 * * *` / `0 9 * * 1` (`20260914075503_*.sql:25-66`) |
| Email dedup ledger | `alert_job_notifications(alert_id, job_id UNIQUE)` (`20260914075503_*.sql:5-18`) | Pattern for WA dedup |
| Webhook route pattern | `src/routes/api/public/webhooks/razorpay.ts` | Reuse for Meta status webhook |
| pg_cron + pg_net scheduling pattern | `20260914075503`, `20260918053901`, `20260924113852`, `20260924103235` | Reuse for dispatch sweeper + marketing cron |

### 2.2 What does NOT exist (the gap this plan closes)

1. **No provider integration** — zero Meta Cloud API / Gupshup / Interakt / AiSensy / Twilio calls; no `WHATSAPP_*` secrets anywhere.
2. **No template catalog** — approved Utility/Marketing template IDs live only in the Meta manager; nothing in DB or code references them.
3. **No message log / outbox** — no per-message rows, provider message IDs, or delivery status.
4. **No status webhook** — delivered/read/failed and incoming STOP never reach us.
5. **No channel orchestrator** — triggers write in-app rows directly; edge fns hard-code email. No layer decides "WA vs email vs both".
6. **No enforcement of caps** — `register_whatsapp_send` never called; `free_whatsapp_cap_per_post` / `free_whatsapp_rajasthan_only` are decorative.
7. **No employer-side WhatsApp** — README:395 promises "Call Now + WhatsApp button after unlock"; `database.tsx:296,725-728` shows plain text only. `jobs.contact_pref` is dead schema.
8. **No consent audit trail** — `whatsapp_opt_in` is a bare boolean, no who/when/source.
9. **No employer notification prefs page** at all.

### 2.3 Contradictions to resolve in Phase 1

- **Triple flag conflict:** `whatsapp_opt_in` defaults **true**, but `notification_prefs.whatsapp_alerts` and `candidate_job_alerts.whatsapp_enabled` default **false**. The slide says "default opt-in" ⇒ flip the alert-level defaults and define one precedence rule (D2).
- **Duplicate cap columns:** `plan_settings.free_whatsapp_cap_per_post` (20260719) vs `free_whatsapp_per_post` (20260720) — drop one.
- **`register_whatsapp_send` uses `auth.uid()`** — edge functions run as service role (no auth uid), so the existing RPC cannot be called from the dispatch path. Needs a service-role variant (D6).
- **Stale docs:** `CLAUDE.md:103` claims a WhatsApp Business API integration exists. It does not. Fix in Phase 6.

---

## 3. Design decisions

**D1 — Provider: Meta Cloud API direct, behind an adapter.**
Approved templates imply an existing WABA. Send via Graph API `POST /{phone-number-id}/messages` from edge functions; secrets `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` in Supabase secrets/Vault. All provider calls go through one module `supabase/functions/_shared/whatsapp.ts` (`sendTemplate(...)`, `verifySignature(...)`) so a BSP (Gupshup/Interakt) can be swapped in later without touching call sites.

**D2 — One precedence rule for consent; three flags keep distinct meanings.**
`effective_whatsapp(user) = profiles has whatsapp_number (E.164) AND candidate_profiles.whatsapp_opt_in (legal consent) AND notification_prefs->>'whatsapp_alerts' (preference toggle)`. Alert rows additionally carry `whatsapp_enabled` per-alert. Meaning split: `whatsapp_opt_in` = consent ledger head (legal), `notification_prefs.whatsapp_alerts` = master preference, `candidate_job_alerts.whatsapp_enabled` = per-alert override. Every send path calls one helper `shouldSendWhatsapp(userId)` — never re-derives inline.

**D3 — Default opt-in everywhere a subscription is created ("auto-check where possible").**
- Onboarding consent checkbox: already pre-checked — keep, and make the label scope explicit ("job alerts, application & interview updates").
- Alert create/edit form (`candidate/alerts.tsx`): add channel checkboxes; WhatsApp **pre-checked** whenever `effective_whatsapp` is true today (currently the form has no channel UI at all).
- Settings (`candidate/settings.tsx`): WhatsApp toggle default ON for new profiles (change JSONB default for new rows).
- Apply flow: after first application, `application-status-notify` double-checks consent and mentions "you'll get updates on WhatsApp" — no new checkbox needed (utility, consent already captured).
- **One-tap nudge:** existing users with a number but `whatsapp_alerts=false` see a dismissible card on candidate dashboard/notifications page: "Get job alerts on WhatsApp — [Enable]". One server fn flips the pref + writes a consent row.

**D4 — Channel orchestrator + outbox, not scattered sends.**
New table `whatsapp_messages` is the outbox + log. Triggers keep inserting in-app `notifications` (unchanged). Edge functions, instead of emailing directly, call `_shared/notify.ts: fanout(event)` which (a) inserts/updates in-app, (b) enqueues a WA row if `shouldSendWhatsapp` + template exists + caps pass, (c) sends email per existing prefs. Utility events send WA inline (low volume, latency matters); marketing/digest events enqueue `queued` rows drained by a cron sweeper (D7).

**D5 — Template catalog in DB, referenced by key.**
`whatsapp_templates(key unique, category, provider_template_id, language, variables jsonb, status)`. Code and the event map reference `key` only ("application_status_update"); admin UI (`src/routes/admin/whatsapp.tsx`, new) lists catalog, lets super_admin map keys to Meta template names and pause a key. Seed rows inserted by migration with placeholder provider IDs the ops team replaces from the Meta manager.

**D6 — Caps: three layers, all enforced in Postgres.**
- Per-recipient daily hard cap 50 (existing ledger) via new `register_whatsapp_send_for(_user uuid, _count int)` SECURITY DEFINER, EXECUTE granted to `service_role` only (edge fns are service role; the old `auth.uid()` RPC stays for any future authenticated sender).
- Per-employer per-post outreach cap `plan_settings.free_whatsapp_cap_per_post` enforced by `assert_whatsapp_post_cap(_job_id)` DEFINER RPC counting `whatsapp_messages` where `source='employer_outreach'` and `reference->>'job_id'`; `free_whatsapp_rajasthan_only` gates free-plan employer outreach to Rajasthan candidates (`candidate_profiles`/job state) until admin disables it.
- Per-recipient **marketing** frequency cap: ≤2 marketing/7 days, ≥48 h apart, quiet hours 21:00–08:00 IST (utility exempt). Enforced in the sweeper query, constants in a `whatsapp_settings` singleton row (admin-tunable).

**D7 — Dispatch topology.**
- Utility: edge function sends immediately, writes `sent`/`failed` + provider message id.
- Marketing/digest: rows enqueued `queued`; pg_cron every 10 min → `whatsapp-dispatch` edge fn drains in batches sized to the WABA tier (start 200/24 h, config in `whatsapp_settings`), respects quiet hours by delaying (not dropping) rows.
- Retry: `failed` with retryable error → 2 more attempts with backoff; `invalid_number` error code → mark `candidate_profiles.whatsapp_number_status='invalid'` (new column) and suppress future WA for that user (email continues).

**D8 — Status + inbound webhook.**
`src/routes/api/public/webhooks/whatsapp.ts`: GET handshake (`hub.challenge` vs `WHATSAPP_VERIFY_TOKEN`); POST verifies `x-hub-signature-256` (HMAC of raw body) before touching data. Updates `whatsapp_messages.status` (sent/delivered/read/failed) by provider message id; incoming text `STOP`/`UNSUBSCRIBE` (case-insensitive) → flip `whatsapp_alerts=false` + `whatsapp_opt_in=false` + consent row `source='stop_keyword'`, reply with a utility confirmation template.

**D9 — Event → template map (v1).**

| Event (existing trigger/fn) | Recipient | Category | Template key |
|---|---|---|---|
| Application status change (`application-status-notify`) | candidate | utility | `application_status_update` |
| Interview scheduled (`interview-scheduled`, `tg_interviews_notify`) | candidate | utility | `interview_scheduled` |
| Interview T-30 reminder (`interview-reminder` cron) | candidate | utility | `interview_reminder` |
| Instant job alert (`alert-instant-notify` DB webhook) | candidate | utility | `job_alert_instant` |
| Daily/weekly alert digest (`alert-digest` cron) | candidate | utility | `job_alert_digest` |
| Invited to apply (`candidate.invited_to_apply`) | candidate | utility | `invite_to_apply` |
| Job expiring / renewal (`job-expiry-reminders` cron) | employer | utility | `job_expiry_reminder` (needs employer number, P5) |
| Recommended-jobs nudge (new cron, weekly, only if ≥3 strong matches) | candidate | **marketing** | `recommended_jobs_weekly` |
| Re-engagement after 14 d inactive (new cron, ≤1/30 d) | candidate | **marketing** | `reengagement_nudge` |

Every template carries exactly one CTA URL button into the app (`/jobs/$id`, `/applications`, `/alerts`) with `?utm_source=whatsapp&utm_campaign=<key>` so CTR is measurable.

**D10 — Employer-side WhatsApp (closes README:395).**
After unlock, `database.tsx` / applicants view render **Call Now** (`tel:`) and **WhatsApp** (`https://wa.me/<e164>?text=<prefilled intro>`) buttons. Clicking WA logs `whatsapp_messages(source='employer_outreach', direction='outbound', status='sent', provider='employer_device')` and counts against the per-post cap (D6). Button hidden with a tooltip when the candidate's `whatsapp_opt_in` is false or number invalid. `jobs.contact_pref` gets a real control in the job form (`in_app` / `call` / `whatsapp`) and the applicants view sorts/surfaces contact accordingly. Employer messages about *their own* jobs (expiry, new application) reuse the candidate pipeline once an employer WA number + consent is collected on `employer/settings` (new page, also hosts employer notification prefs).

**D11 — Consent ledger.**
Append-only `whatsapp_consents(user_id, opted_in, source, policy_version, at)` written on every flip: onboarding, settings, alert form, nudge card, STOP webhook, admin. Gives DPDP-Act-style proof of consent and lets us answer "why is this user opted out".

**D12 — Fallback order & observability.**
Channel order per event: in-app always → WA if effective → email if `email_alerts`. WA `failed`(permanent) ⇒ email fallback for that event. Admin dashboard card (`admin/whatsapp.tsx`): last-24 h sends by status, fail rate, opt-outs, marketing cap hits, WABA tier headroom. Employer sees WA delivery on their outreach rows in reports.

---

## 4. Schema sketch (single migration, Phase 1 + 2 parts)

```sql
-- enums
CREATE TYPE public.whatsapp_template_category AS ENUM ('utility','marketing','authentication');
CREATE TYPE public.whatsapp_message_status AS ENUM
  ('queued','sent','delivered','read','failed','invalid_number');

-- template catalog (D5)
CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  category public.whatsapp_template_category NOT NULL,
  provider_template_id text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  variables jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: read all authenticated+anon? no: authenticated read, super_admin write (mirror plans policies)

-- outbox + log (D4/D7)
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_number text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  template_key text REFERENCES public.whatsapp_templates(key),
  category public.whatsapp_template_category,
  variables jsonb,
  source text NOT NULL,               -- alert_instant | application_status | employer_outreach | marketing_nudge | ...
  reference jsonb,                    -- {job_id, application_id, alert_id, interview_id}
  provider text NOT NULL DEFAULT 'meta_cloud',
  provider_message_id text,
  status public.whatsapp_message_status NOT NULL DEFAULT 'queued',
  status_detail text,
  attempts int NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz
);
CREATE UNIQUE INDEX uq_wa_provider_msg ON public.whatsapp_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_wa_dispatch ON public.whatsapp_messages(status, queued_at)
  WHERE status = 'queued';
CREATE INDEX idx_wa_recipient ON public.whatsapp_messages(recipient_user, sent_at DESC);
-- RLS: owner read own rows; employer read own outreach rows; service_role all; NO insert from client

-- consent ledger (D11)
CREATE TABLE public.whatsapp_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL,
  source text NOT NULL,               -- onboarding | settings | alert_form | nudge | stop_keyword | admin
  policy_version text NOT NULL DEFAULT 'v1',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_consents_user ON public.whatsapp_consents(user_id, at DESC);
-- RLS: owner read; insert only via SECURITY DEFINER rpc record_whatsapp_consent(...)

-- tuning singleton (D6)
CREATE TABLE public.whatsapp_settings (
  id integer PRIMARY KEY DEFAULT 1,
  marketing_per_7d integer NOT NULL DEFAULT 2,
  marketing_min_gap_hours integer NOT NULL DEFAULT 48,
  quiet_start_hour int NOT NULL DEFAULT 21,   -- IST
  quiet_end_hour int NOT NULL DEFAULT 8,
  dispatch_batch_size integer NOT NULL DEFAULT 200,
  enabled boolean NOT NULL DEFAULT true,
  CONSTRAINT wa_settings_singleton CHECK (id = 1)
);
-- RLS: read authenticated, write super_admin

-- fixes (2.3)
ALTER TABLE public.plan_settings DROP COLUMN IF EXISTS free_whatsapp_per_post;
ALTER TABLE public.candidate_job_alerts ALTER COLUMN whatsapp_enabled SET DEFAULT true;
ALTER TABLE public.candidate_profiles ADD COLUMN IF NOT EXISTS whatsapp_number_status
  text NOT NULL DEFAULT 'unverified';   -- unverified | valid | invalid
ALTER TABLE public.candidate_profiles ALTER COLUMN notification_prefs
  SET DEFAULT '{"email_alerts":true,"whatsapp_alerts":true,"weekly_digest":true}'::jsonb; -- new rows only
UPDATE public.candidate_job_alerts a SET whatsapp_enabled = true
 WHERE EXISTS (SELECT 1 FROM public.candidate_profiles p
                WHERE p.user_id = a.user_id AND p.whatsapp_opt_in AND p.whatsapp_number IS NOT NULL);

-- service-role cap RPC (D6)
CREATE OR REPLACE FUNCTION public.register_whatsapp_send_for(_user uuid, _count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ ...same body as
register_whatsapp_send but keyed on _user... $$;
REVOKE ALL ON FUNCTION public.register_whatsapp_send_for(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_send_for(uuid, integer) TO service_role;

-- employer per-post cap (D6/D10)
CREATE OR REPLACE FUNCTION public.assert_whatsapp_post_cap(_job_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ ...count employer_outreach rows for
  job vs plan_settings.free_whatsapp_cap_per_post (+ rajasthan gate)... $$;

-- consent recorder (D11)
CREATE OR REPLACE FUNCTION public.record_whatsapp_consent(_user uuid, _opted_in boolean, _source text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.whatsapp_consents(user_id, opted_in, source) VALUES (_user, _opted_in, _source);
$$;
```

Plus seed INSERTs for the nine template keys in D9 (provider_template_id = key name as placeholder).

---

## 5. Phases

### Phase 1 — Consent & preference foundation (no sending yet)
Migration above (defaults flip, consent table, settings singleton, cap RPCs, column drop). `shouldSendWhatsapp` helper + `record_whatsapp_consent` wiring in: onboarding save, settings toggles, alerts form channel checkboxes (WA pre-checked), nudge card + `enableWhatsappAlerts` server fn. Backfill consent rows from current `whatsapp_opt_in` state.
**Accepts:** new alert created by an opted-in candidate has `whatsapp_enabled=true`; settings flip writes a consent row; nudge card appears exactly for number-having opted-out users and disappears after enable; `npm run build` green.

### Phase 2 — Provider core + catalog + webhook
`supabase/functions/_shared/whatsapp.ts` (Graph send + HMAC verify), `whatsapp_templates` admin page (`admin/whatsapp.tsx`: list, category badge, map provider id, pause), `whatsapp_messages` RLS, status/inbound webhook route with signature check + STOP handling, secrets documented in README/`.env.example`. Manual smoke: server fn `sendTestWhatsapp(toSelf)` gated to super_admin.
**Accepts:** a queued row becomes `sent` with provider id; webhook flips status to `delivered`; inbound STOP flips both flags + consent row; unsigned POST rejected 401.

### Phase 3 — Wire utility events (the backbone)
`_shared/notify.ts` fanout; rewire `application-status-notify`, `interview-scheduled`, `interview-reminder`, `alert-instant-notify`, `alert-digest` to enqueue+send WA per D9 with dedup (reuse `alert_job_notifications` pattern for WA: unique (alert_id, job_id) already covers digest; add unique partial index on `whatsapp_messages(reference, template_key)` where source in alert set), caps via `register_whatsapp_send_for`, email fallback on permanent failure.
**Accepts:** status change reaches an opted-in candidate on WA and in-app; opted-out candidate gets email only; 51st send in a day for one recipient is refused and logged `failed` with detail; invalid number marks `whatsapp_number_status='invalid'` and subsequent events skip WA.

### Phase 4 — Marketing engine + defaults rollout
`whatsapp-dispatch` sweeper cron (10 min) + `whatsapp_settings` enforcement (quiet hours delay, 2/7 d cap, batch size); new crons `recommended-jobs-nudge` (weekly, ≥3 matches from existing recommendation RPC) and `reengagement-nudge` (14 d inactive, ≤1/30 d); utm CTA buttons on all templates; admin dashboard card (D12).
**Accepts:** marketing row created at 23:00 IST sends after 08:00; third marketing message within 7 d stays `queued` until window opens; STOP from WA stops all marketing within one sweep.

### Phase 5 — Employer-side WhatsApp
Employer settings page (WA number + consent + notification prefs); `wa.me` + `tel:` buttons after unlock (README:395) with cap enforcement via `assert_whatsapp_post_cap` and rajasthan gate; outreach logging rows; `jobs.contact_pref` control in job form + applicants view; employer utility templates (`job_expiry_reminder`, `application_new`) once number collected.
**Accepts:** free-plan employer's 501st outreach click on a post is blocked with toast; Rajasthan-only flag blocks non-RJ candidates on free plan; outreach appears in employer reports with delivery status.

### Phase 6 — Hardening, Flows (optional), docs
WhatsApp Flow for in-chat alert preference edit (v2 spike, ship behind `whatsapp_settings.enabled`); quality-rating monitoring notes + runbook; retry/backoff tuning; CLAUDE.md:103 rewrite; README WhatsApp section; load test the sweeper at 10 k queued rows; rollout: enable utility first (week 1), marketing after quality rating stable (week 3).
**Accepts:** runbook exists; docs match reality; sweeper drains 10 k rows in <15 min without tier breach.

---

## 6. Out of scope (v1)

- Bulk personal-WhatsApp Chrome extension (separate product, has its own legal page `legal.whatsapp-extension.tsx`).
- Candidate↔employer free-form chat in app or WA (24 h window makes it unsuitable; in-app messaging is a different feature).
- WhatsApp Pay / catalog / commerce messages.
- AI chatbot auto-replies on inbound WA (inbound v1 = STOP/opt-out + handshake only).
- Vernacular template variants beyond `language` column plumbing (ops can add rows later).
- Push notifications (still absent; separate initiative).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Meta quality-rating drop / number ban** from over-messaging | Marketing caps + quiet hours + tier-sized batches (D6/D7); utility-first rollout; opt-out one tap everywhere; monitor fail/report rates on admin card |
| **Template reclassification** (Meta moves a "utility" template to marketing) | Category lives in catalog row, admin-editable; pricing/limits read category from DB, not code |
| **Consent law (DPDP Act) / spam complaints** | Append-only consent ledger (D11), scoped checkbox copy, STOP honoured, no WA before Phase 1 consent work lands |
| **Webhook forgery** | HMAC `x-hub-signature-256` verified on raw body before any write; handshake token from secrets |
| **Cost blow-up** (per-conversation pricing) | Batch digests instead of per-job blasts where latency tolerable; marketing frequency caps; admin sees 24 h volume |
| **Invalid/recycled numbers** | `whatsapp_number_status` suppression after permanent provider error; email fallback keeps user served |
| **Caps bypassed by parallel sends** | All counters in SECURITY DEFINER RPCs with row-level upserts (existing ledger pattern), never app-side checks |
| **Schema drift / duplicate columns** (already present) | Phase 1 drops `free_whatsapp_per_post`; single source per concept thereafter |
| **Stale docs misleading future sessions** (`CLAUDE.md:103`) | Phase 6 doc rewrite; until then this plan is authoritative |
| **Lovable sync / parallel sessions** | One migration file, additive + explicit drops; no history rewrite |

---

## 8. Sizing

| Phase | Effort | New/changed surfaces |
|---|---|---|
| 1 | S | 1 migration, 4 small UI edits, 2 server fns |
| 2 | M | 1 shared module, 1 admin route, 1 webhook route, secrets |
| 3 | M | 5 edge fns rewired + fanout module |
| 4 | M | 1 sweeper fn + 2 crons + admin card |
| 5 | M | employer settings page, unlock buttons, job form field |
| 6 | S–M | runbook, docs, optional Flow spike |

Total ≈ 6 phases, each independently shippable; Phase 1–3 deliver the slide's three bullets (auto-check, default opt-in, engagement backbone for utility), Phase 4 completes the marketing backbone.

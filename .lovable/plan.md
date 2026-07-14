
# JobsKart — Completion & Bug-Fix Plan

Below is a full audit of what exists, what's broken, and what's missing across every panel, plus a phased plan to close it.

---

## A. Bugs & Regressions (fix first)

1. **SSR hydration mismatches on `/`** — console shows `__gcrremoteframetoken` and input-attribute mismatches. Wrap the hero search form + client-only widgets with a hydration-safe boundary (mount after `useHydrated()`), and remove any `Math.random()` / `Date.now()` used during render.
2. **OTP is stub / dev-only** — `auth-mobile.functions.ts` mints magic-links; no real SMS. Either wire a provider (MSG91 / Twilio) behind a secret, or lock the stub behind `DEV` and show a clear "test OTP: 000000" banner in non-prod previews. Add rate-limit + attempt lockout.
3. **"Coming soon" leftovers** — DigiLocker card on candidate dashboard, "Company details coming soon" on job detail. Either build (company about pulled from `companies.about`) or hide.
4. **Sign-in reflect state** — verify Navbar swaps "Sign in" for account menu after login in all viewports; audit for the "click Sign in, nothing happens" trap.
5. **Sign-out hygiene** — ensure `cancelQueries → clear → signOut → navigate('/auth', replace:true)` is used everywhere.
6. **Job detail save CTA** — guests hit `toast.info` only; add proper "Sign in to save" redirect preserving job id.
7. **Applications withdraw** uses `window.confirm` — replace with AlertDialog.
8. **RLS/GRANT audit** — run linter, fix any table missing anon-safe policy for public reads (jobs, companies, cities, industries, categories, skills_master, promo_banners).
9. **`ApplyDialog` resume flow** — verify storage bucket policy for `candidate-docs`; ensure signed URL used for employer viewing.
10. **Employer post-job** — confirm redirect after publish lands on `/employer/jobs/:id/applicants`; verify onboarding-completed guard.

---

## B. Candidate Panel — Gaps

Existing: dashboard, profile, applications, saved. Missing / thin:

1. **Notifications page** (`/candidate/notifications`) — list from `notifications` table with mark-read / mark-all-read; today only the bell dropdown exists.
2. **Interview schedule page** (`/candidate/interviews`) — new light table `candidate_interviews` (job_id, application_id, mode, scheduled_at, address/link, status) + list UI + ICS download.
3. **Messages / Chat** with employer (`/candidate/messages`) — thread per application; realtime via Supabase channel. (Optional MVP: read-only status timeline from `application_status_history`.)
4. **Documents** (`/candidate/documents`) — manage resumes, ID proofs, certificates in `candidate_documents` (already exists); set primary resume used by ApplyDialog.
5. **Settings** (`/candidate/settings`) — mobile change (OTP re-verify), email, WhatsApp opt-in, notification prefs, delete account (soft).
6. **Job Alerts** (`/candidate/alerts`) — saved searches → daily email/WA; table `candidate_job_alerts` + pg_cron dispatcher (edge webhook).
7. **Public profile** (`/u/:slug`) — route exists; verify masking rules for unauth viewers and unlock gating for employers.
8. **Onboarding polish** — save partial progress on each step (currently only end-of-wizard); resume where left off.
9. **Profile completeness nudges** — inline missing-field CTAs on dashboard (skills, education, preferred cities, expected salary).

---

## C. Employer Panel — Gaps

Existing: dashboard, jobs list, jobs.new (4-step), applicants, responses, database, credits, company, team, activity, reports. Missing / thin:

1. **Edit job** (`/employer/jobs/:id/edit`) — no edit route; today only create. Reuse wizard, prefill from row.
2. **Job clone / repost / close** — actions on jobs list; already partially in row menu, ensure all wired and audited.
3. **Applicant workspace** — add bulk shortlist/reject, notes (table exists), stage kanban, download resume, message candidate, schedule interview button.
4. **Interviews** (`/employer/interviews`) — schedule from applicant row, calendar view, ICS + WhatsApp reminders.
5. **Company profile** — allow logo/cover/GST/CIN upload + verification badge request; today edit exists but doc upload flow needs storage wiring + admin verification queue.
6. **Database search** — multi-city filter is in; add: experience range slider, notice period, salary, skills (AND/OR), education, gender/age (compliance-flagged), saved searches, CSV export (credit-gated).
7. **Credit ledger** — add invoice PDF download per transaction (reuse `jd-pdf` pattern).
8. **Team roles** — invite email currently magic-link; confirm expiry, add "resend"/"revoke".
9. **Reports** — thin; add funnel (posted → applied → shortlisted → hired), time-to-hire, source of hire, credits burn chart.
10. **Onboarding** — auto-create wallet + trial credits (e.g. 5 free unlocks) on company create.

---

## D. Super Admin Panel — Gaps

Existing but stubby (dashboard=33 lines, jobs=56, resumes=34).

1. **Dashboard** — real KPIs: DAU, signups (7/30d), jobs posted, applications, credits sold, revenue, top companies, top cities.
2. **Users** — filter by type/status, impersonate (server fn issuing scoped magic-link), suspend, delete, reset mobile.
3. **Companies** — verify KYC docs (approve/reject with reason), feature toggle, credit grant.
4. **Jobs** — moderation queue (reported jobs via `job_reports`), take down, feature/pin, edit category.
5. **Resumes / Candidates** — search, flag, export.
6. **Credits** — pack CRUD (table exists), Razorpay txn viewer, refunds.
7. **Masters** — cities/skills/industries/categories/job-titles/languages/assets CRUD (partial today).
8. **Banners** — schedule + target audience (candidate/employer/city).
9. **Learning resources** — CRUD + publish state.
10. **Reports & exports** — CSV of any list; audit log viewer (`employer_activity` + new `platform_audit`).

---

## E. Cross-cutting / Platform

1. **Notifications** — server fn to send WhatsApp (MSG91/Interakt) + email (Resend) on: application received, status change, interview scheduled, invite. Templates in `supabase` migrations.
2. **File storage** — audit `candidate-docs`, `company-docs`, `avatars`, `company-logos` policies; use signed URLs everywhere.
3. **SEO** — leaf routes need real `head()` (jobs list, job detail, company page, candidate public profile); add JSON-LD `JobPosting` on job detail; sitemap route `/api/public/sitemap.xml`; robots.
4. **PWA / mobile polish** — install prompt, bottom nav on candidate too, safe-area padding.
5. **Error/Not-found** — ensure every route has `errorComponent` + `notFoundComponent`.
6. **Analytics** — page-view + event hooks (apply, unlock, purchase); store in `analytics_events` table.
7. **Rate limits & abuse** — OTP send/verify, apply spam, unlock throttle.
8. **i18n stub** — Hindi toggle (copy-only, later).
9. **Legal pages** — /terms, /privacy, /refunds, /contact (contact_messages table exists).

---

## F. Phased Rollout

**Phase 1 — Stability (1 pass)**
Bugs A1–A10, remove "coming soon", RLS audit, SSR mismatch fix, sign-in/out hygiene, apply flow verification.

**Phase 2 — Candidate completion**
Notifications page, Documents, Settings, Interviews (read-only), Job Alerts (schema + list), onboarding partial-save.

**Phase 3 — Employer completion**
Edit job, applicant bulk actions + notes UI, Interviews (schedule), Company KYC upload + verification request, Database advanced filters + CSV, trial credits on signup.

**Phase 4 — Admin completion**
Real dashboard KPIs, KYC approval queue, job moderation, credit pack CRUD, banners scheduler, masters CRUD, audit log.

**Phase 5 — Growth & polish**
WhatsApp/Email notifications, SEO + JSON-LD + sitemap, analytics events, legal pages, PWA polish.

---

## G. Data Model Additions (summary)

- `candidate_interviews` (application_id, mode, scheduled_at, location, meeting_url, status)
- `candidate_job_alerts` (user_id, query jsonb, frequency, last_sent_at)
- `platform_audit` (actor_id, kind, target, metadata)
- `analytics_events` (user_id, kind, path, props jsonb)
- `notification_prefs` on `profiles` (email/whatsapp/sms booleans)

All with GRANTs + RLS scoped to `auth.uid()` + service_role.

---

## H. Verification checklist (per phase)

- Build passes, no TS errors.
- Playwright smoke: candidate signup → onboarding → apply → track; employer signup → onboarding → post → view applicant → unlock → schedule interview.
- Supabase linter clean.
- Lighthouse mobile ≥ 90 on `/`, `/jobs`, `/jobs/:id`.

Approve this and I'll start Phase 1.

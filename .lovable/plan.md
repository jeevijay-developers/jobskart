# Employer portal: feed, team, analytics, responses, onboarding

Five focused workstreams. Each piece is shippable on its own; together they make the employer side feel complete.

## 1. Activity feed (new)

**DB migration** — `employer_activity` table:
- `id uuid pk`, `company_id uuid`, `actor_id uuid null`, `kind text` (`job.created`, `job.published`, `job.draft_saved`, `job.duplicated`, `job.closed`, `application.received`, `application.status_changed`, `candidate.unlocked`, `credits.purchased`, `team.invited`, `team.joined`), `title text`, `body text null`, `link text null`, `metadata jsonb`, `created_at timestamptz default now()`.
- GRANTs + RLS: members of `company_id` can SELECT; service_role inserts.
- Index `(company_id, created_at desc)`.

**Triggers** — fire inserts from existing triggers/handlers:
- Extend `tg_applications_after_insert` → also insert `application.received`.
- Extend `tg_applications_after_update` → also insert `application.status_changed`.
- New triggers on `jobs` (AFTER INSERT / UPDATE of status) and on `credit_transactions` and `candidate_unlocks` and `employer_invites`.

**UI**
- `src/components/employer/ActivityFeed.tsx` — timeline with icon per kind, relative time, optional deep link.
- Render on dashboard right column (replace the static "Recent applications" with the richer feed) and on a new full-page route `/employer/activity`.
- Loading skeleton + empty state ("No activity yet — post your first job").

## 2. Team management hardening

`src/routes/_authenticated/employer/team.tsx` already exists; fix and extend:
- Add **role editing** for existing members (dropdown → `UPDATE employer_members.role`), with self-demotion guard (cannot remove last super_admin).
- Add **remove member** action with confirm modal.
- Add **resend / regenerate invite link** (rotate `token`, bump `expires_at`).
- Show member's last-seen / joined date.
- Ensure layout fits inside `EmployerShell` at all breakpoints (cap form column width, stack on mobile, prevent horizontal scroll on members table).
- Use shadcn `Dialog` + `Select` instead of `confirm()` and native `<select>` to match the rest of the portal.
- Log to activity feed on invite create / accept / role change / remove.

## 3. Analytics dashboard (real data)

Rewrite `/employer/reports` (and the dashboard stat cards) to compute real metrics:
- **Server fn** `getEmployerAnalytics({ companyId, rangeDays })` in `src/lib/employer-analytics.functions.ts` using `requireSupabaseAuth` + membership check.
- Metrics: total job views, applications, hires, unique candidates, conversion rate, **week-over-week delta** for views & applications, top 5 jobs by applications, applications by status, applications-per-day sparkline (last 30 days).
- Add a lightweight `views_count` increment path on the public job page (server fn already increments) — verify it's wired; if missing, add `incrementJobViews`.
- Report page UI: range switcher (7/30/90 days), 4 KPI cards with deltas, funnel bar (existing), top-jobs list, status breakdown donut (CSS-only), sparkline (inline SVG).
- Loading skeletons + empty state ("Post a job to see analytics").
- Dashboard `StatCard` `delta` values now come from the analytics fn (currently 0).

## 4. Job responses + AI shortlist

New route `/employer/responses` — single inbox across all jobs:
- Filters: job (dropdown), status, date range, search by candidate name/skill.
- Table/cards with candidate avatar, job title, applied date, current status, quick actions: **Shortlist / Reject / Schedule interview / Hire / Message**.
- Status update flows through existing `applications.status` (triggers handle notify + history + activity feed). Toast + optimistic update.
- Bulk select + bulk status change.

**AI shortlist** — new tab "Recommended" on each job's applicants page and on `/employer/responses`:
- Server fn `recommendShortlist({ jobId, limit })` — pulls applications + candidate profile (skills, experience, city, headline), scores via Lovable AI (Gemini Flash) against job's title/description/skills/min_experience, returns ranked list with `score 0-100` and `reasoning`.
- Cache result for 1h in a new `application_ai_scores` table to avoid re-spending tokens; refresh button to invalidate.
- UI: ranked list with score chip, top match reasons, one-click "Shortlist top N".

## 5. Onboarding end-to-end verification

Walk `src/routes/_authenticated/onboarding/employer.tsx` step-by-step in Playwright (signed-in via injected session) and verify each step:
- **You**: updates `profiles.full_name`, `profiles.designation` (re-add if missing in profiles schema check), sets `signup_intent = 'employer'`.
- **Company**: creates `companies` row, sets industry/size; `employer_members` row with `super_admin`; `employer_credit_wallets` seeded with `balance = 0`.
- **City**: writes `companies.hq_city`, optional address.
- **Brand/KYC**: uploads logo to `company-logos` bucket, writes `companies.logo_url`, `about`, `gst_number`, sets `verification_status = 'pending'`.
- **First-job hint**: stores intent (job title + city) in `companies.metadata` jsonb (or skip and redirect to `/employer/jobs/new` prefilled).
- On finish: `candidate_profiles`/profile `onboarding_completed = true` equivalent for employers — add `companies.onboarding_completed boolean default false` if missing, set true; redirect to `/employer/dashboard`.
- Emit `team.joined` + `company.created` activity events.
- Fix any field that currently writes to a missing column (verify against `supabase--read_query` on `companies` / `profiles`).

## Technical notes

- All new server fns: `createServerFn` + `requireSupabaseAuth` + company-membership guard via `has_company_membership` RPC.
- All new tables follow GRANT-then-RLS pattern.
- All new UI matches existing `EmployerShell` design language (rounded-2xl cards, `shadow-[var(--shadow-card)]`, primary blue tokens, lucide icons — no `Sparkles`/`Star`).
- Mobile responsive: every new screen tested at 375px.

## Out of scope

- Messaging/chat between employer and candidate (only the action button + toast "Coming soon" for now).
- Email delivery for invites (still copy-link flow).
- Razorpay changes.

## Order of execution

1. Migration: `employer_activity` + triggers + `application_ai_scores` + `companies.onboarding_completed`.
2. Activity feed component + dashboard integration + `/employer/activity` route.
3. Team page hardening.
4. Analytics server fn + reports page rewrite + dashboard deltas.
5. Responses inbox + AI shortlist server fn + UI.
6. Playwright onboarding walkthrough + fixes.

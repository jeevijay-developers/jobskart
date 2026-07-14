
# JobsKart — Phase 3+ Completion Plan

Building all four priority tracks: bulk job posting, AI response matching, interview scheduling, smart candidate matching — plus animated dashboards and app-like mobile polish.

---

## 1. Bulk Job Posting (Employer)

**Route:** `/employer/jobs/bulk`

- **Excel template generator** (`src/lib/jd-bulk-template.ts`) using `xlsx` npm package:
  - Sheet 1 "Jobs" with 15 columns: title, category, city (comma-sep), job_type, work_mode, exp_min, exp_max, salary_min, salary_max, openings, skills (comma-sep), education, description, earning_potential, apply_deadline
  - Sheet 2 "Instructions" with rules + examples
  - Sheet 3 "Reference" with valid values (cities, categories, job types) — used as source for Data Validation dropdowns on Sheet 1
  - "Download template" button pre-fills the reference sheet from live masters
- **Upload UI** (drag-drop XLSX/CSV → parse in-browser with `xlsx` → preview table with row-level validation errors → "Fix inline" editable cells → "Publish N jobs" button)
- **Server fn** `bulkCreateJobs` (`src/lib/jobs-bulk.functions.ts`) validates rows against masters, inserts in batch, returns per-row status. Auto-generates JD via existing `jd-template.ts` when description empty.
- Bottom-sheet progress modal with success/error count + link to jobs list

---

## 2. AI Response Matching

**New table** `application_match_scores` (score 0-100, breakdown jsonb, matched_at) — extends existing `application_ai_scores`.

- **Server fn** `scoreApplication` — Gemini 2.0 Flash: JD + candidate profile → JSON `{score, strengths[], gaps[], summary}`. Called on application insert via trigger → edge queue OR on-demand from applicant row.
- **Auto-scoring trigger:** `tg_applications_score_on_insert` enqueues score job (writes to `application_match_scores` with status='pending'); resolved by background poll from applicant page (`useQuery` with `refetchInterval` until scored).
- **Applicant page upgrades** (`jobs.$jobId.applicants.tsx`):
  - Match % badge (green ≥80, amber 60-79, grey <60) on every row
  - Sort by match, filter by min-match slider
  - Expandable row shows strengths/gaps
  - Bulk "Auto-shortlist ≥ threshold" action (employer-settable per job, default 80)
- **Job setting:** `auto_shortlist_threshold` column on `jobs` (default null=off). Step 4 of post-job wizard adds this control.
- **Candidate side:** on `/jobs/:id` and job cards, compute match client-side against the signed-in candidate profile (skills overlap + experience + city) — instant, no AI call. Show ring badge "78% match — you're a strong fit". Guests see "Sign in to see your match".

---

## 3. Interview Scheduling

**New table** `interviews`:
```
id, application_id, company_id, candidate_id, job_id,
mode (video|phone|onsite), scheduled_at, duration_min,
location, meeting_url, notes, status (scheduled|confirmed|rescheduled|cancelled|completed),
created_by, created_at, updated_at
```
+ policies (candidate reads own, company members read/write theirs) + activity trigger + notification trigger.

- **Employer:** `/employer/interviews` calendar (week + list view). "Schedule interview" button on applicant row opens dialog (date/time picker, mode, meeting URL auto-generated placeholder, notes). Sends notification + logs activity. ICS download.
- **Candidate:** `/candidate/interviews` list with upcoming/past tabs, confirm/reschedule request buttons, "Add to calendar" (ICS).
- **Notifications** on both bells; email/WhatsApp hook stubbed for later provider wiring.

---

## 4. Smart Candidate Matching & Alerts

- **Match % on `JobCard`** — client-side score for signed-in candidates (skills, city, exp, salary overlap). Adds a small ring next to the salary chip.
- **1-tap apply:** `ApplyDialog` gains "Use my last resume" as default, so applying takes one click when a primary resume exists.
- **Job Alerts** (`/candidate/alerts`): new table `candidate_job_alerts (query jsonb, frequency, is_active, last_sent_at)`. UI: name, keywords, city multi-select, salary min, category, frequency (daily/weekly), WhatsApp/email toggles. "Save current search as alert" button on `/jobs`.
- **Alert delivery** is queued (pg_cron/edge) — plan lays groundwork; actual send is stubbed until provider is chosen.

---

## 5. Attractiveness Pass

- **Animated dashboards** (both candidate + employer):
  - `AnimatedCounter` component (framer-motion `useSpring`) for KPI tiles
  - `Sparkline` (existing) + new `MiniAreaChart` for hiring funnel + applications-per-day
  - Card hover states: subtle lift + shadow via existing `--shadow-card` tokens
  - Skeleton shimmer on all queries (replaces "Loading…" text)
- **Mobile app-like feel:**
  - Candidate bottom nav (5 tabs) — mirror employer pattern already in `CandidateShell`
  - Pull-to-refresh on candidate dashboard, applications, saved (custom hook wrapping `TouchEvents` + `queryClient.invalidateQueries`)
  - Swipe on `JobCard` in mobile list: swipe-right = save, swipe-left = dismiss (framer-motion drag)
  - Safe-area padding on all fixed bottom nav (`pb-[env(safe-area-inset-bottom)]`)
  - Sticky "Apply" bar on `/jobs/:id` gets a scale-in animation on scroll past the header

---

## Technical Details

**New files**
- `src/lib/jd-bulk-template.ts`, `src/lib/jobs-bulk.functions.ts`
- `src/routes/_authenticated/employer/jobs.bulk.tsx`
- `src/lib/matching.ts` (client-side score), `src/lib/matching.functions.ts` (AI scoring)
- `src/routes/_authenticated/employer/interviews.tsx`
- `src/routes/_authenticated/candidate/interviews.tsx`
- `src/routes/_authenticated/candidate/alerts.tsx`
- `src/components/employer/ScheduleInterviewDialog.tsx`
- `src/components/common/AnimatedCounter.tsx`, `MiniAreaChart.tsx`, `Shimmer.tsx`
- `src/hooks/use-pull-to-refresh.tsx`, `use-swipe.tsx`

**Deps to add**
- `xlsx` (SheetJS) for template + parse
- (framer-motion already installed)

**Migrations**
1. `interviews` + `application_match_scores` + `candidate_job_alerts` tables (with GRANTs, RLS, triggers)
2. `jobs.auto_shortlist_threshold int` column

**Order of build**
1. Migrations → 2. Bulk sheet → 3. AI match + applicant page upgrades → 4. Interviews → 5. Alerts + candidate match ring → 6. Animation/mobile polish across dashboards

Ship in that order so each step is independently usable.

---

Approve and I'll start with the migrations and the bulk-posting flow, then work through the rest.

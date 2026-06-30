## Goal

Make the **employer side** production-ready: a polished conversational onboarding, an attractive dashboard with real numbers, and every existing feature (jobs, applicants, database, credits, team, reports, company KYC) verified, wired together, and mobile-responsive. No new tables, no new packages — only fix gaps and lift the UI/UX to match the candidate side.

## Part 1 — Employer onboarding redesign (`src/routes/_authenticated/onboarding/employer.tsx`)

Replace the single-screen form with the same `Questionnaire` wizard already used by candidate onboarding, so the look matches end-to-end.

Steps (all save into existing `profiles` + `companies` + `employer_members` — no schema change):
1. **You** — recruiter full name + role (Founder / HR / Recruiter) + designation.
2. **Company basics** — company name, industry (autocomplete from `industries`), size (tile picker, not dropdown), founded year.
3. **Where you hire** — HQ city tile-grid (top 12 metros) + "Other" search, plus optional secondary cities (chips).
4. **Brand & proof** — logo uploader (drag-drop, uses existing `company-logos` bucket), website, short About (≤500 chars), GST/PAN (optional, "verify later" allowed).
5. **First job hint** — quick toggle "I want to post my first job now" → routes to `/employer/jobs/new` instead of dashboard.

Two-column desktop shell matching candidate onboarding: left brand panel ("Hire faster on JobsKart" + trust chips: 1L+ candidates, AI shortlisting, verified profiles), right form card with vertical stepper. Sticky footer (Back / Save & exit / Continue). Auto-creates `employer_members(super_admin)` and seeds `employer_credit_wallets(balance=0)` so the credits screen never errors.

## Part 2 — Employer dashboard redesign (`src/routes/_authenticated/employer/dashboard.tsx`)

Keep all current data queries; restructure the page:

1. **Hero band** — gradient strip: company logo + name + verification chip + active company switcher (when multi). Right side shows credit balance pill ("₹/credits: 42 · Buy more") pulling from `getCompanyWallet`.
2. **Quick actions row** — 4 tiles (Post a job, Search candidates, Invite team, Verify company) — context-aware: hides "Verify" when verified, highlights "Post a job" when activeJobs=0.
3. **Stats row** — 5 compact cards with week-over-week deltas (applications this week vs prior week, views delta). Numbers tabular.
4. **Two-column body**
   - Left (lg:col-span-2): **Hiring pipeline mini-funnel** (Applied → Shortlisted → Interview → Offered → Hired) as a horizontal bar with counts; click → `/employer/jobs/:id/applicants`. Below: **Recent applicants** list (existing) with avatar, job title chip, status pill, "View" CTA.
   - Right: **Active jobs** card (top 5 by applications, "Manage all" link), **Learning corner** for employers (reuse `learning_resources` filtered by `audience='employer'` if present, else fallback to all), **KYC checklist** (verify GST, upload logo, add About, invite teammate) — each row click-through.
5. **Empty states** — illustrated empty for 0 jobs / 0 applicants with single primary CTA.
6. **Mobile** — stats become 2×2, hero stacks, pipeline bar scrolls horizontally, sidebar moves below main.

## Part 3 — Feature polish & bug-fix sweep

**Jobs list (`employer/jobs.tsx`)**
- Add result count + "Active / Paused / Closed" tab counts in pills.
- Add "Duplicate" action (insert clone with status `draft`).
- Make card layout collapse cleanly on mobile (action buttons wrap).

**Post a job (`employer/jobs.new.tsx`)**
- Add a "Save as draft" button on every step (writes `status=draft`).
- Step 1: replace category dropdown with chip grid (more tactile).
- Step 2: add description templates (3 starter snippets users can insert).
- Step 4: show a live preview card on the right (desktop) — uses existing `JobCard`.
- Validate max_salary ≥ min_salary, pincode = 6 digits.

**Applicants kanban (`employer/jobs.$jobId.applicants.tsx`)**
- Enable real drag-and-drop using native HTML5 DnD (no new packages) between columns — already half-wired.
- Add filter chips (Source, City, Experience) above the board.
- Sidebar profile pane: add resume preview link (signed url) and "Add note" textarea writing to existing `application_notes`.
- Fix profile deep-link: currently `/u/$slug` uses `candidate_id` (UUID) as slug — switch to fetched `profile_slug` or open the sidebar's "View full profile" via slug lookup.

**Company KYC (`employer/company.tsx`)**
- Wire GST/PAN upload to `company_documents` (already exists); show pending/approved badge.
- Add "Preview public page" button that opens `/c/$slug`.

**Database (`employer/database.tsx`)**
- Show wallet balance at top, low-balance nudge with link to `/employer/credits` when <5.
- Block "Unlock" button with friendly toast when balance=0 instead of silent fail.
- Add saved searches (localStorage only — no DB needed).

**Credits (`employer/credits.tsx`)**
- Display ledger with date grouping; add CSV export.
- Confirmation dialog before Razorpay checkout shows pack details.
- Handle stub mode gracefully (no Razorpay key → show "Contact sales" CTA).

**Team (`employer/team.tsx`)**
- Resend invite + copy invite link buttons (link already generated).
- Role description tooltips.

**Reports (`employer/reports.tsx`)**
- Add 30-day applications trend (simple SVG sparkline, no chart lib).
- Top performing jobs table.

**Shell (`EmployerShell.tsx`)**
- Persistent credit-balance chip in the top bar (desktop).
- Mobile bottom nav: include Database alongside Dashboard / Jobs / Credits / Post.
- Active company switcher dropdown in sidebar when user has >1 company.

## Part 4 — Verification

Drive Playwright via shell at 375px and 1280px through: `/onboarding/employer` (all steps), `/employer/dashboard`, `/employer/jobs`, `/employer/jobs/new`, an applicants page, `/employer/database`, `/employer/credits`, `/employer/team`, `/employer/reports`. Screenshot each. Confirm no overflow, the credit chip renders, kanban drag works, and the post-job wizard publishes a record.

## Files touched

- `src/routes/_authenticated/onboarding/employer.tsx` — full rewrite using `Questionnaire`
- `src/routes/_authenticated/employer/dashboard.tsx` — new hero + pipeline + sidebar
- `src/routes/_authenticated/employer/jobs.tsx` — counts, duplicate, mobile layout
- `src/routes/_authenticated/employer/jobs.new.tsx` — draft, templates, preview, validation
- `src/routes/_authenticated/employer/jobs.$jobId.applicants.tsx` — DnD, filters, notes, slug fix
- `src/routes/_authenticated/employer/company.tsx` — KYC upload wiring, public preview
- `src/routes/_authenticated/employer/database.tsx` — wallet nudges, saved searches
- `src/routes/_authenticated/employer/credits.tsx` — ledger grouping, CSV, stub handling
- `src/routes/_authenticated/employer/team.tsx` — resend / copy invite
- `src/routes/_authenticated/employer/reports.tsx` — sparkline + top jobs
- `src/components/employer/EmployerShell.tsx` — credit chip, mobile nav, company switcher
- `src/lib/credits.functions.ts` — small helper if needed for wallet seed on onboarding

No DB migrations. No new packages.

## Out of scope

- Messaging / chat with candidates
- Bulk resume import
- Multi-currency or invoicing
- Color/token changes

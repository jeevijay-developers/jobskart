# Plan: Complete JobsKart end‑to‑end

The candidate side has onboarding, profile, dashboard, applications and public profile. Major gaps remain on the **employer side**, **auth UX**, **home/marketing pages**, and **shared platform features** (notifications, settings, search/SEO). This plan ships them in four phases.

---

## Phase 5 — Employer onboarding, company & team

**Goal:** an employer can sign up, create a verified company, invite teammates, and land on a real dashboard.

**Database**
- Extend `companies`: `logo_url`, `cover_url`, `website`, `about`, `industry`, `size_band`, `founded_year`, `hq_city`, `gst_number`, `verification_status` (pending/verified/rejected), `verification_notes`.
- New `company_documents` (gst/pan/incorporation, file_path, status) + private storage bucket `company-docs`.
- Public storage bucket `company-logos`.
- New `employer_invites` (company_id, email, role, token, expires_at, accepted_at).
- RLS: owners/admins manage company + members + invites; recruiters read; public can read `verified` companies' public fields via a `get_public_company(slug)` SECURITY DEFINER fn.

**Routes / UI**
- `/signup/employer` (already exists) → on first login route to `/onboarding/employer` wizard:
  1. Company basics (name, industry, size, website, city, logo)
  2. About + cover image
  3. KYC stub (GST/PAN upload, verification_status='pending' → auto‑mark 'verified' after 2s stub)
  4. Invite teammates (email + role)
  5. Done → `/employer/dashboard`
- `/_authenticated/employer/company` — edit company profile, manage documents, see verification badge.
- `/_authenticated/employer/team` — list members, pending invites, role changes, remove.
- `/invite/$token` public page → accept invite (signs in/up, joins company).
- Rebuilt `/_authenticated/employer/dashboard`: stat cards (active jobs, total applicants, new this week, interviews scheduled), recent applicants feed, jobs needing attention, quick "Post a job" CTA, company strength meter.
- New `EmployerShell` (sidebar + mobile bottom nav, breadcrumb) mirroring `CandidateShell`.

## Phase 6 — Job posting, applicant management, search

**Goal:** employers post jobs and manage the pipeline; candidates get a richer marketplace.

**Database**
- Add to `jobs`: `status` (draft/active/paused/closed/expired), `expires_at`, `views_count`, `applications_count`, `screening_questions` (jsonb), `is_featured`, `slug`.
- New `application_notes` (application_id, author_id, body) and `application_status_history`.
- Trigger: increment `applications_count` on application insert; decrement on withdraw.
- RLS: employer members of `company_id` manage their jobs/applications.

**Routes / UI**
- `/_authenticated/employer/jobs` — list with status filter, search, duplicate, pause/close.
- `/_authenticated/employer/jobs/new` — 4‑step wizard: Basics (title, category, type, mode) → Details (description, responsibilities, requirements rich text) → Compensation & location → Screening questions + publish.
- `/_authenticated/employer/jobs/$jobId` — overview + applicants tab.
- `/_authenticated/employer/jobs/$jobId/applicants` — kanban (Applied / Shortlisted / Interview / Offered / Hired / Rejected), drag‑to‑update status, candidate side panel with resume preview, notes, status history.
- Candidate marketplace polish:
  - Better filters (sort: relevance/newest/salary, multi‑select category, salary range slider).
  - Pagination + empty/skeleton states.
  - Job detail: similar jobs, "Apply with screening questions" modal, share buttons.
  - Public company page `/c/$slug` with active jobs and about.

## Phase 7 — Auth UX, notifications, settings

**Goal:** production‑quality account surface.

- `/auth` redesign: split tabs Sign in / Sign up, role chooser at signup, Google + email/password, "forgot password" link, friendly error toasts, redirect‑back via `?redirect=`.
- `/forgot-password` and `/reset-password`: real form, validation, success states.
- Enable HIBP password check via `configure_auth`.
- New `notifications` table (user_id, type, title, body, link, read_at) + RLS. Triggers on: new application (employer), status change (candidate), new message (future), invite accepted.
- `<NotificationBell />` in both shells with realtime subscription.
- `/_authenticated/settings` (shared) with subroutes:
  - `account` — name, email, mobile, password change, delete account.
  - `notifications` — toggle email/in‑app per event.
  - `privacy` (candidate) — searchable by recruiters, hide current employer.
  - `billing` (employer, placeholder) — current plan card.

## Phase 8 — Home / marketing / SEO

**Goal:** the public site looks like a real product, not a template.

- `/` (home) full redesign sections: hero with search (keyword + city) that deep‑links to `/jobs`, category grid (Logistics, Security, Retail, Driving, …), featured jobs (live from DB), "for candidates" vs "for employers" split CTAs, trust band (verified companies count, jobs count, candidates count from DB), testimonials, FAQ accordion, final CTA.
- `/employers` landing page — pricing tiers (Free/Growth/Enterprise placeholder), feature comparison, "Post a job" CTA.
- `/about`, `/contact` (form → stored in `contact_messages` table), `/privacy`, `/terms`.
- Per‑route `head()` with unique title/description/OG; OG image at leaf routes only.
- Sitemap server route `/api/public/sitemap.xml` listing active jobs + public company/candidate slugs. `robots.txt` in `public/`.
- JSON‑LD `JobPosting` schema on `/jobs/$jobId`, `Organization` on `/c/$slug`.
- Navbar: add Browse jobs, For employers, Sign in, Post a job; sticky, mobile drawer.
- Footer: link columns + socials.

---

## Technical notes

- All new tables follow the GRANT → RLS → POLICY pattern; SECURITY DEFINER fns for public reads (`get_public_company`, sitemap query).
- Server logic via `createServerFn`; only sitemap/webhooks under `src/routes/api/public/`.
- Storage: `company-logos` (public), `company-docs` (private), reuse `avatars`/`candidate-docs`.
- Reusable primitives extracted: `Wizard`, `KanbanBoard`, `StatCard`, `FileDropzone`, `RichTextEditor` (tiptap), `EmptyState`.
- Realtime: subscribe to `notifications` and `applications` (employer kanban) via browser client.
- KYC (company + candidate) stays stubbed — UI + auto‑verify after delay.
- No SMS OTP, no payments, no messaging (deferred).

---

## Suggested build order

1. Phase 5 (employer onboarding + company + team) — unblocks everything employer‑side.
2. Phase 6 (job posting + applicant pipeline + marketplace polish).
3. Phase 7 (auth UX + notifications + settings).
4. Phase 8 (home redesign + marketing pages + SEO).

Reply **"go"** to start Phase 5, or tell me which phase/items to drop or reorder.

# Super Admin Portal

A new `/admin` portal gated by a `platform_role = 'super_admin'` role, seeded by a mobile/email list. Mobile-responsive, matches the existing dark Jobskart aesthetic.

## 1. Access control

New table `platform_roles(user_id, role)` with `app_platform_role` enum (`super_admin`).
- Security-definer `has_platform_role(_uid, _role)` (no recursion on RLS).
- Trigger on `auth.users` insert: if `email` or `phone` matches a row in `admin_seed(identifier)`, auto-insert `super_admin`.
- Seed list (`admin_seed`) populated via migration; the user can add more rows later. I'll ask for the initial mobile/email before running the migration.
- Route guard `/admin/*` (pathless layout under `_authenticated/admin/`) calls `has_platform_role`; non-admins get redirected to their normal dashboard.

## 2. Admin shell

`src/components/admin/AdminShell.tsx` — sidebar (collapsible to drawer on mobile) with sections:
- Dashboard (platform KPIs: users, jobs, applications, revenue from credit_transactions)
- Users
- Companies & Jobs
- Master Data
- Banners (Campaigns)
- Learning
- Credits & Payments
- Resumes

## 3. Modules

**Users** (`/admin/users`)
- Tabs: Candidates / Employers. Search by name/mobile/email, filter by status.
- Row actions: view profile, suspend (`profiles.status='suspended'` — new column), delete (cascades), reset onboarding, copy mobile.
- Detail drawer: full profile + applications/companies.

**Companies & Jobs** (`/admin/companies`, `/admin/jobs`)
- Approve/reject companies (`verification_status`), feature/unfeature jobs (`is_featured`), force-close jobs, edit any job, view applicants. Reuses existing job form.

**Master Data** (`/admin/masters`)
- CRUD tabs: Cities, Skills, Industries, Job Categories. New tables `cities`, `skills_master`, `industries`, `job_categories` (slug, name, is_active). Existing free-text fields keep working; admin lists feed autocompletes going forward (non-breaking).

**Banners** (`/admin/banners`)
- New table `promo_banners` (title, image_url, cta_label, cta_url, audience `candidate|employer|both`, starts_at, ends_at, is_active, sort).
- Surfaced on candidate & employer dashboards (carousel).

**Learning** (`/admin/learning`) — Basic CRUD
- New table `learning_resources` (title, description, cover_url, content_url, kind `video|article`, category, is_published).
- Candidate-side `/candidate/learning` grid + detail.

**Credits & Payments** (`/admin/credits`)
- Read-only views: `credit_packs` CRUD, `razorpay_orders` list, `credit_transactions` ledger across companies, manual credit grant action (uses existing `apply_credit_delta`).

**Resumes** (`/admin/resumes`)
- List `candidate_documents` of kind `resume`, signed-URL download, view linked candidate.

## 4. Database changes

New tables (all with GRANTs + RLS scoped to `has_platform_role(auth.uid(),'super_admin')`):
- `platform_roles`, `admin_seed`
- `cities`, `skills_master`, `industries`, `job_categories`
- `promo_banners` (public SELECT for active rows)
- `learning_resources` (public SELECT for published)

Column adds:
- `profiles.status` (`active|suspended`), checked in auth attacher to block suspended users.

## 5. UI/UX

- Dark theme reuse, sidebar with `lucide` icons, sticky topbar with global search.
- Mobile: sidebar → `Sheet` drawer, tables → card list under `sm`.
- Empty states + skeletons for every list.

## 6. Out of scope this turn

Email/SMS broadcast campaigns, full LMS (lessons/progress/certs), employer hiring campaigns, impersonation, audit log UI (we'll still write `admin_audit` rows for destructive actions, UI later).

---

**Before I implement, I need one input:** the initial super-admin mobile number(s) and/or email(s) to seed. Reply with the list and I'll start.

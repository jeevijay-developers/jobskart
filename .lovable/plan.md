## Fix critical employer + candidate flows

### 1. Employer onboarding enforcement
- `src/routes/auth.tsx`: after login, if user is employer, check `fetchMyCompanies()` → if no company OR `onboarding_completed = false`, redirect to `/onboarding/employer` instead of `/employer`.
- `src/routes/_authenticated/employer/route.tsx`: add a guard that bounces to `/onboarding/employer` when no company exists for the user.

### 2. Fix "Could not save" on employer onboarding + first job
- Migration: add missing GRANTs on `employer_credit_wallets` (INSERT/UPDATE for authenticated via owning company) and `notifications` (INSERT for authenticated, needed so the application trigger doesn't fail).
- Move credit-wallet seeding into a `SECURITY DEFINER` RPC `create_company_with_owner(...)` so onboarding atomically creates company + membership + wallet without hitting RLS edges.
- `src/routes/_authenticated/onboarding/employer.tsx`: call the new RPC; on success mark `onboarding_completed = true` and redirect to `/employer`.

### 3. Fix Post-a-Job
- `src/lib/options.ts`: change `on_site` → `onsite` (DB enum).
- `src/routes/_authenticated/employer/jobs.new.tsx`: map work_mode correctly, allow draft save with minimal fields, surface server error message instead of generic toast.
- `src/components/employer/EmployerShell.tsx`: promote "Post a job" to a primary action in the mobile bottom bar (replace overflow placement).

### 4. Fix candidate Job Detail + Apply
- `src/routes/jobs.$jobId.tsx`: ensure public read works (anon SELECT policy on `jobs` where `status='published'`) and that the route doesn't 404 on slug vs id.
- `src/components/candidate/ApplyDialog.tsx`: ensure insert into `applications` includes `company_id` (required by trigger) and handles notification-trigger permission via the grant added in step 2.
- Add a clear success state + link to "My Applications".

### 5. Multi-city database filter (employer)
- `src/routes/_authenticated/employer/database.tsx`: replace single-city `Select` with a multi-select (chips) backed by `cities` master. Update query to `.in('city', selectedCities)` or `preferred_cities && selectedCities` for candidates with multiple preferences.

### 6. Company profile editing + documents
- `src/routes/_authenticated/employer/company.tsx`:
  - Editable fields: name, about, industry, size, website, hq_city, founded_year, GSTIN, PAN, social links, logo, cover.
  - Documents section: upload to `company-docs` bucket, list with status (pending/verified/rejected), delete, re-upload. Uses existing `company_documents` table.

### Technical details
- New RPC `public.create_company_with_owner(_name text, _industry text, _size company_size, _hq_city text, _website text, _about text)` returns the new `company_id`; inserts into `companies`, `employer_members` (super_admin), and `employer_credit_wallets` in one transaction.
- Grants: `GRANT INSERT, UPDATE ON public.employer_credit_wallets TO authenticated;` plus policy `USING (has_company_membership(auth.uid(), company_id))`. `GRANT INSERT ON public.notifications TO authenticated;` (trigger runs as definer already, but explicit grant prevents edge failures).
- Anon SELECT policy review on `jobs` for public job-detail page.

No other areas touched.

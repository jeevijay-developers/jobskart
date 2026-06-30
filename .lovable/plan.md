## Fix plan for employer onboarding, job posting, candidate apply, database filters, and company documents

### Root causes found

1. **Employer login redirects too early**
   - `src/routes/auth.tsx` sends employers directly to `/employer/dashboard` after OTP, even when no company exists or company onboarding is incomplete.

2. **Job posting/onboarding save failures**
   - Frontend uses `work_mode = "on_site"` in multiple places, while the database enum is `onsite | remote | hybrid | field`. This can break job insert/update and candidate preference save.
   - Employer onboarding creates a credit wallet from the browser. That can fail with RLS/permission issues and blocks onboarding.

3. **Candidate apply can fail**
   - The application insert path also triggers notifications/history. If notification insert permissions or trigger grants are missing, apply fails even when the application data is valid.

4. **Employer database location filter is single-city only**
   - `src/routes/_authenticated/employer/database.tsx` has one city field instead of a multi-location selector.

5. **Company profile documents need full management**
   - Existing `company_documents` and `company-docs` bucket support upload/read/delete, but the UI should expose edit details, upload new docs, status, and remove/re-upload actions clearly.

### Build-mode implementation steps

1. **Enforce employer onboarding before dashboard**
   - Update `src/routes/auth.tsx` so after employer OTP login:
     - If no company membership exists → `/onboarding/employer`
     - If company exists but `companies.onboarding_completed = false` → `/onboarding/employer`
     - Otherwise → `/employer/dashboard`
   - Update `fetchMyCompanies` select to include `onboarding_completed`.

2. **Fix enum mismatch everywhere**
   - Change `WORK_MODES` from `on_site` to `onsite` in `src/lib/options.ts`.
   - Normalize old `on_site` values to `onsite` in candidate onboarding/profile and employer job form.
   - Ensure new jobs insert `work_mode: "onsite"` by default.

3. **Make employer onboarding save robust**
   - In `src/routes/_authenticated/onboarding/employer.tsx`, save company and employer member first.
   - Mark `onboarding_completed: true` on the company.
   - Move initial wallet creation to a server-side/admin-safe function or make it non-blocking so onboarding never fails because of wallet RLS.
   - Keep first-job CTA redirecting to `/employer/jobs/new`.

4. **Make post-job form clickable and save correctly**
   - Add a prominent mobile-visible “Post a job” action in `EmployerShell` bottom navigation / More menu.
   - Update `src/routes/_authenticated/employer/jobs.new.tsx` to use valid enum values and friendlier validation.
   - On successful first job save, redirect to job details/applicants or jobs list with a toast.

5. **Fix candidate job details + apply**
   - Verify `/jobs/$jobId` loader uses public active job access and handles auth/no-auth gracefully.
   - Update `ApplyDialog` so the candidate can apply with an existing profile/resume and gets a clear duplicate-application message.
   - Add a migration/grants if needed for notification/history trigger writes so application insert is not blocked.

6. **Multi-city hiring database filter**
   - Replace single city filter in `src/routes/_authenticated/employer/database.tsx` with selectable city chips/search.
   - Query candidates where `profiles.city` or `candidate_profiles.preferred_cities` overlaps any selected city.
   - Show selected locations as removable filter chips.

7. **Company profile edit + document management**
   - Expand `src/routes/_authenticated/employer/company.tsx` with editable company fields, logo/cover upload, GST/PAN fields, and document upload/delete.
   - Show verification status, document type, uploaded date, and verified/rejected notes.

8. **Database migration safety net**
   - Add a migration for missing grants/columns if required:
     - `GRANT EXECUTE` on helper functions used by RLS.
     - `GRANT INSERT`/trigger-safe access for notifications/history where application triggers run.
     - `employer_credit_wallets.updated_at` if missing.

### Verification checklist

- New employer login → onboarding first → save → dashboard.
- “Post my first job” and “Post a job” both open the job form on desktop and mobile.
- Employer can create a valid active/draft job without “Could not save”.
- Candidate dashboard job card → job detail opens → apply succeeds or shows duplicate message.
- Employer database supports multiple selected cities/locations.
- Company page edits save and documents upload/delete correctly.
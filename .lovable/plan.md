## Root-cause finding (critical)

The live preview console is throwing `permission denied for function has_company_membership` on every read of `public.jobs`, signed-in or not. The database has these helper functions:

- `has_company_membership(uuid, uuid)` — **no EXECUTE for `anon` or `authenticated`**
- `has_company_role(uuid, uuid, employer_role)` — same
- `user_companies(uuid)` — same
- `find_auth_user_by_phone_or_email(text, text)` — same

But the RLS policies on `jobs`, `companies`, `applications`, `employer_members`, `employer_invites`, `application_notes`, `application_status_history`, `application_ai_scores`, `candidate_unlocks`, `credit_transactions`, `employer_credit_wallets`, `employer_activity`, `candidate_documents`, and `notifications` all call these helpers. Without EXECUTE the whole expression fails, so PostgREST returns 401/`42501` and the page renders empty.

Visible symptoms today:
- `/jobs` shows nothing for everyone (the page in the screenshot)
- `/c/$slug` (company pages) — empty jobs list
- Homepage live stats render 0/0/0/0 (the `getPlatformStats` server fn hits the same RLS)
- Employer dashboard, Responses, Reports, Jobs, Activity, Applicants — all silently fail to fetch
- Mobile + OTP login can't look up existing users → first-time auto-create always runs

This is the highest-impact single fix. Everything else is downstream polish.

## Plan

### Phase 1 — Unblock data access (single migration)

1. `GRANT EXECUTE` on the four helper functions to `anon` and `authenticated`.
2. Sanity-check policy coverage for the `cities`, `industries`, `job_categories`, `skills_master`, `job_titles_master`, `languages_master`, `candidate_assets_master`, `learning_resources`, `promo_banners` tables — confirm they have `TO anon SELECT` policies + grants so the homepage, autocompletes, and learning section render for logged-out users. Add only what is missing; do not widen anything else.
3. Verify `employer_credit_wallets` has the `updated_at` column referenced by `apply_credit_delta`; add it if missing so unlock / purchase / grant transactions don't error.

### Phase 2 — Functional bug fixes (frontend)

1. **Applicants kanban** (`employer/jobs.$jobId.applicants.tsx`): remove the `offered` column — it is not in the `application_status` enum, so any drop into it currently throws. Use `applied → shortlisted → interview → hired → rejected`.
2. **Broken candidate profile link** in the applicants drawer: the link uses `candidate_id` against `/u/$slug`, but `/u/$slug` resolves by `candidate_profiles.profile_slug`. Fetch the slug alongside the application, fall back to hiding the link when the candidate has no public slug.
3. **Legacy signup routes**: `signup.candidate.tsx` and `signup.employer.tsx` are still mounted but the product now uses only `/auth` (mobile + OTP). Replace both with a `beforeLoad` redirect to `/auth` so old links and emails don't dead-end.
4. **Platform stats — cities**: count from `public.cities` (already populated) instead of distincting up to 1000 active jobs; show a real number on the landing hero.
5. **OTP login resilience**: now that `find_auth_user_by_phone_or_email` is grantable, double-check `loginOrCreateWithMobile` returns the right `existing` flag so returning users land on `/candidate/dashboard` or `/employer/dashboard` instead of onboarding.

### Phase 3 — Responsive & UX polish

1. **Employer mobile bottom nav** currently truncates to the first 4 items (Dashboard, Jobs, Responses, Database). Reports, Activity, Credits, Company, Team are unreachable on phones. Replace the 5th slot ("Post") with a "More" sheet that opens a drawer containing the remaining nav items and the "Post a job" CTA, so every section is reachable on mobile.
2. **Candidate shell** parity: confirm the candidate bottom nav covers Dashboard, Jobs, Applications, Saved, Profile; add the missing entry if any is dropped.
3. **Empty-state pass** on Reports, Activity, Responses, Database, Credits — show the existing empty cards I added when there is no data, instead of bare skeletons that never resolve.
4. **Header overflow** on small screens: tighten the `EmployerShell` header grid so the company-switcher select doesn't push the title off-screen on 360px widths.

### Phase 4 — Verification

For each surface, drive Playwright against `http://localhost:8080` (anon + a restored Supabase session) and capture screenshots:

- `/` — hero stats show real numbers, mockups render, CTAs work
- `/jobs` and `/jobs?q=delivery` — at least one card renders, pagination works
- `/c/<slug>` — company header + active jobs list
- `/auth` — mobile + OTP for both new and existing users; redirect destinations correct
- `/_authenticated/candidate/dashboard`, `/profile`, `/applications`, `/saved`
- `/_authenticated/employer/dashboard`, `/jobs`, `/jobs/new`, `/responses`, `/jobs/<id>/applicants`, `/database`, `/credits`, `/reports`, `/activity`, `/team`, `/company`
- `/admin/*` for a seeded super-admin

Run the Supabase linter after the migration to confirm no new RLS warnings, and `tsgo --noEmit` for a clean typecheck.

## Technical notes

```sql
-- Phase 1 migration sketch
GRANT EXECUTE ON FUNCTION public.has_company_membership(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, public.employer_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_companies(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_phone_or_email(text, text) TO anon, authenticated;

-- Add only if missing:
ALTER TABLE public.employer_credit_wallets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
```

These are pure GRANTs — they do not loosen RLS, because the helpers are `SECURITY DEFINER` and `STABLE`; the row visibility logic is unchanged. The fix simply lets PostgREST evaluate the policies instead of erroring out.

No new tables, no policy rewrites, no schema renames. Estimated work: 1 migration + ~6 small file edits + Playwright verification.

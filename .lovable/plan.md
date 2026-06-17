# Phase 4 — Candidate Onboarding, Profile & Dashboard (Full)

The basic signup, profile and dashboard scaffolding from Phase 3 will be upgraded into a complete, production-grade candidate experience modeled on Apna.co.

## What gets built

### 1. Database additions (one migration)
Add structured sub-tables so a profile is no longer just text fields:
- `candidate_experiences` — job_title, company_name, start_date, end_date, is_current, description
- `candidate_education` — level (10th / 12th / Diploma / Graduate / Post-graduate), board_or_university, institute, year, marks
- `candidate_languages` — language, proficiency (basic/conversational/fluent), can_read, can_write
- `candidate_documents` — type (resume / id_proof / certificate), file_url, file_name, size
- Extend `candidate_profiles` with: `date_of_birth`, `gender`, `marital_status`, `current_salary`, `expected_salary`, `notice_period_days`, `preferred_cities text[]`, `preferred_work_mode`, `assets text[]` (own bike/laptop/etc.), `government_id_type`, `government_id_last4`, `kyc_status` (stub: pending/verified/rejected)
- Storage bucket `candidate-docs` (private) with RLS so a user can only read their own folder `{uid}/...`
- RLS + GRANTs on every new table (owner-only); helper trigger to recompute `profile_strength` on update

### 2. First-time onboarding wizard (`/onboarding/candidate`)
Triggered automatically after signup or first login when `profile_strength < 60`. 6 steps with a progress rail, skip-for-now, autosave per step:
1. **Basics** — DOB, gender, city, preferred cities, profile photo
2. **Work status** — fresher / experienced / student → conditional fields
3. **Experience** — repeating cards (add / edit / delete entries)
4. **Education** — at least 10th class; add Diploma/Graduate as needed
5. **Skills, languages & assets** — chip pickers with suggestions
6. **Preferences & resume** — job types, work mode, expected salary, notice period, resume upload (PDF/DOC, ≤ 5 MB)
Final screen: profile strength meter + "Go to dashboard" / "Browse jobs".

### 3. Profile page rebuild (`/candidate/profile`)
Replace the single long form with a sectioned layout (Apna-style):
- Sticky left summary card (avatar, name, headline, city, strength meter, "Share profile" link)
- Right side sections, each independently editable via inline drawer/dialog:
  Personal • Career preferences • Experience (list with add/edit/delete) • Education • Skills • Languages • Resume & documents • Government ID (KYC stub button → marks `kyc_status='verified'` in dev)
- "Preview public profile" button that opens `/u/$slug` (read-only public view, indexable, with og tags)

### 4. Dashboard upgrade (`/candidate/dashboard`)
- Top hero: greeting + profile strength ring + "Complete profile" CTA when < 80
- Stat cards: Applications, Shortlisted, Interviews, Saved, Profile views (profile_views counter incremented on public profile visit)
- "Continue your profile" checklist (only items still missing)
- Recommended jobs (matched by skills overlap + city + job type, fall back to recent)
- Recent activity feed (applied / shortlisted / saved events from `applications` + `saved_jobs`)
- Mobile: bottom tab bar replaces the desktop sidebar

### 5. Shared UX polish
- `CandidateShell` gets a mobile bottom-nav and a top breadcrumb
- Reusable `<SectionCard>`, `<EditableSection>`, `<ChipInput>`, `<FileDropzone>` primitives
- Toast feedback + optimistic updates on every save
- All forms validated; phone/email/dates checked; resume mime-type + size guarded
- After every save, recompute and persist `profile_strength`

### 6. Public candidate profile (`/u/$slug`)
- SSR-friendly read-only page using a `public_candidate_view` (only non-sensitive columns; anon SELECT policy)
- `head()` with name + headline + city for SEO/sharing
- "Recruiters only" CTA to contact (gated to employer role later in Phase 5)

## Technical notes
- Storage uploads go through the browser client with RLS path `{auth.uid()}/resume-<ts>.<ext>`
- KYC stays a stub: clicking "Verify" simulates a 1.5 s call then flips `kyc_status` to `verified` — real provider plugs in later via a server function
- Profile strength formula centralized in `src/lib/profileStrength.ts` and reused by trigger + UI
- Onboarding wizard state kept in component state + per-step `upsert` (no global store needed)
- Recommendation query: `jobs` filtered by `array_overlap(skills, candidate.skills)` then ordered by created_at; SQL-side, limit 6

## Files (high level)
- `supabase/migrations/<ts>_candidate_full.sql` (tables, bucket, RLS, GRANTs, view, trigger)
- `src/lib/profileStrength.ts`
- `src/routes/_authenticated/onboarding/candidate.tsx` (+ step components in `src/components/onboarding/`)
- `src/routes/_authenticated/candidate/profile.tsx` (rebuilt) + section components in `src/components/candidate/sections/`
- `src/routes/_authenticated/candidate/dashboard.tsx` (rebuilt)
- `src/routes/u.$slug.tsx` (public profile)
- `src/components/candidate/CandidateShell.tsx` (mobile nav)
- `src/components/ui/*` reuses: dialog, drawer, sheet, progress (all already present)

## Out of scope (later phases)
- Real KYC API, SMS OTP, employer-side search of candidates, messaging, notifications center, settings page — all deferred to their dedicated phases.

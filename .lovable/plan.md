## Goal
Kill the "silent" onboarding-save bug on the candidate side, harden resume parsing, and give the whole candidate flow a UI polish pass.

## Root cause: onboarding "not saving"
In `src/routes/_authenticated/onboarding/candidate.tsx`, every `supabase.from(...).update/insert/delete(...)` is `await`-ed but the returned `error` is never checked. supabase-js **does not throw** on RLS/constraint failures, so the `try/catch` never fires, the toast says nothing, and the wizard silently advances — the user perceives it as "not saving". Same pattern in `ResumeUpload` insert into `candidate_documents`.

## Fixes

### 1. Onboarding save (critical)
- Introduce a tiny helper `runOrThrow(promise, label)` that awaits a Supabase call, throws on `error`, and surfaces `error.message` in a toast.
- Wrap every write in `saveStep` (profiles update, candidate_profiles update, experiences delete+insert, education delete+insert, languages delete+insert) with it.
- After each successful step: `toast.success("Saved")` (subtle) and only then advance.
- Guard against RLS edge cases: ensure `candidate_profiles` row exists (upsert-by-user_id) before first update so freshly-signed-up mobile users always have a row.
- Persist `onboarding_completed=true` on Finish only, and set `profile_slug` if null (derive from name + short id) so profile pages resolve immediately.

### 2. Resume parsing (candidate side)
- Fix silent failure on `candidate_documents` insert (same `runOrThrow`).
- When `parseResume` throws with the "scanned PDF" message, keep the file uploaded and clearly prompt the user to (a) re-upload as image or (b) continue manually — no dead-end.
- Show a compact "what we auto-filled" summary chip list after parse so the user trusts the fill.
- Cap file size in the client (already validated) and show a friendly progress state during base64 encode for >2 MB files.

### 3. Candidate UI polish (no logic change)
- Onboarding: tighten sticky side-rail spacing on `lg`, add a subtle progress bar on mobile top, larger tap targets on step navigation, consistent empty-state copy per step.
- Dashboard: align card paddings, unify icon sizing (Lucide 18px), fix profile-strength ring alignment on 393px viewport (current preview), ensure the "recommended jobs" list gracefully shows an empty state with a CTA to complete profile.
- Job detail (`/jobs/$jobId`) & Apply dialog: verify session before opening, disable Apply button while submitting, toast + redirect to `/candidate/applications` on success.
- New surfaces (Notifications, Documents, Settings, Alerts, Interviews): add loading skeletons + empty states, ensure mobile bottom-nav highlights the active route.

### 4. Verification
- Manual walkthrough via Playwright (login → onboarding → each step save → finish → dashboard → apply to a job) with screenshots at 393×588 and 1280×900.
- Typecheck (`tsgo`) after the changes.

## Out of scope
- Employer, admin, and public marketing pages (untouched).
- Auth/OTP flow (already covered in prior turns).
- New backend tables/policies — this pass is code-side only; existing schema is sufficient.

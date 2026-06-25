## Fixes from "24 June Update — Candidate"

### 1. Old/seeded user can't log in
`loginOrCreateWithMobile` only checks the `profiles` table. For numbers whose auth user exists but has no profile row (e.g. the seeded super admin `9098326235`), it falls into the create branch and `auth.admin.createUser` fails with "user already registered".
**Fix:** in `src/lib/auth-mobile.functions.ts`, when no profile is found, look up the auth user via `supabaseAdmin.auth.admin.listUsers` filtered by phone (and by synthetic email `m<mobile>@jobskart.app`) before calling `createUser`. If an auth user exists, reuse its id, upsert a `profiles` row with the chosen `user_type`, and mint the magic link against its real email.

### 2. Resume parser zod error: `education[i].marks: expected string, received null`
`ParsedResume` schema marks `marks` and `board_or_university` as `.string().default("")`, but the model returns `null`.
**Fix:** in `src/lib/resume.functions.ts`, change every string field inside `experiences` and `education` to `z.string().nullable().optional().transform(v => v ?? "")` (job_title, company_name, description, level, board_or_university, institute, marks). Same hardening for `start_date`/`end_date`/`year_of_passing`.

### 3. Image (JPG/PNG) and DOCX uploads don't trigger parsing
`ResumeUpload` short-circuits anything that isn't `application/pdf`, so images and docx silently skip AI.
**Fix:**
- `ResumeUpload.tsx`: send PDFs **and** images (`image/png`, `image/jpeg`) to `parseResume`. For DOCX/DOC, keep the early "upload only" path and show an inline notice "AI auto-fill works on PDF or image — DOCX uploaded as-is".
- `resume.functions.ts`: when `mimeType` starts with `image/`, send the file as an `image_url` content part (`{ type: "image_url", image_url: { url: dataUrl } }`) instead of the `file` part — Gemini vision needs that shape.

### 4. Switching Work status (fresher ↔ experienced ↔ student) jumps back to step 1
`onboarding/candidate.tsx` line 469 calls `setStep(0)` inside the status toggle.
**Fix:** remove the `setStep(0)` call; status changes must not reset the wizard step.

### 5. AI-suggested skills shown twice
Currently rendered both under fresher Work-status and on Skills & languages.
**Fix:** remove the AI-suggested skills block from the Work-status step; keep them only on the Skills & languages step (as ChipInput suggestions + an explicit "AI suggested" chip row that adds on click). Suggestions continue to be sourced from `suggestSkills` keyed on roles/qualification.

### 6. Work mode should allow multiple selection
**Fix:** change `workMode` from `string` to `string[]` in onboarding state and validation; render as toggle chips (multi). Persist to `candidate_profiles.preferred_work_mode` — store as comma-joined string (since column is text) until a schema change is requested. Update profile reload to split back into array.

### 7. Remove duplicate "Upload resume" card on Preferences step
**Fix:** delete the `<SectionCard title="Upload resume">…</SectionCard>` block (lines ~670-677) on the Preferences step. The Basics-step `ResumeUpload` already covers upload + parse, and the profile page handles replacements later.

### 8. Headline limit 80 → 200 chars
**Fix:**
- `validators.ts`: `headlineSchema` max 80 → 200.
- Onboarding Basics field: `maxLength={200}`, hint "One-line summary (max 200 chars)".
- Apply the same change wherever the headline input/hint appears on the profile page.

### Files touched
- `src/lib/auth-mobile.functions.ts`
- `src/lib/resume.functions.ts`
- `src/components/candidate/ResumeUpload.tsx`
- `src/lib/validators.ts`
- `src/routes/_authenticated/onboarding/candidate.tsx`
- `src/routes/_authenticated/candidate/profile.tsx` (headline limit only)

No DB migrations required.

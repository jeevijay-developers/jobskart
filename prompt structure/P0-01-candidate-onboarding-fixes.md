# P0-01 — Candidate Onboarding Bug Fixes

Fix the eight issues below in the candidate onboarding wizard (`src/routes/_authenticated/onboarding/candidate.tsx` and `src/components/candidate/*`). These are client-reported and blocking. Do not redesign the wizard — fix only what is listed.

## 1. Existing users cannot log in
Users who registered earlier cannot sign in. Investigate `find_auth_user_by_phone_or_email()`. The likely cause is phone-format inconsistency — some rows stored as `9876543210`, others as `+919876543210`.

Fix: normalise every phone to E.164 (`+91XXXXXXXXXX`) at both write time and lookup time. Add a migration that normalises existing rows in `profiles` and `candidate_profiles`. Make the lookup function match on the normalised form regardless of what was passed in.

## 2. Some PDF resumes do not parse
Text-layer PDFs work; scanned/image PDFs return nothing.

Fix in `src/lib/resume.functions.ts`: after `unpdf` extraction, if the extracted text is under 200 characters, treat the file as scanned. Rasterise the first 3 pages and send them to the vision path (`chat()` with `images`). Never fail silently — if both paths return nothing, show: "We could not read this file. Please fill your details manually — it takes 2 minutes."

## 3. Image and DOCX uploads accept but never parse
Parsing is only wired for PDF, but the UI accepts PDF / DOC / DOCX / PNG / JPG.

Fix: route by MIME type.
- `application/pdf` → existing path, with the scanned fallback from #2
- `image/*` → vision path directly
- `.docx` → extract text with `mammoth`, then the same text parser
- `.doc` → not supported; show a clear message asking for PDF or DOCX

Show a parsing state in the UI: uploading → reading → filling → done. A silent 15-second wait reads as a broken app.

## 4. Changing work status resets the wizard to step 1
Switching between Fresher / Experienced / Student sends the user back to step 1 and loses entered data.

Fix: changing work status must clear only the fields that depend on it (experience entries), keep the current step index, and preserve every unrelated answer. The wizard component must not remount on this change — lift the state so it survives.

## 5. AI-suggested skills appear but selection does not render
Skill selection currently appears on two screens (role selection and Skills & Languages), causing state confusion.

Fix: skill selection happens **once**, on the role-selection screen. On the later Skills & Languages screen, show the chosen skills as a read-only summary with an "Edit" link that jumps back.

Source of suggestions: query `skills_master` filtered by the selected job roles, ranked by usage frequency — a database lookup, not an AI call. Only if a role maps to fewer than 5 skills, call AI to fill the gap, and write anything new back to `skills_master` with `pending_review = true` for admin approval.

## 6. Single selection where multiple is needed
Convert the flagged single-select to multi-select chips with a visible selected state and an × to remove.

## 7. Remove duplicate resume upload
The final onboarding screen has a second "Upload resume" block. Remove it. Upload exists at step 1. If a resume was already uploaded, show the filename with a "Replace" link instead.

## 8. Character limit
Set the headline/summary field limit to 200 characters with a live counter that turns amber at 180 and red at 200.

## Acceptance
- [ ] A previously registered user can log in with phone in any format
- [ ] A scanned PDF, a DOCX, and a JPG resume each parse and populate the form
- [ ] Switching work status keeps the current step and all unrelated data
- [ ] Skills are selected on exactly one screen; the selection renders immediately
- [ ] The final screen has no resume upload block
- [ ] The 200-character counter works
- [ ] Profile strength percentage still updates correctly at every step

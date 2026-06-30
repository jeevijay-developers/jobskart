## Goal
Make employer job posting work end-to-end and make candidate resume parsing actually fill the onboarding/profile fields.

## 1. Fix "employer can't post a job"

Symptom: clicking **Publish job** in `/employer/jobs/new` does nothing visible / shows "Could not save". DB shows zero user-posted jobs even though RLS + GRANTs are fine.

Root causes to fix:
- Insert payload silently fails because of enum / nullability mismatches and the catch toast hides the real Postgres error.
- Trigger chain (`tg_jobs_activity_insert` → `log_employer_activity`) requires `posted_by`; we pass it but the active session can race (we call `supabase.auth.getUser()` again at submit time after a long wizard).
- Slug trigger writes to `slug` only when null — fine, but the `RETURNING` after insert sometimes fails if `select().single()` cannot read the row back (older bug from SELECT policy joins). We'll re-select explicitly.

Changes in `src/routes/_authenticated/employer/jobs.new.tsx`:
- Resolve `companyId` AND `userId` once on mount; block Publish until both are set; show inline banner if either is missing with a "Go to onboarding" CTA.
- Replace the silent catch with a typed handler that surfaces `error.code`, `error.message`, and `error.details` in the toast and `console.error` for debugging (mirrors what we did for ApplyDialog).
- Coerce enum fields to known valid values from `JOB_TYPE_OPTIONS` / `WORK_MODES`; drop the `as never` cast; only send fields with non-empty values.
- After insert, fetch the row with `.select("id, slug").single()` in a separate call (so an RLS read failure on insert-returning doesn't kill the success path).
- On success, navigate to the applicants page; on draft, to `/employer/jobs`. Always `toast.success` first.

Changes in `src/routes/_authenticated/employer/dashboard.tsx`:
- The "Post a job" CTA already links to `/employer/jobs/new`. Add a guard: if `companies.length === 0` keep redirect to onboarding (already there), else make sure the link is rendered as a real `<Link>` (it is). No regression.

Changes in `src/routes/_authenticated/onboarding/employer.tsx`:
- After `create_company_with_owner` RPC succeeds, also call `setActiveCompanyId(cid)` before navigating, so the new job route immediately finds an active company without a round-trip.

Verification:
- Re-run the flow as a fresh employer: onboarding → "Post my first job" → fill 4 steps → Publish. Confirm a row appears in `public.jobs` with `status='active'`, `posted_by = auth.uid()`, and is visible on `/jobs` (public list) and to candidates.
- Negative test: post with missing salary → see specific validation toast, not generic "Could not save".

## 2. Fix candidate resume parsing

Symptom: uploading a PDF in candidate onboarding completes upload but no fields auto-fill.

Root causes:
- `parseResume` uses `google/gemini-2.5-flash` with a `file` content part. The Lovable AI Gateway accepts PDFs for Gemini only as **inline base64 image_url for images** or as `input_file` for PDFs; the current `{ type: "file", file: {...} }` shape returns an empty `content` for many PDFs, and we silently return all-nulls.
- Even when content comes back, the system prompt allows nulls, so a degraded response = blank form with no error toast.

Changes in `src/lib/resume.functions.ts`:
- Switch PDF handling to extract text server-side first using a pure-JS parser (`unpdf` — Worker-compatible, no native deps), then send the extracted text to Gemini as a plain `text` message. Falls back to the vision path only for images.
- Keep images on `google/gemini-2.5-flash` with `image_url` (this path already works).
- Log the raw model response length and the parsed field count; throw a clear error if every field is null so the caller's toast shows "Couldn't read your resume — try a clearer PDF or fill manually" instead of a silent success.
- Tighten the prompt: instruct the model to return at least name + email + mobile + skills whenever the text contains them; reject empty objects.

Changes in `src/components/candidate/ResumeUpload.tsx`:
- Surface a warning toast when the parser returns but every important field is empty, prompting the user to retry or continue manually.
- After a successful parse, scroll the parent form into view (the onboarding wrapper) so the user sees fields filling in.

Changes in `src/routes/_authenticated/onboarding/candidate.tsx` (only the `onParsed` handler):
- Merge parsed values into the wizard state non-destructively (don't overwrite values the user has already typed). Also store the uploaded resume in `candidate-docs` and persist `candidate_documents` row immediately so it's available in the dashboard even if onboarding is interrupted.

Dependency:
- Add `unpdf` via `bun add unpdf` (pure-JS, Cloudflare Workers compatible — used inside the server function only).

Verification:
- Upload a sample resume PDF → fields for name, email, mobile, headline, skills auto-populate within ~5s.
- Upload an image (JPG) of a resume → same outcome via the vision path.
- Upload a DOCX → toast says "Auto-fill works best with PDF or image" (existing behaviour preserved).
- Upload a corrupt/blank PDF → clear error toast, no silent failure.

## Out of scope
No schema changes. No new tables. No changes to RLS or GRANTs (already correct). No UI redesign.

## Technical notes
- Job insert payload will only include keys with truthy values to avoid sending `""` into enum/text columns that have defaults.
- `unpdf` runs inside `createServerFn` only — never imported from a component — so it stays out of the client bundle.
- Resume parser will keep the existing Zod schema; only the input path to Gemini changes.

## Goal

The previous turn implemented fixes for all 8 items in the 24 June doc. This pass **verifies** the fixes against the two sample resumes (`a.1.pdf`, `b.1 (1).pdf`) and closes the small residual gaps that would still bite a real user.

## What I'll verify (with the sample resumes)

Run `parseResume` against both PDFs through `invoke-server-function` after build, and check:
- No Zod validation error like `education[i].marks: expected string, received null` (already hardened with `nstrOpt` / `nstr` transforms — confirm it survives both files).
- `full_name`, `email`, `mobile`, `city`, `headline`, `skills`, `experiences`, `education` are populated where the PDF clearly contains them.
- `years_experience` is coerced to a number (or `null`), never a string.

If either file still fails, tighten the schema (wrap each array with `.catch([])` on the element level too) and retry.

## Residual fixes to ship

### 1. Old-user login still fragile beyond the first 200 auth users
`loginOrCreateWithMobile` currently calls `supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })`. Past 200 users, a seeded/old account on a later page is missed and we fall into `createUser` → "user already registered".

Fix: query `auth.users` directly via a small SECURITY DEFINER RPC (or `supabaseAdmin.rpc`) that looks up by `phone = $1 OR email = $2` and returns `id, email, phone`. Use that instead of `listUsers`. Falls back to the current path if RPC missing.

### 2. Resume parser: harden against more null-shaped AI output
Even with `nstrOpt`, the model occasionally returns `skills: null` or an experience entry as `null`. Wrap:
- `skills: z.array(z.string()).catch([])` → also accept `null` via `.nullable().transform(v => v ?? [])`.
- Each `experiences`/`education` element: `.catch(undefined)` then `.filter(Boolean)` at the parent so one bad row doesn't fail the whole parse.

### 3. DOCX silently skipping AI — add a clearer inline notice
`ResumeUpload` already short-circuits DOCX with a toast, but the visible card still says "auto-fill in seconds". Add a small inline hint under the button: "DOCX uploads are saved as-is — for AI auto-fill, upload a PDF or image."

### 4. Image parse path — confirm Gemini accepts `image_url` data URL
The `resume.functions.ts` switch to `{ type: "image_url", image_url: { url: dataUrl } }` for `image/png|jpeg` is correct for the OpenAI-compatible gateway. Verify with a screenshot upload after the fixes land.

### 5. Onboarding polish (cosmetic, from doc screenshots)
- Headline placeholder/hint already says "max 200 chars" — confirm there's no stale `max 80` copy anywhere on `src/routes/_authenticated/candidate/profile.tsx`.
- Multi-select work-mode chips: confirm at least one chip is always selectable (no race that strips the array to empty on mount when DB column is null).
- Remove the leftover `Sparkles` icon import in `onboarding/candidate.tsx` if no longer rendered (currently still used on the Skills step — keep it; just confirm no dead imports).

## Files touched

- `src/lib/auth-mobile.functions.ts` — RPC-based old-user lookup
- `supabase/migrations/*` — `find_auth_user_by_phone_or_email` RPC (SECURITY DEFINER, restricted to service_role)
- `src/lib/resume.functions.ts` — null-tolerant arrays + per-row `.catch`
- `src/components/candidate/ResumeUpload.tsx` — inline DOCX notice
- `src/routes/_authenticated/candidate/profile.tsx` — headline hint sweep (if needed)

## Verification checklist (post-build)

1. `invoke-server-function parseResume` with `a.1.pdf` → returns populated JSON, no Zod error.
2. Same with `b.1 (1).pdf`.
3. Log in with a seeded mobile that has an auth user but no profile → reaches OTP → lands on onboarding, not "already registered".
4. Onboarding: switch fresher ↔ experienced ↔ student → step does not reset.
5. Work-mode chips: multi-select persists across save/reload.
6. Preferences step: no second "Upload resume" card.
7. Headline accepts up to 200 chars without truncation.

No DB migrations beyond the small lookup RPC.

## Jobseeker Registration Flow — Updates from 23 June doc

Apply the doc corrections to the candidate onboarding wizard (`src/routes/_authenticated/onboarding/candidate.tsx`) and supporting helpers. Scope is the **candidate onboarding + profile edit** surface only.

---

### 1. No Skips
- Remove the "Skip for now" button from the footer.
- Each step's Continue button is gated by per-step validation (see below). Back is still allowed.

### 2. Resume upload — file types & size
- Accept: `pdf, doc, docx, png, jpg, jpeg` (extension + MIME both checked).
- Max size: 5 MB (already in place); reject other types with a clear toast.
- Apply same rule in `ResumeUpload` component and the step-5 upload box.

### 3. Basics step — field validations
- **Full name**: 3–80 chars, letters/spaces/dot only, auto-capitalize words, block numbers/symbols/emoji.
- **Mobile / WhatsApp**: relabel field to **"WhatsApp number"**, prefill from OTP-verified mobile, allow user override (10-digit Indian, starts 6–9). Add a default-checked checkbox: *"Receive updates, alerts, and notifications on WhatsApp"* (store as `whatsapp_opt_in` on `candidate_profiles`).
- **Headline**: max 80 chars (already optional).
- **City**: required (already enforced).
- **DOB**: optional, must be ≥14 years old when provided.
- **Gender**: optional.

### 4. Work status step — branching
- Options: Fresher / Experienced / Student (already present).
- **Fresher**: skip Experience step; instead show **"Interested job roles"** chip input (multi-select from job-title master, with AI suggestions). Stored in `candidate_profiles.interested_roles text[]`.
- **Experienced**: Experience step becomes mandatory — must add ≥1 entry to continue.
- **Student**: Experience step relabels to **"Internships"** with fields tuned for internships (Role, Organisation, Start, End/Ongoing, Stipend optional, Description). Can skip with zero entries.

### 5. Experience step — Job title autocomplete
- Replace free-text Job title with an autocomplete that queries a new server fn `searchJobTitles` (min 3 chars, server-side LIMIT 20, no query params bleed). Backed by existing `job_categories` master + a new `job_titles_master` table seeded with common titles.
- "Designation not in list? Add it" CTA appends a custom value (also inserts into `job_titles_master` with `is_custom=true` for later admin curation).
- **Description**: optional, multi-line preserved, strip HTML tags on save, 1500-char limit.

### 6. Education step — simplified
- Onboarding only asks **Highest Qualification** (dropdown: 10th or Below, 12th Pass, Diploma, Graduate, Post Graduate, Doctorate). Stored on `candidate_profiles.highest_qualification`.
- Detailed education entries move to a **"Complete your education"** card on the candidate dashboard, where the existing table-driven form (school/board/year/marks) is shown with mandatory/optional rules per level:

```text
Level           School  Board   Year    Marks
10th-/12th      —       —       opt     opt
Diploma/Grad+   req     req     req     opt
```

### 7. Skills & Languages
- Skills suggestions remain (chip input). Add an "AI-suggested skills" row driven by selected job titles / qualification (calls a server fn `suggestSkills`).
- **Assets** chip-set becomes context-aware: based on selected interested roles / experience titles, show field-job assets (Two-wheeler, Car, Licence) vs desk assets (Laptop, Smartphone, WiFi). Asset master moves to a new `candidate_assets_master` table editable from admin.
- Languages: editable from admin (already on roadmap — master table `languages_master`).

### 8. Preferences step — conditional rules

```text
Field                 Fresher        Experienced    Student
Looking For           required       required       fixed: Internship
Work Mode             required       required       required
Preferred Cities      1–4 required   1–4 required   1–4 required
Expected Salary       optional       required       optional
Notice Period         hidden         required       hidden
```

### 9. Profile strength + badges
- Recompute `profileStrength` weights to reflect new fields (whatsapp opt-in, highest qualification, interested roles, etc.).
- Add a **Candidate Badge** chip on profile/dashboard with tiers Bronze/Silver/Gold/Platinum derived from: profile %, verifications (mobile/email/DigiLocker), resume present, education detail, experience detail, skills count, last-active recency. Pure derived value — no new table.

### 10. Profile completion & verification nudges
Add a `candidate_nudges` table + a small scheduler-less rule engine evaluated client-side on dashboard load:

```text
Stage 1  Day 0–30                Profile completion prompt        every 7 days
Stage 2  Day 30+, profile ≥50%   Verification benefits prompt     every 15 days
Stage 3  Day 45+, profile ≥70%   DigiLocker CTA                   every 30 days until verified
```

DigiLocker actual integration is **out of scope** this turn — CTA opens a "Coming soon" sheet and logs intent.

### 11. Server-side input hardening
- Centralise validators in `src/lib/validators.ts` (zod): name, mobile, headline, description, year, etc.
- All `candidate_profiles` / experience / education writes go through `createServerFn` handlers that re-validate with the same zod schema and sanitise strings (strip control chars, collapse whitespace, strip HTML).
- Storage uploads: random UUID filename + original extension only; reject anything not in the allow-list above.

### Out of scope this turn
- JobsKart Buddy bot (chat assistant, interview prep, resume guidance) — separate feature.
- DigiLocker live integration, mobile/email verification flows beyond OTP already present.
- Server-side AV scanning of uploads (will document as a follow-up; for now we enforce extension + MIME + size).
- Admin UI for the new master tables (`job_titles_master`, `candidate_assets_master`, `languages_master`) — seed via migration, expose admin CRUD next turn.

### Files & migrations

**Migration**
- Add columns to `candidate_profiles`: `whatsapp_number text`, `whatsapp_opt_in bool default true`, `highest_qualification text`, `interested_roles text[] default '{}'`.
- New tables (with GRANTs + RLS): `job_titles_master(id, title, is_custom, is_active)`, `candidate_assets_master(id, label, category)`, `languages_master(id, name)`, `candidate_nudges(user_id, kind, last_shown_at)`.
- Seed defaults for the three masters.

**Frontend**
- `src/routes/_authenticated/onboarding/candidate.tsx` — refactored steps as above.
- `src/components/candidate/JobTitleAutocomplete.tsx` (new).
- `src/components/candidate/ResumeUpload.tsx` — extend accepted types + MIME check.
- `src/lib/validators.ts` (new, zod).
- `src/lib/candidate.functions.ts` (new) — `searchJobTitles`, `suggestSkills`, `saveOnboardingStep`.
- `src/lib/profileStrength.ts` — reweight + badge tier helper.
- `src/routes/_authenticated/candidate/dashboard.tsx` — completion card, nudge banners, badge.
- `src/routes/_authenticated/candidate/profile.tsx` — full education editor table per level rules.

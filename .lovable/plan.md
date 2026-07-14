## Goal

Match the uploaded `Final_JD_Format_with_Sample.xlsx` structure so every job posted on JobsKart gets a clean, consistent JD auto-built from three inputs: **Job Title + Industry → 2-line role summary**, and **each selected Skill → one Key Responsibility line**. The current template (`src/lib/jd-template.ts`) generates responsibilities per *category* only; the new one generates them per *skill*, which is what the sample shows.

## Template model (from the Excel)

Sheet columns:

```
A: Job Title           e.g. HR Recruiter
B: Industry            e.g. Recruitment & Staffing
C: Role summary        Line 1 + Line 2  (2-line intro)
E: Skill (chip)        Calling, Follow-up, ATS, Job Posting, ...
F: Responsibility      One-liner mapped to that skill
```

Final JD = Line 1 + Line 2 + bulleted list where each bullet is the responsibility mapped to a selected skill.

## Changes

### 1. New data file: `src/lib/jd-library.ts`

Structured library shipped with the app:

```ts
export type RoleTemplate = {
  title: string;           // "HR Recruiter"
  industry: string;        // "Recruitment & Staffing"
  summary: [string, string]; // Line 1, Line 2
  skills: { skill: string; responsibility: string }[];
};
export const JD_LIBRARY: RoleTemplate[] = [ /* HR Recruiter seeded from the Excel */ ];
```

Seed with the HR Recruiter role verbatim from the sheet. Add stubs for the top 10 roles we already list (Sales Executive, Delivery Boy, Telecaller, Field Sales, Data Entry, Customer Support, Driver, Cashier, Store Manager, Beautician) so the picker isn't empty — each with a 2-line summary and 10–12 skill→responsibility pairs following the same tone. Content is short and additive; no schema changes.

### 2. Rewrite `src/lib/jd-template.ts` → new `buildJd(input)`

Inputs: `{ title, industry, selectedSkills[], summaryOverride? }`.

Logic:
- Find the closest `RoleTemplate` by exact/normalized title match; fall back to first template in the same industry; fall back to a generic summary.
- Emit Line 1 + Line 2 (editable override supported).
- For each selected skill: look up the responsibility in the template's map; if missing, generate a sensible default like `Handle tasks related to {skill}.`
- Return `{ markdown, html }` (already the shape the DB stores in `description` / `description_html`).

### 3. Wire the wizard (`src/routes/_authenticated/employer/jobs.new.tsx`)

Step 3 (Requirements) already collects a Skills chip picker. Add:
- A "Suggested skills for this role" strip populated from the matched template's skill list — one-tap add.
- Live JD preview in Step 4 rebuilds whenever title/industry/skills change (unchanged flow, new engine).
- Keep the "Regenerate" and "Edit" affordances; edits win over auto-gen.

No new fields on `jobs` — we already have `description`, `description_html`, `skills`.

### 4. Admin surface (small, optional)

Under `/admin/masters` add a "JD Library" tab: read-only list of `JD_LIBRARY` roles with the ability to copy the JSON — so we can grow the library later without a schema. (No DB persistence in this pass; the file is the source of truth for now.)

## Out of scope

- No new tables, no RLS changes.
- No new employer wizard steps — only the JD engine and Step 3/4 content change.
- Non-HR roles use short seeded stubs; the user can request more roles later or paste updated Excel sheets and we'll extend `JD_LIBRARY`.

## Verification

- Post a job with title "HR Recruiter", industry "Recruitment & Staffing", skills = {Calling, ATS, Job Posting}: JD preview shows the exact 2-line summary + the three matching responsibilities from the sample.
- Post a job for a stub role (e.g. "Sales Executive") with 5 skills: JD renders 2-line summary + 5 responsibility bullets; unknown skill falls back to generic line.
- Candidate job detail page renders `description_html` as before — no rendering regressions.

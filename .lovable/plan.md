
## Goal
Rebuild `/employer/jobs/new` to match the new spec in `JobsKart_Job_Posting_Flow.docx`, and auto-generate the JD (description) using the `JD_Auto_Generation_Template.docx`. No manual description writing — description is templated from structured fields.

## New 4-step flow

**Step 1 — Basics**
- Job title (with autocomplete from `job_titles_master`)
- Auto-suggested Category (from title → `job_categories`), user can override
- Industry (new field; from `industries` master)
- Job type · Work mode · Openings
- Gender preference: Any / Male / Female

**Step 2 — Location & Compensation**
- City, Locality, Pincode
- Pay type toggle: Fixed Only · Fixed + Incentive · Incentive Only
- Fixed salary/month range (min–max), Average incentive/month (if applicable)
- Auto-calculated yearly CTC + candidate-facing salary breakup card (min–max fixed, avg incentive, earning potential)
- Interview type: In-person / Telephonic
  - If In-person: "Same as company address?" Yes/No → Interview city, locality, address

**Step 3 — Requirements**
- Total experience: Any / Fresher only / Experienced only
- Min–Max experience sliders
- English fluency (optional): Basic / Good / Speaks Good
- Skills (chip picker from `skills_master`)
- Optional add-ons (each is a togglable section): Age range, Preferred languages, Assets, Degree & specialisation, Certification, Preferred industry
- Perks: chip picker with the full list from the doc (Flexible Hours, Weekly Payout, OT, Joining Bonus, Annual Bonus, PF, TA, Petrol, Mobile, Internet, Laptop, Health Insurance, ESI, Meals, Accommodation, 5-day week, One-way cab, Two-way cab) + "Add other perk"
- Joining fee / deposit required? Yes / No

**Step 4 — Description (auto-generated)**
- Renders a live JD preview built from Steps 1–3 using the JD template
- Editable rich-text (user can tweak before publish)
- "Regenerate from template" button
- Publish / Save as draft

## JD auto-generation

Client-side templating (no AI call needed for v1) using the spec:

```
We are looking for a {title} to join {company}[, in {industry}]. {2-line role summary from category bank}. The position offers {salaryRange}[ + incentives up to ₹{incentive}/month] and opportunities for growth.

Key Responsibilities:
- {from responsibilities bank keyed by category → fallback: skills}

Job Requirements:
Minimum qualification: {degree}. {minExp–maxExp} experience required[, or "Freshers welcome"]. Key skills: {skills}. {englishLine}. {genderLine}. Available for {shift}[, {workingDays}-day working][, own {assets}].

Perks: {perk1} · {perk2} · ...

Notes (only lines with data):
- Joining fee applicable
- Certification: {x} required
- {ageRange} preferred
- Preferred Language: ...
- Language Proficiency: ...
- Gender: ...
- Work Mode: Remote/Hybrid
- Tool/software familiarity
```

A small `src/lib/jd-template.ts` module owns:
- `RESPONSIBILITIES_BANK: Record<categorySlug, string[]>` — 8-10 curated entries per common category (Sales, Delivery, Customer Support, Data Entry, Security, Housekeeping, Driver, Telecaller, Field Sales, Retail). Fallback = skills-derived bullets.
- `ROLE_SUMMARY_BANK: Record<categorySlug, string>`
- `buildJd(input): { markdown, html }`

Optional "Improve with AI" button later — out of scope for v1.

## Data / schema changes (one migration)

Add columns to `public.jobs` (all nullable, backwards-compatible):
- `industry text`
- `gender_preference text check in ('any','male','female') default 'any'`
- `pay_type text check in ('fixed','fixed_incentive','incentive_only') default 'fixed'`
- `salary_period text default 'monthly'`
- `avg_incentive_monthly int`
- `interview_type text` — 'in_person' | 'telephonic'
- `interview_same_as_company boolean`
- `interview_city text`, `interview_locality text`, `interview_address text`
- `experience_bucket text` — 'any' | 'fresher' | 'experienced'
- `english_level text` — 'basic' | 'good' | 'speaks_good'
- `age_min int`, `age_max int`
- `preferred_languages text[]`
- `required_assets text[]`
- `degree text`, `specialisation text`
- `certifications text[]`
- `preferred_industries text[]`
- `perks text[]` (replace/augment existing perks column if present)
- `joining_fee_required boolean default false`
- `working_days int`, `shift text`
- `description_html text` (rendered JD)

Migration includes GRANTs (SELECT/INSERT/UPDATE/DELETE to authenticated, ALL to service_role, SELECT to anon — jobs are publicly listable). RLS policies stay as-is.

## Files touched

- `src/routes/_authenticated/employer/jobs.new.tsx` — full rewrite into the 4-step wizard using the existing `Questionnaire`/`Field` primitives.
- `src/lib/jd-template.ts` — new; JD builder + banks.
- `src/lib/options.ts` — add `PERKS`, `ENGLISH_LEVELS`, `PAY_TYPES`, `GENDERS`, `EXPERIENCE_BUCKETS`.
- `src/routes/jobs.$jobId.tsx` — render `description_html` when present; show new fields (interview type/address, pay breakup card, perks chips, joining-fee note).
- `src/components/site/JobCard.tsx` — surface earning potential range when `pay_type='fixed_incentive'`.
- Migration file for the `jobs` columns above.

## Out of scope
- AI JD rewriter (button stub only)
- Changes to candidate apply flow, resume parsing, admin, or credits
- Any redesign of dashboards

## Verification
- Create a job end-to-end: fill all 4 steps → preview JD → publish → row lands in `jobs` with new columns populated → visible in `/jobs` list and `/jobs/:id` detail with the new salary breakup + interview block.
- Draft path: Save as draft at any step → row inserted with `status='draft'`, appears in `/employer/jobs`.
- Fixed-only pay hides incentive fields; incentive-only hides fixed range; breakup card updates live.
- In-person interview shows address sub-form; telephonic hides it.

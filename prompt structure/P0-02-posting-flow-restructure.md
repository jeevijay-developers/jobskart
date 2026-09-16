# P0-02 — Job Posting Flow Restructure

Restructure the 4-step employer posting wizard at `src/routes/_authenticated/employer/jobs.new.tsx`. Most required columns already exist on `jobs` — this is primarily a UI reorder plus a few additions.

## New step order

| Step | Title | Contents |
|---|---|---|
| 1 | Basics | Job title, auto-selected category, **industry**, job type, work mode, openings, **gender preference** |
| 2 | Location & Pay | City, locality, pincode, **monthly salary only**, pay type, perks |
| 3 | Requirements | Experience, English level, skills, interview block, joining fee, personal-details accordion |
| 4 | Description | Auto-generated JD (built in P0-03 — leave a placeholder panel for now) |

Description moves from step 2 to step 4 so the system has enough information to generate a personalised JD.

## Step 1
- **Category auto-selects** from job title using `job_titles_master`. Show it as selected with a "Change" link — do not make the recruiter pick it
- **Industry** is a new required field, from `industries`
- **Gender preference**: `Any` / `Male` / `Female`, defaulting to `Any` → `jobs.gender_pref`

## Step 2
- **Monthly salary only.** Min and max monthly. Annual CTC renders read-only beneath: `Annual CTC: ₹X,XX,XXX - ₹X,XX,XXX`. Store in `jobs.annual_ctc_min` / `annual_ctc_max`
- **Pay type**: `Fixed Only` / `Fixed + Incentive` / `Incentive Only` → `jobs.pay_type`
- On `Fixed + Incentive`: show an Average Incentive / month field (`jobs.avg_incentive_monthly`) and an amber breakup card showing Fixed Salary / Month, Average Incentive / Month, and **Earning Potential / Month** (fixed range + incentive). Label it "Salary breakup shown to candidates"
- **Perks**: chip picker with Flexible Working Hours, Weekly Payout, Overtime Pay, Joining Bonus, Annual Bonus, PF, Travel Allowance (TA), Petrol Allowance, Mobile Allowance, Internet Allowance, Laptop, Health Insurance, ESI (ESIC), Food/Meals, Accommodation, 5 Working Days, One-Way Cab, Two-Way Cab. Plus a **`+ Add other perks`** free-text entry → `jobs.custom_perks`

## Step 3
- **Total Experience**: `Any` / `Fresher Only` / `Experienced Only` → `jobs.experience_bucket`. Show an indigo info banner explaining who can apply. On `Any`, min experience locks to "Fresher" and only max is editable
- **English fluency** (optional): Understands basic English / Understands Good English / Understands & Speaks Good English
- **Skills**: searchable multi-select from `skills_master`, suggestions ranked by the selected job title
- **Interview block**: Interview Type `In-person` / `Telephonic`
  - On `In-person`: "Is the interview address same as company address?" → Yes / No. On **No**, reveal Interview City, Interview Locality, Interview Address
  - On `Telephonic`: hide all address fields
- **Joining fee**: "Is there any joining fee or deposit required from the candidate?" Yes / No, **defaulting to No**. On Yes, require an amount and flag the job for admin moderation (`jobs.joining_fee_required`, `joining_fee_amount`)
- **Personal details accordion** (collapsed by default): Age, Preferred Language, Assets, Degree and Specialisation, Certification, Preferred Industry — each an add-chip

## Migration required
```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS annual_ctc_min integer,
  ADD COLUMN IF NOT EXISTS annual_ctc_max integer,
  ADD COLUMN IF NOT EXISTS joining_fee_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS joining_fee_amount integer,
  ADD COLUMN IF NOT EXISTS interview_same_as_company boolean,
  ADD COLUMN IF NOT EXISTS interview_city text,
  ADD COLUMN IF NOT EXISTS interview_locality text,
  ADD COLUMN IF NOT EXISTS interview_address text,
  ADD COLUMN IF NOT EXISTS custom_perks text[] NOT NULL DEFAULT '{}';
```

## Rules
- **Never render a disabled field.** If it does not apply, remove it from the DOM
- Autosave to `status='draft'` on every step change; "Save as draft" stays available throughout
- Keep the existing step-pill progress indicator and the credits badge in the header

## Acceptance
- [ ] Step order is Basics → Location & Pay → Requirements → Description
- [ ] Category auto-selects from the job title
- [ ] Only monthly salary is entered; annual CTC displays automatically
- [ ] Fixed + Incentive shows the earning-potential breakup card
- [ ] In-person + different address reveals exactly three address fields; Telephonic reveals none
- [ ] Custom perks save and appear on the public job page
- [ ] Joining fee = Yes flags the job for moderation
- [ ] An existing draft created before this change still opens without error

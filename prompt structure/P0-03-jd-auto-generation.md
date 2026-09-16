# P0-03 — JD Auto-Generation Engine

Build the deterministic JD generator that fills step 4 (Description) of the posting wizard. **This is not an AI feature.** It is a template fill from a curated library — same inputs produce the same output, instantly, at zero cost, with no invented responsibilities in a document that has legal weight.

## Tables

```sql
CREATE TABLE IF NOT EXISTS public.jd_role_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_title text NOT NULL,
  industry text,
  summary_line_1 text NOT NULL,
  summary_line_2 text NOT NULL,
  fixed_responsibilities text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_title, industry)
);

CREATE TABLE IF NOT EXISTS public.jd_skill_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill text NOT NULL,
  job_title text,
  industry text,
  responsibility text NOT NULL,
  sort int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jd_skill_resp_lookup
  ON public.jd_skill_responsibilities (lower(skill), job_title, industry);
```

Both readable by any authenticated user, writable only by platform admin.

## Seed data (HR Recruiter, Recruitment & Staffing)

`jd_role_library`:
- Line 1: "Join our growing HR team to identify, attract, and hire talented professionals across multiple functions."
- Line 2: "You will manage the complete recruitment lifecycle, coordinate with hiring managers, and ensure an excellent candidate experience."
- Fixed: Source candidates through job portals, LinkedIn, referrals, social media, and internal databases · Screen resumes and shortlist candidates based on job requirements · Coordinate interviews between candidates and hiring managers · Manage end-to-end recruitment from sourcing to onboarding

`jd_skill_responsibilities`:
| Skill | Responsibility |
|---|---|
| Calling | Conduct telephonic interviews and initial HR screening rounds. |
| Follow-up | Follow up with candidates throughout the recruitment process. |
| ATS | Maintain candidate records in ATS and recruitment trackers. |
| Job Posting | Publish and manage job postings across multiple hiring platforms. |
| Documentation | Collect and verify candidate documents before joining. |
| Offer | Prepare and communicate offer letters to selected candidates. |
| Employer Branding | Promote job openings through social media and employer branding initiatives. |
| Pipeline | Build and maintain a strong talent pipeline for future hiring needs. |
| Stakeholder Management | Coordinate with department heads to understand manpower requirements. |
| Reports | Prepare recruitment reports and hiring dashboards. |
| Compliance | Ensure recruitment processes comply with company policies. |
| Bulk Hiring | Handle mass hiring drives for blue-collar and white-collar positions. |

## Generator — `src/lib/jd-generator.ts`

Pure function. No I/O, no AI. Takes the job draft plus library rows, returns markdown.

**Output structure**
```
We are looking for a {job_title} to join {company_name}[, in {industry}].
{summary_line_1} {summary_line_2} The position offers {salary_range}
[+ incentives up to ₹{avg_incentive}/month] and opportunities for growth.

Key Responsibilities:
• (4–6 bullets)

Job Requirements:
Minimum qualification: {education}. {experience} experience required
[or "Freshers welcome"]. Key skills: {top 3 skills}. [{english_level}.]
[{gender_line} only if not Any.] Available for {shift}
[, {working_days}-day working][, own {assets}].

Perks:            ← only if any selected
• {perk} · {perk} · {perk}

Notes:            ← each line independent, only if data exists
• Joining fee applicable
• Certification: {x} required
• {age_range} preferred
• Preferred Language: {languages}
• Language Proficiency: {level}
• Work Mode: {mode}
• Tool/software familiarity: {tools}
```

**Responsibility selection**
1. All fixed responsibilities for (job_title, industry), in order
2. For each selected skill in the recruiter's order, look up a responsibility with this fallback chain: `(skill, job_title, industry)` → `(skill, job_title)` → `(skill, industry)` → `(skill)`. Append the first hit
3. Deduplicate by normalised sentence (lowercase, strip punctuation)
4. If fewer than 4, pad from the industry's generic set
5. If more than 6, keep all fixed, then skill-derived in the recruiter's skill order

**Fallback when the role is unknown**
`(title, industry)` → `(title, any)` → `(category, industry)` → generic industry template → generic skills-only JD. The generator never returns empty. When it reaches the last rung, mark the result `low_confidence: true`.

**Salary rendering by `pay_type`**
- `fixed` → `₹{min} - ₹{max} per month`
- `fixed_incentive` → `₹{min} - ₹{max} fixed + up to ₹{avg} incentive · Earning potential ₹{min} - ₹{max+avg}`
- `incentive_only` → `Incentive-based · Earning potential up to ₹{avg}/month`

## UI — step 4 of the wizard
- A **Suggested Template** panel at the top, scrollable, with an **Apply** button
- Below it, an editable rich-text field (bold, italic, bullet list, numbered list)
- Apply copies the generated JD into the editor. The recruiter can then edit freely
- Never auto-submit generated text without the recruiter pressing Apply
- Regenerate button re-runs the generator after any earlier-step edits
- In the job card, this content surfaces behind **"Know more…"**

## Acceptance
- [ ] Both tables exist and are seeded with the HR Recruiter data
- [ ] Generating for HR Recruiter + Recruitment & Staffing + {Calling, ATS, Reports} produces 4–6 correct bullets with no duplicates
- [ ] An unknown job title still produces a complete, sensible JD
- [ ] All three pay types render correctly, and the JD figures match the salary card exactly
- [ ] Perks and Notes sections are omitted entirely when the data is absent
- [ ] Apply fills the editor; edits persist to `jobs.description`
- [ ] No AI call is made anywhere in this flow

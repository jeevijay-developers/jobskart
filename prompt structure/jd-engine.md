# JobsKart — JD Auto-Generation Engine

**This is not an LLM feature.** It is a deterministic template fill from a curated library. Same inputs → same output, every time, instantly, at zero API cost, with no hallucinated responsibilities in a legal-adjacent document.

An optional AI polish pass may sit *on top*, but the deterministic path must produce a complete, publishable JD on its own.

---

## 1. Where it appears

Posting wizard, final step ("Description"). By this point the recruiter has already given title, industry, category, salary, experience, skills, shift, working days, perks, and requirements. The engine turns that into prose. In the job card it surfaces as **"Know more…"**.

Rendered as an editable rich-text field with a **Suggested Template → Apply** panel above it. The recruiter can accept, edit, or ignore. Never auto-submit generated text without a visible accept action.

---

## 2. Data sources

| Table | Role |
|---|---|
| `jd_role_library` | Per (job_title, industry): two summary lines + fixed responsibilities |
| `jd_skill_responsibilities` | Per skill: one responsibility sentence, optionally scoped to title/industry |

Seeded from `Final_JD_Format_with_Sample.xlsx`. The sheet's structure maps directly:

- *2-line role summary → Line 1 / Line 2* → `jd_role_library.summary_line_1` / `_2`
- *Skills → Skill based Responsibilities* → `jd_skill_responsibilities`
- *Fixed Responsibilities* → `jd_role_library.fixed_responsibilities`

---

## 3. Output structure

```
We are looking for a {job_title} to join {company_name}[, in {industry}].
{summary_line_1} {summary_line_2}
The position offers {salary_range}[ + incentives up to ₹{avg_incentive}/month]
and opportunities for growth.

Key Responsibilities:
• {4–6 bullets}

Job Requirements:
Minimum qualification: {education}. {experience} experience required
[, or "Freshers welcome"]. Key skills: {skill_1}, {skill_2}, {skill_3}.
[{english_level}.] [{gender_line} — only if not "Any".]
Available for {shift}[, {working_days}-day working][, own {assets}].

Perks:                       ← only if selected
• {perk_1} · {perk_2} · {perk_3}

Notes:                       ← each line independent, shown only if data exists
• Joining fee applicable
• Certification: {x} required
• {age_range} preferred
• Preferred Language: {languages}
• Language Proficiency: {level}
• Work Mode: {mode}
• Tool/software familiarity: {tools}
```

---

## 4. Responsibility selection algorithm

Target 4–6 bullets, ordered, deduplicated.

```
1. Fixed responsibilities for (job_title, industry)     → always included, in order
2. For each selected skill, in the recruiter's order:
     lookup jd_skill_responsibilities
       exact (skill, job_title, industry)
       → (skill, job_title)
       → (skill, industry)
       → (skill)
     append first hit
3. Deduplicate by normalised sentence (lowercase, strip punctuation)
4. If total < 4: pad from the industry's generic responsibility set
5. If total > 6: keep all fixed, then skill-derived by recruiter's skill order
```

**Fallback chain when the role is unknown:**
`(title, industry)` → `(title, any industry)` → `(category, industry)` → generic industry template → **generic skills-only JD**. The engine never returns empty. If it reaches the last rung, it produces a skills-based JD and flags `low_confidence` so admin can see which titles need library entries.

---

## 5. Salary rendering

Driven by `pay_type`:

| pay_type | Rendered |
|---|---|
| `fixed` | `₹{min} - ₹{max} per month` |
| `fixed_incentive` | `₹{min} - ₹{max} fixed + up to ₹{avg_incentive} incentive · Earning potential ₹{min} - ₹{max + incentive}` |
| `incentive_only` | `Incentive-based · Earning potential up to ₹{avg_incentive}/month` |

The candidate-facing breakup card (Fixed / Average Incentive / Earning Potential) uses the same computed values, so the JD text and the salary card can never disagree.

---

## 6. Admin tooling

At `/admin/masters`:
- CRUD on both JD tables
- Bulk import from the client's xlsx format
- **Coverage report:** job titles used in live jobs with no library entry, ranked by posting frequency. This is the backlog that keeps the engine's quality rising without any model work.
- Preview: pick a title + skills, see the generated JD

---

## 7. Optional AI polish (P1, not P0)

If enabled, a single pass takes the deterministic JD and rewrites it for tone only. Hard constraints: it may not add responsibilities, may not alter salary/experience/qualification figures, and must return within 3s or the deterministic output ships unchanged. Route through the `src/lib/ai/provider.ts` adapter (see `architecture.md` R1). Validate the result against the original numbers before displaying.

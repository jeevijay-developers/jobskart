# JobsKart — Design & UX Specification

Design principle for this product: **reduce perceived effort, not just field count.** The primary user is a mobile, low-confidence, often first-time job seeker typing on a small keyboard, frequently in Hindi-first contexts. Every design decision below follows from that.

---

## 1. Design system (already in place — keep)

Tailwind 4 + shadcn/ui + Radix primitives, `lucide-react` icons, `framer-motion` for transitions, `sonner` for toasts.

| Token | Use |
|---|---|
| Primary blue | Actions, active step, selected chips |
| Deep navy gradient | Wizard headers (candidate onboarding) |
| Amber surface | Salary breakup, informational callouts |
| Indigo banner | Inline system explanations |
| Red asterisk | Required fields only |

Rules: one primary action per screen; chips for anything with a knowable option set; helper text below the field, never in the placeholder; errors inline under the field, never as toast-only.

---

## 2. Candidate onboarding — 5 steps

`Basics → Work status → Experience/Education → Skills & languages → Preferences`

Live behaviour: profile strength shown as a percentage in the header (22% → 62% → 72%), step pills, per-step autosave.

### Fixes required (24-June client list)

| # | Issue | Fix |
|---|---|---|
| 1 | Existing users cannot log in | Trace `find_auth_user_by_phone_or_email()` — likely phone-format normalisation (`+91` prefix vs bare 10 digits). Normalise to E.164 at both write and lookup |
| 2 | Some PDF resumes do not parse | Text-layer PDFs go through `unpdf`; scanned/image PDFs must fall back to the vision path. Detect: extracted text < 200 chars → treat as scanned |
| 3 | Image and DOCX upload accepted but parsing never starts | Parsing is only wired for PDF. Route by MIME: images → vision, DOCX → `mammoth` text extraction → same parser |
| 4 | Switching work status resets wizard to step 1 | Work-status change must invalidate only the dependent step's fields, not remount the wizard. Preserve step index and all unrelated answers |
| 5 | AI skills appear but selection does not render | Skill selection appears on two screens. **Pick one** — the role-selection screen. Remove from the later screen; show a read-only summary there |
| 6 | Single selection where multiple is needed | Convert to multi-select chips |
| 7 | Duplicate resume upload on final screen | Remove. Upload exists at step 1 |
| 8 | Word limit | Set to 200 characters, with a live counter |

**On #5's open question** ("will AI suggest skills, or fetch from our DB?"): DB-first. Query `skills_master` filtered by the selected job roles, ranked by usage frequency. Only when a role has fewer than 5 mapped skills does the AI path fill the gap — and anything it returns gets written back to `skills_master` for admin review. Faster, free, consistent, and it improves the master data instead of bypassing it.

### UX improvements (P0-adjacent, cheap)
- Chips over typing everywhere: roles, skills, salary bands, cities, languages
- Max 4 job roles, max 3 preferred cities
- Salary as pre-defined monthly bands, not a free-text number
- Education deferred — collect after first application (progressive profiling)
- Autosave every step; a dropped connection must never cost entered data
- Fresher vs Experienced vs Student branches to different step 3 content

---

## 3. Employer job posting — 4 steps (restructured)

Per the client's posting-flow document, the order changes:

| Step | Was | Now |
|---|---|---|
| 1 | Basics | **Basics** — title, auto-selected category, **industry**, job type, work mode, openings, **gender preference** |
| 2 | Description | **Location & Pay** — city, locality, pincode, **monthly salary only** (annual CTC auto-calculated and displayed), pay type, perks |
| 3 | Location & Pay | **Requirements** — experience bucket, min/max experience, English level, skills, interview type block, joining fee, personal details accordion |
| 4 | Requirements | **Description** — JD auto-generated from everything above, with Suggested Template → Apply |

Description moves last precisely because by then the system knows enough to generate a personalised JD instead of asking the recruiter to write one from nothing.

**Step 2 specifics**
- Monthly salary is the only input. Annual CTC renders read-only beneath it (`monthly × 12`)
- Pay type: `Fixed Only` / `Fixed + Incentive` / `Incentive Only`
- On `Fixed + Incentive`: show the amber salary-breakup card (Fixed / Average Incentive / Earning Potential) exactly as the candidate will see it
- Perks: chip picker plus **`+ Add other perks`** free-text for custom entries → `jobs.custom_perks`

**Step 3 specifics**
- Interview type `In-person` reveals: *Is the interview address same as company address?* → Yes / No. On No: interview city, locality, address
- `Telephonic` hides all address fields
- Experience bucket `Any` / `Fresher Only` / `Experienced Only`, with the indigo explainer banner
- Joining fee: Yes / No, defaulting to **No**. On Yes, amount required, and the job is flagged for moderation — joining-fee jobs are the single highest fraud vector on this category of platform
- Personal details accordion (collapsed by default): Age, Preferred Language, Assets, Degree & Specialisation, Certification, Preferred Industry

**Conditional rendering rule:** never render a disabled field. If it does not apply, it is not on screen.

---

## 4. Job quality score (P0 shell, P1 depth)

A live 0–100 meter in the posting wizard: completeness (40), specificity of skills and responsibilities (25), salary transparency (20), response-time history (15). Shows the single highest-impact missing item rather than a checklist — one clear next action outperforms a list of gaps.

---

## 5. Employer candidate database

- Blocked until an **active** job is selected. Empty state names the reason and links to Post a Job — never a bare "no access" message
- Job selector pinned to the top; remaining unlock allowance always visible (`18 of 25 unlocks left on this job`)
- Locked cards: initials, city, experience band, skills, match score, tags. No masked-looking phone strings — showing `98XXXXXX21` invites brute-force and looks cheap
- Unlock confirm dialog states cost, source (allowance or credits), and the resulting balance **before** the action
- Already-unlocked candidates show `Unlocked` with no cost and open instantly
- Broadening stage labels always visible (see `matching.md §4`)

---

## 6. Mobile rules

- Single column below 768px; wizard steps become a compact progress bar
- Touch targets ≥44px; chips ≥36px tall
- `inputmode="numeric"` on salary, experience, pincode, OTP
- Sticky bottom action bar for Back/Next — thumb reachable
- Keyboard must never obscure the active field or the primary action

---

## 7. Language

Hindi + English at launch, regional languages in P1. All user-facing strings through an i18n layer from the start — retrofitting hardcoded strings across 180 files is the expensive version of this task.

Register: respectful Hindi (`aap`), never `tu`. Job seekers on this platform are frequently addressed disrespectfully elsewhere; getting the register right is a genuine differentiator with this audience.

---

## 8. Empty states

Every empty state names the cause and gives one action. Never a bare illustration with "Nothing here".

| Screen | Message | Action |
|---|---|---|
| Candidate feed | No jobs match your preferences in {city} yet | Widen preferences |
| Applications | You have not applied yet | Browse jobs |
| Employer responses | No responses yet — jobs typically receive first responses within 48 hours | Boost this job |
| Candidate DB (no job) | Select an active job to search candidates | Post a job |
| Candidate DB (no results) | Never reached — the broadening ladder always returns something, labelled |

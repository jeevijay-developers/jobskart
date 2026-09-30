# Job Quality Score System — Implementation Plan

## Goals

- Show completion percentage while a recruiter creates/edits a job
- Display an optimization score on every job (wizard, jobs list, job detail)
- Recommend specific missing improvements, with deep links to fix them
- Gamify the recruiter posting flow (levels, badges, progress, celebration)
- Reduce posting abandonment (drafts show "X% complete — finish now")

## What already exists (build on it, don't duplicate)

- `jobs.quality_score` (integer, default 0) — column exists since the first migration but is
  **never computed anywhere**. This plan makes it real.
- `src/lib/profileStrength.ts` — the candidate-side precedent: pure `computeProfileStrength()`
  + `strengthLabel()` + `getIncompleteProfileFields()` returning `{ key, sectionId, label }`.
  The job quality module mirrors this exact shape.
- `JobWizard.tsx` — 4 steps (Basics / Location & Pay / Requirements / Description), draft
  saving already supported (`status='draft'`), per-step `validateStep()`.
- `employer_activity` — required telemetry sink for every privileged action (rule 6).
- `match_scoring_config` — admin-editable ranking weights; feed ranking already has bonus
  slots (tier/boost/freshness) where a quality bonus can plug in.

## Architecture decisions

1. **Two computation surfaces, one spec:**
   - **Pure TS module** `src/lib/jobQuality.ts` for instant client feedback in the wizard
     (recruiter's *own* data — same allowance as the candidate match-% badge, rule 4).
   - **Postgres function** `compute_job_quality(job_row)` that persists `jobs.quality_score`
     via trigger on insert/update — the DB value is the source of truth for feed ranking and
     any cross-user display. Both implement the identical rubric below.
2. **Score is deterministic and rubric-based, not AI.** No third-party dependency, never
   blocks (rule 7). AI-assisted tips can come later via `src/lib/ai/provider.ts`.
3. **Advisory only.** A low score never blocks publishing — it warns and recommends.
   Blocking low-quality posts is a separate policy decision (a minimum-score gate for the
   `trending` tier only is a natural later step, since Trending is the paid visibility product).

## The rubric (100 points)

| Group | Points | Checks |
|---|---|---|
| **Core completeness** (40) | 5 each | title, category, industry, city, locality, job_type, work_mode, openings |
| **Compensation** (20) | 10 | min AND max salary present (or avg_incentive for incentive_only) |
| | 5 | salary range width sensible (max ≥ min × 1.2) |
| | 5 | pay_type selected |
| **Requirements** (15) | 5 | experience_bucket set (not "any") |
| | 5 | ≥ 3 skills |
| | 5 | education OR certifications OR preferred_languages present |
| **Description** (15) | 5 | description ≥ 300 chars |
| | 5 | description_html present (formatted JD) |
| | 5 | description contains salary/benefits mention (regex on JD template markers) |
| **Conversion boosters** (10) | 3 | perks ≥ 2 |
| | 3 | interview_type set |
| | 2 | shift + working_days set |
| | 2 | pincode present |

- **Completion %** (wizard progress) = points earned from *filled fields* only, normalized —
  shown live as the recruiter types.
- **Optimization score** = full rubric output, 0–100, persisted to `jobs.quality_score`.
- Labels reuse the `strengthLabel()` pattern: ≥80 Excellent / ≥60 Good / ≥40 Fair / <40 Needs work.

## Phase 1 — Pure logic module

New file: `src/lib/jobQuality.ts`

- `type JobQualityInput` — subset of the `jobs` row (all rubric fields)
- `computeJobQuality(input): number` — the rubric
- `jobQualityLabel(score): { label, color }`
- `getMissingJobImprovements(input): { key, step, label, points }[]` — each failing check,
  tagged with the **wizard step index** (0–3) that fixes it, sorted by points descending.
  Mirrors `getIncompleteProfileFields()` so the UI pattern is identical.
- No I/O → unit-testable per the pure-logic layer convention (`CLAUDE.md`)

## Phase 2 — Database

Migration: `supabase/migrations/<ts>_job_quality_score.sql`
(scaffold with `supabase migration new job_quality_score`; guarded/re-runnable DDL)

- `compute_job_quality(jobs) RETURNS integer` — SQL implementation of the same rubric,
  `SET search_path = public`
- Trigger `tg_jobs_quality_score` BEFORE INSERT/UPDATE on `jobs` → sets `quality_score`
  (server-side source of truth; also covers the bulk-insert path and the seed path)
- Backfill statement in the same migration: recompute for all existing rows
- Optional (recommended): add `quality` weight slot to `match_scoring_config` JSONB and
  include a small quality bonus in the feed-ranking DB function — a genuinely better post
  ranking higher is the honest version of gamification (no dark patterns, per the
  "deliberate reshapes" note in CLAUDE.md)
- `employer_activity`: log `job_quality_improved` when an update raises the score across a
  label boundary (e.g. Fair → Good) — powers gamification stats without a new table

## Phase 3 — Wizard UI (reduce abandonment)

In `src/components/employer/JobWizard.tsx`:

- **Live completion ring** in the wizard header: "Job strength: 65% — Great start" with a
  small circular progress (recharts or CSS conic-gradient), recomputed on every form change
  via `computeJobQuality(formAsJobInput)` — instant, no network
- **Step checkmarks**: each of the 4 step chips shows ✓ when its group's checks pass
- **"Improve this post" panel** at the bottom of step 4 (Description/review):
  renders `getMissingJobImprovements()` as a checklist; clicking an item jumps to the
  wizard step that fixes it (`setStep(item.step)`) and highlights the field
- **Publish nudge**: if score < 40 at publish time, show a non-blocking confirm —
  "Posts with complete pay and skills get up to 3× more applications. Publish anyway?"
- **Celebration**: crossing 80+ fires a one-shot confetti/animation (framer-motion is already
  a dependency) + toast "Excellent post! Top 10% quality"
- **Draft rescue**: when loading an existing draft, show its current score and the top 3
  missing improvements immediately — "You're 70% done, 2 minutes to finish"

## Phase 4 — Jobs list & detail (recruiter dashboard)

In `src/routes/_authenticated/employer/jobs.tsx`:

- **Score badge** per job card: colored pill from `jobQualityLabel(job.quality_score)`
  (column already selected — it's currently deleted from filters at line 219; keep it in the
  row payload)
- **"Improve" CTA** on Fair/Needs-work jobs → opens the edit wizard focused on the first
  missing improvement (pass `?improve=1` or scroll/step param)
- **Drafts section**: show "X% complete — finish now" progress bar per draft
- **Company-level gamification strip** at the top of the jobs page:
  - Average quality across active jobs
  - Level derived from avg score + volume (e.g. Starter / Pro / Elite poster) — pure
    presentation from existing data, no new tables
  - "N of your posts are Excellent" counter
- Job detail / applicants page: same badge next to the title

## Phase 5 — Bulk posting & admin

- `src/lib/bulk-jobs.functions.ts` — run the rubric per row in bulk-upload validation;
  return a `quality_score` + top missing field column in the validation report so
  consultancies can fix spreadsheets before upload
- Admin overview (`src/lib/admin-overview.functions.ts`) — platform-wide quality
  distribution (avg score, % posts ≥ 60) so the team can track "increase posting quality"
  as a real metric

## Files touched

| File | Change |
|---|---|
| `src/lib/jobQuality.ts` | new pure-logic module (rubric + improvements) |
| `supabase/migrations/<ts>_job_quality_score.sql` | SQL rubric fn, trigger, backfill, config slot |
| `src/components/employer/JobWizard.tsx` | completion ring, step checkmarks, improve panel, publish nudge, celebration |
| `src/routes/_authenticated/employer/jobs.tsx` | score badges, improve CTA, draft progress, gamification strip |
| `src/lib/bulk-jobs.functions.ts` | quality column in bulk validation |
| `src/lib/admin-overview.functions.ts` | quality distribution metric |
| `src/integrations/supabase/types.ts` | regenerate after migration |

## Build order & verification

1. **`jobQuality.ts`** — rubric in pure TS; hand-verify against 3–4 real job rows from the DB
2. **Migration** — SQL fn + trigger; verify `compute_job_quality` (SQL) and
   `computeJobQuality` (TS) return identical scores for the same rows (parity check is the
   critical correctness gate — drift between the two silently breaks trust in the number)
3. **Wizard UI** — run-through: new job (ring climbs live), draft resume, publish nudge
   at low score, confetti at 80+, improve-panel deep links land on the right step
4. **Jobs list** — badges, draft progress, gamification strip with real data
5. **Bulk + admin** — validation report column; overview metric
6. `bun run lint` + `bun run build` (no test runner in this repo)

## Key design decisions to sign off

- **(a)** Rubric weights above (Compensation is the heaviest single group — pay transparency
  drives candidate conversion in blue/grey-collar hiring)
- **(b)** Score never blocks publishing; publish nudge is a confirm dialog only
- **(c)** Quality bonus in feed ranking: included (small weight, admin-tunable) vs deferred
- **(d)** Gamification stays presentation-only (levels/badges derived from existing data) —
  no points economy, no new tables, no dark patterns

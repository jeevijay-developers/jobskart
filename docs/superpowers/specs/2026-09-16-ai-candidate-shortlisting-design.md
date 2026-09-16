# AI candidate shortlisting — audit + design (research only, no code this session)

## Phase 1 — What already exists

**Not a stub. The "AI shortlist" tab on `/employer/responses` is a real, working feature** — the "Pick a job in Filter above" message the product owner saw is just its empty state before a job is selected in the shared Filter sheet, not evidence of missing backend.

Backing code:
- `src/lib/ai-shortlist.functions.ts` — `recommendShortlist` server function (TanStack `createServerFn`)
- `src/routes/_authenticated/employer/responses.tsx` — the "AI shortlist" tab UI (lines ~343–622)
- `application_ai_scores` table (migration `20260630002107`) — per-job/per-application score cache

What it does today:
1. Loads up to the 50 most-recently-created applications for the selected job.
2. For any application without a cache hit younger than 1 hour (or when the employer clicks "Refresh"), builds **one single AI call** covering all uncached candidates at once — not one call per candidate.
3. Scoring input per candidate is pulled from `candidate_profiles`: `headline`, `last_role`, `years_experience`, `skills`, `bio` (first 300 chars). Prompt-coded weights: skill overlap 50%, experience fit 25%, role/title relevance 15%, location 10%.
4. Writes results to `application_ai_scores` via `supabaseAdmin` (service role), keyed `(job_id, application_id)`.
5. UI renders a ranked list (highest score first) with a score badge, 2–4 bullet reasons, a one-line summary, and **Shortlist / Interview / Reject** buttons per candidate.
6. Those buttons call `askConfirm` → `confirmStatusChange` — **the exact same status-change path used by the Inbox tab**, including the same confirmation dialog and the same `NOTIFY_STATUSES` email-notification trigger. No parallel status-change path exists. (Confirmed by grep — both tabs call the same two functions.)

Gaps found (not bugs — this is a feature that stopped partway through its natural scope, not broken code):
- **Doesn't use `chatJSON()`.** It calls `chat({ json: true })` and hand-rolls `JSON.parse` with a markdown-fence-stripping fallback — the same duplicated pattern as `resume.functions.ts`, instead of the Zod-schema-validated `chatJSON<T>()` from `src/lib/ai/provider.ts` that CLAUDE.md flags as the right tool for this.
- **No "how many to shortlist" control.** The UI shows every scored applicant; there's no top-N input or bulk "shortlist the top N" action.
- **Application form answers unused.** `applications.cover_note`, `expected_salary`, `available_from` are captured at apply time but never sent to the scoring prompt.
- **Resume text unused** (see below — turns out this barely matters right now).
- **Hard 50-applicant ceiling** with no pagination or notice if a job ever exceeds it.
- Job fields `education`, `english_level`, `age_min/age_max`, `gender_pref` exist but aren't in the prompt. `age_min/max` and `gender_pref` should **stay** out — see recommendation.

### Is resume text retrievable post-apply?

No, and — after checking real data — **this doesn't matter as much as it sounds like it would.**

- `resume.functions.ts` parses PDF/DOCX/image resumes via `unpdf`/`mammoth`/vision fallback, but only returns **structured fields** (name, skills, experience entries, education) to the caller. The raw extracted resume *text* is never persisted anywhere — not on `candidate_profiles`, not on `applications`. Only the structured output survives, written into `candidate_profiles` by the onboarding flow.
- The original PDF/DOCX file *is* kept — `candidate_profiles.resume_url` points into the private `candidate-docs` storage bucket (RLS: owner-only read). A server function running as service role could fetch that file and re-run the same PDF/DOCX extraction + `chatJSON` re-parse on demand, so it's technically feasible to reconstruct resume text post-apply.
- **But querying the live database shows this would help almost nobody today: only 2 of 114 candidate profiles have a `resume_url` at all.** Nearly every candidate on this platform fills the structured onboarding form directly rather than uploading a resume file. So the fields `ai-shortlist.functions.ts` already scores against (`skills`, `years_experience`, `headline`, `last_role`, `bio`) are actually the *primary* data source for essentially the whole candidate base right now, not a fallback. Building a resume-text re-fetch pipeline would be real engineering effort in service of ~2% of profiles.

### Real applicant volume (queried live, not assumed)

```
total_applications (platform-wide): 3
cached_ai_scores:                    0   (feature has real applicants to work with but hasn't been exercised on them yet)
max applicants on any single job:    2
```

This is a brand-new/dev-data platform, not a "many applicants per job" situation yet. That number should directly drive the design decision below — there is no volume problem to solve for.

---

## Phase 2 — Ranking approach

Three approaches were evaluated, as scoped:

| Approach | Accuracy | AI calls | Latency | Complexity | Fit today |
|---|---|---|---|---|---|
| **A. One batched call per job** (send job + all candidates, ask for ranked/scored JSON) | Good — model sees all candidates side by side, naturally comparative | 1 per shortlist load | Low–medium, scales with total prompt size | Low | ✅ Already built this way |
| B. One call per candidate (or small batches), rank client/server-side after | Slightly more consistent per-candidate reasoning, easier to isolate one bad score | N calls (or N/batch-size) | Higher — N sequential/parallel round trips | Medium | Overkill now; only pays off past dozens of candidates per job |
| C. Cheap non-AI pre-filter (keyword/skill overlap) → AI pass only on top subset | Cheapest at scale, protects against huge applicant pools | 1, on a subset | Low | Medium (two scoring paths to keep consistent) | Solves a scale problem this platform doesn't have (max 2 applicants/job) |

**Recommendation: keep Approach A** — which is what's already implemented — and treat this as a refinement task, not a rebuild. With 0–2 applicants per job today, per-candidate calls (B) only add latency and cost for no accuracy gain, and a pre-filter (C) is solving for applicant volumes that don't exist on this platform yet (YAGNI). Approach A's real ceiling is prompt size once a job has hundreds of applicants with full bios — worth a documented limit (e.g. re-introduce pre-filtering as Approach C, but only if/when a job's applicant count actually approaches that), not something to build speculatively now.

Concrete refinements recommended for a future implementation pass, in priority order:
1. **Swap manual `JSON.parse` for `chatJSON()` + a Zod schema** (`{ results: [{ application_id, score, reasons, summary }] }`) — gets schema validation for free, matches the provider contract CLAUDE.md calls out, removes the duplicated fence-stripping logic.
2. **Feed `cover_note`, `expected_salary`, `available_from` into the prompt** alongside the existing profile fields — these are direct signal the employer already asked for at apply time and currently go unused.
3. **Add a "Shortlist top N" control**: a numeric input (default e.g. 10) next to the existing Refresh button on the AI tab. On submit, it doesn't invent a new mutation — it pre-selects the top N rows already ranked on screen and runs the *existing* `askConfirm`/`confirmStatusChange` status update for each, behind one confirmation dialog listing all N names before committing (matches the existing "nothing commits without a confirm step" pattern already used for single rows).
4. **Explicitly exclude `age_min/age_max` and `gender_pref`** from ever entering the AI prompt — these are the job's *candidate-search filter* fields, not signals that should factor into an individual applicant's fit score. Including protected-characteristic-adjacent fields in an AI-generated hiring score is a discrimination-risk surface worth closing off by design rather than by convention.
5. Leave resume-text re-fetching **out of scope** given the 2/114 data point above — revisit only if resume upload adoption actually rises later.
6. Document/raise the 50-applicant cap with a visible "showing most recent 50" notice if a job ever hits it, rather than silently truncating.

## Design sketch (UI/integration — not implemented)

- **Job selector**: reuse the existing shared Filter sheet (`jobFilter` state) already gating this tab — no new selector needed.
- **"How many to shortlist" input**: small numeric field + "Shortlist top N" button in the AI tab's header row, next to the existing Refresh action. Disabled until a job is selected, same as the tab itself.
- **Ranked results list**: keep the current card layout (rank badge, name, score badge with the existing color thresholds, one-line summary, bullet reasons, per-row Shortlist/Interview/Reject) — it already does what the brief asks for (present ranked results with score + reasoning per candidate before anything commits).
- **Committing a batch**: clicking "Shortlist top N" opens one `AlertDialog` (the same component already used for single-row confirms) listing the N candidates about to move, Confirm runs the existing per-row status-change call in a loop and reuses `NOTIFY_STATUSES` — **no new mutation, no new notification path**, exactly as the original brief asked to confirm.

## Out of scope for this doc (explicitly, per the requesting brief)

No implementation code was written in this session. This spec is the handoff artifact for a future task; the four refinements above (in priority order) are the recommended next implementation slice, sized to be one coherent piece of work rather than a rebuild of the existing feature.

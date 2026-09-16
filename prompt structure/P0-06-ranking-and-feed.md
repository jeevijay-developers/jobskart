# P0-06 — Server-Side Ranking & Feed Ordering

Move commercial ranking out of the browser. Requires P0-04 and P0-05.

## Why this moves
`src/lib/matching.ts` scores in the browser today. That is fine for the candidate's own "match %" badge — it uses only the candidate's own data and needs to be instant. It is **not** fine for feed ordering, because tier and boost weights are commercial parameters and must not be visible or tunable client-side.

Keep `matching.ts` for the badge. Add server-side ranking for ordering.

## Config
Use the existing `match_scoring_config` table. Seed:
```jsonc
{
  "w_skills": 60, "w_location": 20, "w_experience": 15, "w_salary": 5,
  "tier_bonus": { "classic": 0, "classic_plus": 5, "trending": 25 },
  "boost_bonus_max": 30, "boost_window_hours": 24,
  "freshness_bonus_max": 20, "freshness_halflife_days": 7
}
```
Admin-editable at `/admin/masters`. Never hardcode these numbers.

## Base relevancy (0–100)
| Component | Weight | Calculation |
|---|---|---|
| Skills overlap | 60 | `matched / required × 60` |
| Location | 20 | Exact city 20 · in preferred cities 20 · same state 10 · pan-India job 12 · else 0 |
| Experience | 15 | Inside band 15 · within 1 year 8 · outside 0. `experience_bucket='any'` → full 15 |
| Salary | 5 | Expected ≤ job max 5 · within 20% 3 · else 0 |

**Skill normalisation is mandatory.** Match through `skills_master` synonyms so "MS Office", "Microsoft Office" and "MS-Office" resolve to one skill. Raw string comparison silently destroys the heaviest weight in the formula. Add a `synonyms text[]` column to `skills_master` if absent.

## Feed rank
```
rank = base_relevancy + tier_bonus + boost_bonus + freshness_bonus
```
- `boost_bonus` = `boost_bonus_max × (1 − elapsed/window)`, from the active `job_boosts` row
- `freshness_bonus` = `freshness_bonus_max × 0.5^(days_since_posted / halflife_days)`

Deliberate consequence: a strong match on a Classic job can outrank a boosted Trending job. **This is correct.** A feed where money always wins stops being useful, candidates leave, and the paid placement loses its value. Do not "fix" this.

Exclude anything with `status != 'active'` or `expires_at < now()`.

## Implementation
`rank_jobs_for_candidate(_candidate_id uuid, _filters jsonb, _limit int, _offset int)` — `SECURITY DEFINER`, returns jobs with a `rank_score` and a `match_score`.

For anonymous visitors (no candidate profile), rank on tier + boost + freshness only, with location from the IP/selected city.

## Indexes
```sql
CREATE INDEX IF NOT EXISTS jobs_feed_idx
  ON public.jobs (status, city, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS jobs_skills_gin ON public.jobs USING gin (skills);
CREATE INDEX IF NOT EXISTS cand_skills_gin ON public.candidate_profiles USING gin (skills);
```

## Acceptance
- [ ] Feed ordering comes from the RPC; no ranking weights appear in any client bundle
- [ ] Trending outranks Classic at equal relevancy
- [ ] Classic+ does **not** outrank Classic beyond its small bonus
- [ ] An active boost lifts a job, and the lift decays over the window
- [ ] A high-relevancy Classic job can beat a low-relevancy Trending job
- [ ] Skill synonyms match correctly
- [ ] Expired and paused jobs never appear
- [ ] Feed p95 under 500ms with 10k jobs

# JobsKart — Matching, Ranking & Recommendations

Three distinct scoring surfaces. They share weights but not trust levels.

| Surface | Where it runs | Why |
|---|---|---|
| Candidate's "match %" on a job card | Client (`src/lib/matching.ts`) | Instant, harmless, uses only the candidate's own data |
| Job feed ordering | Server (Postgres) | Involves tier and boost — commercial, must not be client-tunable |
| Recruiter-facing candidate ranking | Server (Postgres) | Ranks *other people's* data behind a paywall. Never in the browser |

---

## 1. Base relevancy score (0–100)

Current weights (already in `matching.ts`, keep them, move to `match_scoring_config`):

| Component | Weight | Calculation |
|---|---|---|
| Skills overlap | 60 | `matched_skills / required_skills × 60` |
| Location | 20 | Exact city 20 · preferred-city list 20 · same state 10 · pan-India job 12 · else 0 |
| Experience fit | 15 | Inside band 15 · within 1 yr 8 · outside 0. `experience_bucket='any'` → full 15 |
| Salary overlap | 5 | Expected ≤ max 5 · within 20% 3 · else 0 |

Skill matching must normalise through `skills_master` synonyms — "MS Office" / "Microsoft Office" / "MS-Office" are one skill. Raw string comparison silently destroys the largest weight in the formula.

---

## 2. Job feed ranking

```
rank = base_relevancy
     + tier_bonus          (classic 0 · classic_plus 5 · trending 25)
     + boost_bonus         (max 30, decaying linearly over 24h)
     + freshness_bonus     (max 20, halving every 7 days)
```

All coefficients from `match_scoring_config`, admin-editable.

Deliberate consequence: an excellent match on a Classic job can outrank a boosted Trending job. That is correct. A feed where money always wins stops being useful and candidates leave — which destroys the value of the paid placement. Say this plainly to the client if it comes up.

Jobs with `status != 'active'` or `expires_at < now()` never enter the feed.

---

## 3. Recruiter candidate ranking

Same base relevancy, inverted (job → candidate), plus:

```
+ activity_bonus     max 15, from candidate last_active_at
+ intent_bonus       max 10, from recent application volume
+ proximity_bonus    max 10, same city or within preferred cities
```

Runs as a `SECURITY DEFINER` function returning **masked** rows. Locked fields (phone, email, resume URL, employer names) are excluded at the SQL level, not filtered in React.

---

## 4. Broadening ladder

The deck says "Never show 'No Candidates Found'". Implemented as staged relaxation **with the stage disclosed**:

| Stage | Relaxation | Label shown |
|---|---|---|
| 0 | Exact filters | — |
| 1 | Skills: require ≥50% overlap instead of all | `Showing close matches` |
| 2 | Add adjacent job titles from the same category | `Showing related roles` |
| 3 | Expand location to nearby cities (≤50 km) then same state | `No matches in {city} — showing nearby candidates` |
| 4 | Widen the experience band by ±2 years | `Showing a wider experience range` |
| 5 | Category-level candidates, most recently active first | `Few exact matches — showing active candidates in {category}` |

Rules: advance a stage only when the previous returns fewer than 10 results. Never mix stages without a visual divider. Always show the current stage label. Record `broadening_stage` in `db_search_events` — a rising average is the clearest signal that a city or category has thin supply, which is a business input, not just a metric.

The stage label is the whole point. A recruiter who unlocks a padded result believing it was an exact match churns and asks for a refund; one who unlocks a labelled "nearby candidate" made an informed choice.

---

## 5. Candidate tags

Computed at query time, never stored stale:

| Tag | Rule |
|---|---|
| Recommended | Relevancy ≥ 75 |
| Hot Profile | ≥3 applications in last 7 days **and** profile ≥80% complete |
| Recently Active | `last_active_at` within 72 hours |
| Fast Responder | Median response to employer contact < 24h over ≥3 contacts |
| Nearby Candidate | Same city, or within 25 km of the job location |

A candidate may hold several tags; show at most three, in the order above. Never invent a tag when the underlying data is missing — an unearned "Fast Responder" is a lie the recruiter pays 5 credits to discover.

---

## 6. Honest freshness (replaces "recruiter psychology")

The Employer deck asks for recommendations that shuffle to create curiosity. We implement real change instead:

- **New candidate injection:** profiles created or substantially updated since the recruiter's last visit surface first, with a genuine `N new since your last visit` count derived from `db_search_events.created_at`
- **Recency decay:** dormant profiles drift down naturally, so the list moves without being shuffled
- **Real notifications:** "5 new candidates matched your job today" fires only when 5 new candidates actually matched

This produces the same felt experience — an active, evolving system — without spending recruiter credits on manufactured novelty. If the client pushes for artificial shuffling, the argument to make is commercial, not ethical: unlocks bought on false novelty become refund requests and churn.

---

## 7. Performance

Postgres handles all of this to well past launch scale. GIN indexes on `jobs.skills` and `candidate_profiles.skills` make array overlap fast; the scoring arithmetic is trivial.

Revisit only when candidate rows exceed ~500k or p95 search latency passes 800ms. At that point: materialised score table refreshed on write, then pgvector for semantic matching. **Elasticsearch/Algolia (Product Flows slide 4) is not needed for launch** and adds a second system to keep in sync — defer to P2.

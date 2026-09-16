# P0-11 — Recommended Profiles, Broadening Ladder & Tags

The recruiter-side discovery experience. Requires P0-06 and P0-07.

## Candidate sources
The responses screen combines two sources in one ranked list, visually distinguished:
1. **Applied candidates** — people who applied to this job
2. **AI Recommended profiles** — matching candidates from the database who have not applied

Recommended profiles follow the unlock rules from P0-07 exactly.

## Broadening ladder
The client requirement is "never show No Candidates Found". Implement it as staged relaxation **with the stage disclosed to the recruiter**:

| Stage | Relaxation | Label shown |
|---|---|---|
| 0 | Exact filters | — |
| 1 | Skills ≥50% overlap instead of all | `Showing close matches` |
| 2 | Adjacent job titles in the same category | `Showing related roles` |
| 3 | Nearby cities (≤50 km), then same state | `No matches in {city} — showing nearby candidates` |
| 4 | Experience band widened by ±2 years | `Showing a wider experience range` |
| 5 | Category-level, most recently active first | `Few exact matches — showing active candidates in {category}` |

Rules:
- Advance a stage only when the previous returns fewer than 10 results
- Never mix stages without a visual divider
- Always display the current stage label
- Record `broadening_stage` in `db_search_events`

**The label is the entire point.** A recruiter who unlocks a padded result believing it was an exact match churns and demands a refund. One who unlocks a candidate labelled "nearby" made an informed choice and does not.

## Candidate tags
Computed at query time from live data. Never stored, never stale.

| Tag | Rule |
|---|---|
| Recommended | Relevancy ≥ 75 |
| Hot Profile | ≥3 applications in the last 7 days **and** profile ≥80% complete |
| Recently Active | `last_active_at` within 72 hours |
| Fast Responder | Median response to employer contact < 24h across ≥3 contacts |
| Nearby Candidate | Same city, or within 25 km of the job |

Show at most three tags, in the order above. **Never show a tag when the underlying data does not exist** — an unearned "Fast Responder" is a claim the recruiter pays 5 credits to disprove.

Requires `candidate_profiles.last_active_at`, updated on login and any profile or application action.

## Honest freshness
The brief asks for recommendations that feel continuously active. Implement genuine change, not shuffling:

- **New candidate injection** — profiles created or substantially updated since this recruiter's last search surface first, with a real count derived from `db_search_events.created_at`: `12 new candidates since your last visit`
- **Recency decay** — dormant profiles drift down naturally, so the list genuinely moves between visits
- **Real notifications** — "5 new candidates matched your job today" fires only when 5 new candidates actually matched

Do **not** randomise ordering to create the appearance of change. Recruiters spend credits based on this list; manufactured novelty converts into refund requests and churn.

## UI
- Tabs: `Applied (N)` · `Recommended (N)`
- Each card: initials, city, experience, top skills, match score, up to 3 tags, Unlock button with its cost
- Sort control: Relevance (default) · Recently active · Experience
- Stage label pinned above the results whenever stage > 0
- New-since-last-visit count in the header when > 0

## Acceptance
- [ ] "No candidates found" never appears
- [ ] The broadening stage label is always visible when stage > 0
- [ ] Tags reflect real data; no tag appears without its underlying evidence
- [ ] Ordering does not change between two identical searches one minute apart
- [ ] The new-since-last-visit count matches the actual number of new profiles
- [ ] Applied and Recommended candidates follow identical unlock rules

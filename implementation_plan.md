# Strategic Roadmap: Upgrading Jobskart Search, Recommendation Engine, Edge Cases & Test Harness

This document presents a comprehensive study of **Jobskart’s existing architecture**, a benchmark comparison against industry leaders (**LinkedIn, Indeed, Naukri, Apna**), an edge-case inventory, and a step-by-step technical implementation plan to elevate Jobskart to an industry-leading standard.

---

## Executive Summary & Architectural Diagnosis

Jobskart currently uses a solid, modular Supabase + React/TanStack Start architecture. Recent updates added `feed_jobs_for_candidate()` to exclude applied jobs from candidate discovery feeds. 

However, when benchmarked against platforms like LinkedIn, Indeed, and Naukri, Jobskart has notable gaps in **search intelligence**, **feed personalization**, **multi-select filtering**, and **edge-case resiliency**.

---

## 1. Deep Dive: Jobskart Current Architecture vs. Industry Standards

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 SEARCH & RECOMMENDATION ENGINE                              │
├────────────────────────────┬─────────────────────────────────┬──────────────────────────────┤
│ Feature Dimension          │ Jobskart (Current)              │ Industry Benchmark           │
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Keyword Search             │ Basic ILIKE '%q%' on title only │ Full-Text Search (tsvector)  │
│                            │                                 │ + Vector Embeddings (BM25)   │
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Skill Matching             │ Case/whitespace string equality │ Skills Graph & Synonyms      │
│                            │ ("MS Office" != "Excel")        │ (Taxonomy mapping 40k+ skills│
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Candidate Personalization  │ Only excludes applied jobs;     │ Vector relevance scoring     │
│                            │ feed is NOT candidate-personalized│ by skills, bio & history    │
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Filtering Capabilities     │ Single-value filters per facet  │ Multi-select array facets    │
│                            │ (1 city, 1 category, 1 job type)│ + Faceted result counts      │
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Location Intelligence      │ String match on city name       │ Lat/Lng radius (5/10/25km)   │
│                            │ (Delhi != Gurgaon/Noida)        │ + Metro clusters (NCR/MMR)   │
├────────────────────────────┼─────────────────────────────────┼──────────────────────────────┤
│ Candidate Feedback         │ None                            │ Dismiss job, hide company,   │
│                            │                                 │ save search & job alerts     │
└────────────────────────────┴─────────────────────────────────┴──────────────────────────────┘
```

---

## 2. Identified Edge-Case & Test Suite Vulnerabilities

Based on an audit of Jobskart's current codebase and database functions, the following critical edge cases are currently uncovered or vulnerable:

1. **Metro Cluster / NCR Blind Spot**:
   - A candidate searching in "Delhi" does not see jobs in "Gurgaon" or "Noida", even though they are in the same commute cluster (Delhi-NCR).
2. **Skill Synonym Disconnect**:
   - A candidate with "React.js" skill gets 0 match score for a job requiring "ReactJS" or "Frontend Developer".
3. **Empty Filter State & Fallbacks**:
   - When a candidate selects tight filters (e.g. high salary + entry level + 1 specific city), the feed returns 0 results with no intelligent fallback or recommendation relaxation.
4. **Keyword Special Character Escaping**:
   - Search strings containing `%`, `_`, `'`, `&`, or punctuation in `_q` can alter SQL query semantics or throw errors.
5. **Large Application History Scale**:
   - When a candidate has applied to 500+ jobs, `NOT EXISTS (SELECT 1 FROM applications WHERE candidate_id = _uid)` performance degrades without a composite candidate-job index.
6. **Multi-Select Array Boundaries**:
   - Candidates looking for both "Full-time" AND "Contract" or "Remote" AND "Hybrid" cannot execute multi-select queries.

---

## 3. Step-by-Step Implementation Roadmap

---

### Phase 1: High-Performance Multi-Facet Search & Full-Text Search (FTS)

#### [MODIFY] [20260926071831_feed_jobs_for_candidate.sql](file:///c:/Users/abc/desktop/jobskart/supabase/migrations/20260926071831_feed_jobs_for_candidate.sql)
Upgrade `feed_jobs_for_candidate()` and `feed_jobs()` to support:
- **Array Facet Inputs**: `_cities text[]`, `_categories text[]`, `_job_types text[]`, `_work_modes text[]`.
- **PostgreSQL Full-Text Search**: Combine `title`, `description`, `skills`, and `company_name` into a `tsvector` with GIN indexing for fast relevance-ranked search.
- **Skill Synonym Normalization**: Map common skill aliases (e.g. `React` / `ReactJS` / `React.js`) using a normalization function.

---

### Phase 2: Candidate Feed Personalization Engine (V2)

#### [MODIFY] [20260926071831_feed_jobs_for_candidate.sql](file:///c:/Users/abc/desktop/jobskart/supabase/migrations/20260926071831_feed_jobs_for_candidate.sql)
Incorporate candidate profile relevance directly into `feed_jobs_for_candidate()` SQL scoring formula:
```sql
-- Dynamic Feed Ranking Formula:
score = (
    boost_score * 0.35 +
    freshness_score * 0.25 +
    quality_score * 0.15 +
    candidate_skill_match_score * 0.25
)
```
This ensures candidate feeds are not only apply-eligible, but **dynamically sorted by job match relevancy** for that specific candidate.

---

### Phase 3: Candidate Negative Feedback & Dismissal Boundary

#### [NEW] [20260927183000_candidate_job_dismissals.sql](file:///c:/Users/abc/desktop/jobskart/supabase/migrations/20260927183000_candidate_job_dismissals.sql)
- Create `public.candidate_job_dismissals (candidate_id, job_id, created_at)` and `public.candidate_company_blocks (candidate_id, company_id, created_at)`.
- Anti-join against dismissed jobs and blocked companies in `feed_jobs_for_candidate()`.
- Add "Not Interested" button to `JobCard` component with instant UI dismissal.

---

### Phase 4: Location Proximity & Metro Clustering

#### [NEW] [20260927183500_city_metro_clusters.sql](file:///c:/Users/abc/desktop/jobskart/supabase/migrations/20260927183500_city_metro_clusters.sql)
- Define metro clusters (e.g., NCR: Delhi, Gurgaon, Noida, Faridabad, Ghaziabad; MMR: Mumbai, Thane, Navi Mumbai).
- When a user searches a city within a metro cluster, return nearby jobs within the cluster automatically.

---

### Phase 5: Expanded Test Suite & Edge-Case Coverage

#### [MODIFY] [applied-jobs-feed.spec.ts](file:///c:/Users/abc/desktop/jobskart/tests/e2e/applied-jobs-feed.spec.ts)
Add automated checks for:
1. **Multi-Select Array Filters**: Test candidate searching multiple cities (`['Delhi', 'Jaipur']`) and job types (`['full_time', 'contract']`).
2. **Special Character Search Resilience**: Test inputs like `C# / .NET`, `Node.js & React`, `O'Reilly`.
3. **Empty State Relaxation Recommendations**: Test zero-match fallback behavior.
4. **High-Volume Candidate History (500+ Applications)**: Verify p95 RPC execution remains under 50ms.
5. **Dismissal & Block Actions**: Test that marking a job "Not Interested" immediately removes it from feed across sessions.

---

## 4. Verification & Testing Plan

### Automated Verification
1. Execute multi-facet RPC tests: `npx tsx scripts/run-rpc-suite.ts`
2. Execute Playwright E2E suite: `npx playwright test tests/e2e/applied-jobs-feed.spec.ts`
3. Benchmark RPC latency via `EXPLAIN (ANALYZE, BUFFERS)`.

### Success Criteria
- **Search Precision**: Full-text search returns relevant jobs for multi-word queries.
- **Personalization**: Candidates with matching skills see relevant jobs ranked higher in recommended feeds.
- **Latency**: P95 feed latency remains **< 50ms** even under 500+ applied jobs per candidate.

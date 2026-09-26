# Applied Jobs Discovery Feed — Detailed Implementation Plan

## 1. Executive decision

### Problem

Candidates can see jobs they have already applied to repeatedly in the Candidate Dashboard and `/jobs`. The Apply button is disabled, but the card can still occupy a top ranking position. This is especially harmful where a recently posted or boosted job outranks a new job that the candidate can actually apply for.

### Product rule

**Discovery surfaces must show only jobs that the current candidate can still apply to.** A submitted job belongs in the candidate's application tracker, not in discovery.

This rule applies to every application status: `applied`, `shortlisted`, `interview`, `hired`, `rejected`, and `withdrawn`. The database already permits only one application per `(job_id, candidate_id)`, therefore there is no valid second-application action to offer in the feed.

### Expected outcome

- Dashboard recommendations are fresh and actionable.
- Jobs search uses correct ranking and pagination based only on eligible jobs.
- Applied jobs remain available in `/candidate/applications` and through direct job links.
- The implementation removes unnecessary per-card application requests.

## 2. Scope, non-goals, and assumptions

### In scope

- Candidate Dashboard's Recommended section.
- `/jobs` for signed-in candidates, for recommended and explicit sorting/filtering.
- Database feed logic, performance indexes, and security boundary.
- Applied-state treatment for direct job detail and saved-job contexts.
- Tests, release gates, monitoring, and rollback.

### Out of scope

- Allowing a candidate to reapply to the same job.
- Deleting historical applications.
- Fuzzy matching a new job post against an employer repost (a new `job.id` remains eligible).
- Changing boost pricing or employer billing.
- Building Not Interested / Hide Company in this release; it is a follow-up opportunity.

### Assumptions to verify during implementation

1. `applications` retains the unique `(job_id, candidate_id)` constraint.
2. The current `feed_jobs()` RPC is the default recommended source.
3. A candidate session can be distinguished from a guest/employer session without relying on editable metadata.
4. The existing application tracker exposes enough information to be the authoritative view for applied jobs.

## 3. User experience specification

| User context | Required experience |
|---|---|
| Candidate opens Dashboard | Recommended jobs exclude all job IDs in their applications history. |
| Candidate uses `/jobs` with filters or any sort | Results and totals exclude applied job IDs before paging. |
| Candidate submits an application | The current job disappears from discovery immediately; totals/stats refresh. |
| Candidate opens a direct URL for an applied job | Show `Applied on <date>`, current status, and `View application`; never a disabled Apply button as the main action. |
| Candidate opens Applications | All historical applications remain visible, including rejected/withdrawn/hired. |
| Guest opens `/jobs` | Existing public results are unchanged. |
| Candidate has applied to every matching job | Explain this specific state and suggest broader filters, alert creation, or similar roles. |
| Job is newly reposted with a new ID | It may appear as a distinct job. |

### Copy rules

- Do not imply an application was unsuccessful merely because it is excluded from discovery.
- Prefer `View application` over disabled `Applied` where an application action exists.
- Empty state distinction matters:
  - **No match:** “No jobs match these filters.”
  - **All applied:** “You’ve already applied to all matching jobs.”
  - **Weak profile:** “Add skills and preferred location to improve matches.”

## 4. Strategy selection

| Strategy | Decision | Reason |
|---|---|---|
| Hide applied cards after React renders them | Reject | Produces sparse pages, wrong totals, wasted ranking slots, and unnecessary transfer. |
| Fetch all application IDs and send a large `NOT IN` list from browser | Reject | Breaks down with application history size and duplicates security/business logic in each client surface. |
| Keep applied cards but rank them last | Reject | Still creates noise and gives the candidate no useful action. |
| Change existing public feed to be conditionally personalised | Avoid | Makes a public contract identity-dependent and harder to test. |
| Add an authenticated candidate-specific feed RPC | **Choose** | Clear contract, secure identity, correct ranking/paging, reusable by Dashboard and Jobs page. |

## 5. Target architecture

```text
                           signed-in candidate
Dashboard ───────────────────────────────┐
                                          ├─> feed_jobs_for_candidate()
/jobs ───────────────────────────────────┘      ├─ active + unexpired jobs
                                                 ├─ all normal filters
                                                 ├─ exclude application job IDs
                                                 ├─ rank eligible jobs
                                                 └─ calculate total_count

guest/employer /jobs ──────────────────────────> existing public feed_jobs()

/candidate/applications ───────────────────────> applications (application tracker)
direct /jobs/:jobId ───────────────────────────> job detail + candidate's own application summary
```

**Invariant:** application exclusion happens before score ordering, `count(*) over()`, `LIMIT`, and `OFFSET`.

## 6. Data and database design

### 6.1 Feed RPC contract

Create `public.feed_jobs_for_candidate(...)` with the same filters and job-card return fields as `public.feed_jobs(...)`. Do not accept a candidate ID argument.

Recommended inputs mirror the public feed:

```text
_q, _city, _category, _job_type, _work_mode,
_min_salary, _max_salary, _min_exp, _max_exp,
_posted_after, _education, _shift, _english_level,
_company, _vehicle, _verified_only, _limit, _offset
```

Required predicate inside the job query:

```sql
AND NOT EXISTS (
  SELECT 1
  FROM public.applications AS a
  WHERE a.job_id = j.id
    AND a.candidate_id = (SELECT auth.uid())
)
```

The function must preserve all existing active status, expiry, verified-company, search, salary, and experience-range semantics. It must also preserve the deterministic ordering tie-breaker (`created_at DESC`) and current `total_count` behaviour.

### 6.2 Authentication and access model

- The function obtains the identity from `auth.uid()`; never trust a browser-supplied `candidate_id`.
- Fail explicitly when `auth.uid()` is null.
- Grant execute to `authenticated` only. Revoke from `PUBLIC` and `anon`.
- If `SECURITY DEFINER` is necessary to access the ranking inputs consistently, set `search_path = public` and return only public job/company fields; no application rows, statuses, notes, or candidate data may be returned.
- Do not use `auth.role()` as an authorization predicate. Use the function grant plus identity-based logic.
- Keep the existing RLS policies on `applications`; do not weaken them to make the feed work.

### 6.3 Index plan

The feed executes an anti-join by candidate and job. Add:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_applications_candidate_job
  ON public.applications (candidate_id, job_id);
```

Why it matters: the existing candidate-history index is useful for `ORDER BY created_at`, but this query tests equality on both candidate and job repeatedly. A narrow composite index makes that membership check cheap as application history grows.

Before committing the migration, determine whether the project's migration runner permits `CREATE INDEX CONCURRENTLY` (it cannot run in a transaction). If not, use the approved production deployment process; do not silently replace it with a blocking index on a large table.

### 6.4 Sorting contract

Applied-job exclusion is a discovery invariant, not merely a Recommended-sort feature.

- If each explicit sort currently uses separate client queries, add corresponding candidate-aware queries/RPC paths.
- Prefer one shared SQL feed with a validated sort option if that reduces duplicate filters and can preserve existing exact sort behaviour.
- Never allow boost ranking to override an explicit user sort, as in the current product.

## 7. Front-end implementation methodology

### Step 1 — create a shared feed adapter

Add a typed module such as `src/lib/job-feed.ts`:

- one function maps UI filters to RPC arguments;
- one mapper converts RPC rows into `JobCardData`;
- `fetchPublicJobFeed()` calls the existing public contract;
- `fetchCandidateJobFeed()` calls the new candidate contract;
- shared types include `rows`, `total`, `offset`, and error data;
- no component manually rebuilds the RPC argument object.

This is the guard against Dashboard and Jobs search behaving differently six months later.

### Step 2 — update `/jobs`

1. Resolve the session before requesting the first candidate feed page; avoid a public-results flash for a signed-in candidate.
2. Select public or candidate adapter based on session/role.
3. Reset rows, total, visible count, loading state, and offset whenever identity, sort, or filters change.
4. Preserve Load More semantics, but calculate its availability from the candidate-aware `total_count`.
5. Keep the existing expiry check as client defence-in-depth only.

### Step 3 — update Candidate Dashboard

1. Replace “load 60 then client-sort” with paged candidate feed calls.
2. Define one ranking model: include skills only when it can be evaluated before pagination. Do not client-sort a partial server page.
3. Keep card page size and pagination consistent with the Jobs page where possible.
4. On application success, invalidate/reload the candidate feed and application totals atomically from the UI's perspective.

### Step 4 — refactor `JobCard`

Discovery cards are now guaranteed to be apply-eligible, so they should not query `applications` themselves.

Choose one clear component boundary:

- `JobCard variant="discovery"` for eligible search results; or
- a separate `ApplicationJobCard` / direct-detail application summary for non-discovery contexts.

The component must not make a one-request-per-card application lookup. Apply state should be supplied intentionally only where it is needed.

### Step 5 — direct detail and saved jobs

For an applied job detail page, load the candidate's own application summary alongside the job (under existing RLS), then render:

- submitted date;
- current status;
- `View application` as primary action;
- `Find similar jobs` secondary action.

Saved Jobs should not be accidentally deleted by this work. If an applied job appears there, display an applied state rather than inviting another application; product can later decide whether applying automatically removes it from Saved.

## 8. Work breakdown and acceptance gates

| Work item | Deliverable | Acceptance gate |
|---|---|---|
| Discovery audit | Fixture candidate and baseline screenshots/network trace | Reproduction confirmed on Dashboard and `/jobs` |
| Database feed | Candidate RPC and supporting index | SQL returns no applied IDs and correct totals |
| Access review | Grants, auth identity test, advisor run | Anon fails; candidate A cannot use candidate B's history |
| Feed adapter | Typed shared module | No duplicated filter/RPC mapping in target screens |
| Jobs page | Candidate selection across every sort | Load More/pagination contain only eligible jobs |
| Dashboard | Server-side candidate ranking and refresh | Applied job disappears after successful submit |
| UI cleanup | Discovery card has no application lookup | Network trace has no N+1 `applications` requests |
| Detail/tracker | Applied status and navigation | Direct URLs are clear and actionable |
| Release | Flag, dashboard, alerting | Metrics meet rollout thresholds |

## 9. Test strategy

### Database tests

- Candidate with no applications gets eligible active jobs.
- Candidate with applications never receives those `job_id`s on first or later offsets.
- One fixture each for all application statuses proves all are excluded.
- Candidate A's history does not change Candidate B's output.
- A boosted/recent applied job is excluded before rank ordering.
- Expiry, status, all filters, limit/offset, and `total_count` retain current results for eligible rows.
- Anonymous execution of candidate RPC fails.
- The RPC cannot accept or infer another candidate ID from client input.

### UI tests

- Guest and employer choose public feed; candidate chooses candidate feed.
- Filter/sort/session changes reset buffered results correctly.
- Successful application removes the job immediately and refreshes counters.
- Discovery card causes no per-card application request.
- Applied direct detail uses `View application`; candidate Applications page remains unchanged.

### Manual regression matrix

Test desktop/mobile for:

1. guest;
2. candidate with no applications;
3. candidate with mixed application statuses;
4. candidate whose every filtered result is applied;
5. employer session;
6. direct URL to applied, expired, and active jobs;
7. boosted job applied by one candidate but not another.

### Performance and security checks

- Use `EXPLAIN (ANALYZE, BUFFERS)` on representative feed calls; validate a sensible indexed anti-join plan.
- Test candidates with small, medium, and large application histories.
- Check function grants and run Supabase database advisors.
- Confirm no service-role key or candidate data enters browser code.

## 10. Release, monitoring, and rollback

### Rollout sequence

1. Deploy index and candidate RPC without routing production UI traffic.
2. Validate with internal accounts and fixture queries.
3. Release front-end implementation behind `candidate_discovery_v2`, off by default.
4. Enable for internal testers, then a small candidate cohort.
5. Watch metrics for 24–48 hours; expand to all candidates if gates pass.
6. Remove old dashboard client-side ranking fetch and `JobCard` application lookups only after confirmation.

### Instrumentation

Use aggregate, non-sensitive events:

- `job_feed_loaded`: surface, feed type, filter count, returned total, latency;
- `job_feed_applied_excluded`: aggregate count only;
- `job_feed_empty`: `no_matches`, `all_applied`, or `profile_insufficient`;
- `job_card_opened`, `apply_started`, `application_submitted`.

### Success criteria

- Zero applied-job impressions in candidate discovery feeds.
- No material p95 latency/RPC error-rate regression.
- No material rise in search exit rate caused by new empty states.
- Unique actionable-job exposure per candidate session increases.
- Application-start and submit conversion remain stable or improve.

### Rollback plan

- Keep public `feed_jobs()` unchanged.
- Disable `candidate_discovery_v2` to restore the prior client selection immediately.
- Leave the new index in place; it is additive and safe.
- Do not delete application records or alter uniqueness constraints during rollback.
- Record affected errors/queries, fix forward, then re-enable for internal test accounts first.

## 11. Follow-up roadmap (separate feature work)

### Not Interested / Hide company

Offer candidate-controlled feedback. Store only candidate-owned preferences, enforce owner-only RLS and unique rows, and exclude/downrank them in the candidate feed. This is a high-value improvement after applied-job exclusion is stable.

### Feed diversity

Avoid five near-identical cards on the first screen by capping repeated company/title/category combinations. Treat this as an experiment: it changes ranking and needs its own metrics and transparent boost/sponsored treatment.

### Alerts

When no eligible jobs remain, let the candidate save the search. Alerts must never resend a job already applied to, dismissed, or hidden.

## 12. Implementation checklist

- [ ] Confirm current database schema and active `feed_jobs()` signature.
- [ ] Create fixture accounts/jobs/applications for test coverage.
- [ ] Add candidate-job composite index using safe deployment method.
- [ ] Implement and secure candidate feed RPC.
- [ ] Test SQL output, execution plan, permissions, and advisors.
- [ ] Add shared typed front-end feed adapter.
- [ ] Switch `/jobs` candidate flow for every discovery sort.
- [ ] Switch Dashboard to server-side candidate feed.
- [ ] Remove `JobCard` N+1 application check in discovery variant.
- [ ] Implement direct-detail applied-state CTA.
- [ ] Add automated tests and manual regression pass.
- [ ] Release with flag, observe metrics, complete staged rollout.

## 13. Evidence and code locations

- `supabase/migrations/20260617111751_66a186bd-1332-4c08-9ce7-ae5e0d3c4349.sql`: applications schema, unique application rule, and existing indexes.
- `supabase/migrations/20260924053542_job_boost_engine_ddl.sql`: current `feed_jobs()` ranking implementation.
- `src/routes/_authenticated/candidate/dashboard.tsx`: dashboard currently fetches and client-ranks jobs.
- `src/routes/jobs.tsx`: public/recommended feed integration.
- `src/components/site/JobCard.tsx`: per-card applied-state lookup.
- LinkedIn: [Job Tracker](https://www.linkedin.com/help/linkedin/answer/a512329) and [job recommendations](https://www.linkedin.com/help/linkedin/answer/a512279).
- Indeed: [Managing applied jobs](https://www.indeed.com/help/job-seekers/articles/4412589551757-my-jobs-managing-applied-jobs).

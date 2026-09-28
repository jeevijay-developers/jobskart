# QA Issues & Implementation Plan

Based on the review of `Q_A_Answers.md` and `Client_QA_Responses.md`, this document outlines all the verified bugs, missing features, and technical debt in the current codebase, followed by a detailed implementation plan to resolve them.

---

## 🐛 Identified Bugs & Missing Features

### 1. UI & User Experience Bugs
*   **Missing "Withdrawn" Status**: The `APPLICANT_STATUSES` array in `src/lib/applicantStatus.ts` is missing the `withdrawn` status, causing it not to appear in employer dashboard views (Q9).
*   **Silent Query Errors**: In the jobs feed (`src/routes/jobs.tsx`), database or API failures silently discard the error and show the "No jobs match your filters" empty state. There is no distinct error state shown to the user (Q10).
*   **Saved Jobs Card UI**: The saved jobs page (`src/routes/_authenticated/candidate/saved.tsx`) doesn't use the enhanced "Applied on [date]" UI treatment for jobs a candidate has already applied to, falling back to a generic disabled button (Q4).

### 2. Backend & System Integrity Gaps
*   **MCP AI Tool Gap**: The MCP `search-jobs` and `my-saved-jobs` tools do not filter out jobs the candidate has already applied to, nor do they annotate the applied status, bypassing the new discovery feed rules entirely (Q4).
*   **Plan Downgrade Enforcement**: When an employer is downgraded to the Basic plan (5-job limit), they are prevented from posting *new* jobs, but if they already exceed the limit, their existing active jobs are not automatically trimmed or paused (Q19).
*   **Razorpay Reconciliation**: There is no scheduled job to reconcile edge-case payments where a Razorpay charge succeeds but both the client callback and webhook fail to reach the server (Q18).
*   **Unoptimized Job Cards (N+1 Query)**: While the `applications` lookup was removed from discovery cards, every card still performs a per-card `saved_jobs` database lookup and an auth `getSession()` call, leading to N+1 performance issues (Q13).

### 3. Codebase & Process Debt
*   **Dead Code for Matching**: The matching algorithm in `src/lib/matching.ts` (skills, location, salary matching) is completely dead code and isn't wired up to the actual job ranking (Q7).
*   **No Automated Testing**: There is no working test suite (`bun:test` isn't configured, existing `.test.ts` files have type errors), no CI/CD pipeline, and no performance tracking (Q11, Q12, Q14).
*   **Stale Documentation**: `CLAUDE.md` incorrectly documents the job ranking algorithm (it claims it uses skills/location, but it actually only uses boost, recency, and quality) (Q5/Q7).

---

## 🛠️ Implementation Plan

The plan is divided into three actionable phases: Quick Wins (UI/UX), Core Backend Features, and Infrastructure & Tech Debt.

### Phase 1: Quick Wins (UI & Frontend Logic)

**1. Fix the "Withdrawn" Status Label**
*   **File**: `src/lib/applicantStatus.ts`
*   **Action**: Add `'withdrawn'` to the `APPLICANT_STATUSES` array. Ensure any corresponding color/badge mapping in the UI components has specific styling (e.g., a gray or neutral badge) for the withdrawn state so it renders correctly for employers.

**2. Add Distinct Error States for Job Search**
*   **File**: `src/routes/jobs.tsx`
*   **Action**: Instead of doing `if (error) { setLoading(false); return; }`, capture the error in a new `feedError` React state. Update the render logic so if `feedError` is present, it displays a "Something went wrong, please try again" component with a retry button, rather than falling through to the `jobs.length === 0` empty state.

**3. Upgrade the Saved Jobs UI**
*   **File**: `src/routes/_authenticated/candidate/saved.tsx`
*   **Action**: Pass the application status data into the `<JobCard>` components rendered on this page. If the candidate has applied, ensure the card renders the richer "Applied on X" UI instead of the generic `"full"` variant.

---

### Phase 2: Core Backend Features

**4. Enforce "Eligible Jobs" in MCP AI Tools**
*   **Files**: `src/lib/mcp/tools/search-jobs.ts` and `my-saved-jobs.ts`
*   **Action**: Retrieve the authenticated candidate's `auth.uid()`. Modify the Supabase query to include an anti-join or `.not('id', 'in', (applied_job_ids))` filter, mirroring the logic used in the `feed_jobs_for_candidate` RPC so the AI agent also respects the application history.

**5. Implement Plan Downgrade Trimming (Over-limit Jobs)**
*   **File**: Database migration (RPC `switch_company_plan_to_basic()`)
*   **Action**: After updating the `company_plans` table to basic, add a query to count the company's active jobs. If `count > 5`, select all active jobs ordered by `created_at DESC` with an `OFFSET 5`. Update the status of these older overflowing jobs from `'active'` to `'draft'` or `'paused'`, bringing the live count strictly into compliance with the Basic plan.

**6. Build Daily Razorpay Reconciliation**
*   **File**: New Edge Function or Supabase `pg_cron` script
*   **Action**: Run a daily script that queries `razorpay_orders` where `status = 'created'` and `created_at` is older than 2 hours. For each order, ping the Razorpay API to check the real status. If Razorpay reports it as `captured`, trigger the existing `fulfill_razorpay_order()` function to grant the credits safely.

---

### Phase 3: Infrastructure & Technical Debt

**7. Eliminate N+1 Queries on Job Cards**
*   **Files**: Database migration (`feed_jobs_for_candidate` RPC) and `src/components/site/JobCard.tsx`
*   **Action**: Update the SQL RPC to `LEFT JOIN` the `saved_jobs` table for the current user. Return a boolean `is_saved` column directly in the feed results. Pass this boolean into the `<JobCard>` component to completely eliminate the `useSavedJob` hook's per-card network request.

**8. Wire up the Dead Matching Algorithm**
*   **File**: `src/lib/matching.ts` and database migrations
*   **Action**: Connect `src/lib/matching.ts` with the job feed. Compute a candidate "match %" using the existing skills and location data, and inject this score into the `feed_jobs_for_candidate` ranking multiplier to make the feed genuinely personalized.

**9. Stand up Automated Testing & Update Docs**
*   **Files**: `package.json`, `CLAUDE.md`, and test files.
*   **Action**: 
    *   Add `bun-types` to `devDependencies` and fix the type errors in existing `*.test.ts` files.
    *   Add a `"test": "bun test"` script to `package.json`.
    *   Update `CLAUDE.md` to accurately reflect the live ranking formula (Boost + Recency + Quality) instead of the stale skill-based documentation.

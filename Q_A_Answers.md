# JobsKart — Answers to Q_A.md

Verified directly against the codebase and the live Supabase project (`Jobskart`,
ref `swdntxurukbkyksuyzhg`) as of **2026-09-26**, not from memory or from the
planning docs alone. Every claim below cites the actual file/line it's based
on. Where something in `Q_A.md` assumes a claim was delivered and it wasn't,
that's marked **❌ Not implemented** with the reason, not glossed over.

Legend: ✅ Implemented and verified · ⚠️ Partially implemented / real gap · ❌ Not implemented · 🚫 Not measurable from this codebase

---

## 1. What exactly does "eligible to apply" mean in your system, and what eligibility rules are actually being enforced?

**✅ Implemented, but narrower than the phrase might suggest.**

"Eligible to apply" = a job the candidate has **not already submitted an
application for**, that is still `status = 'active'` and not expired. It is
*not* an age/gender/experience/skills gate that blocks a candidate from
applying — JobsKart doesn't stop a candidate from applying to a job they're
"unqualified" for; the only thing that removes a job from *discovery* is a
pre-existing row in `applications` for that `(candidate_id, job_id)` pair.

Enforced in `public.feed_jobs_for_candidate()`
(`supabase/migrations/20260926071831_feed_jobs_for_candidate.sql`), which is
the RPC behind the candidate Dashboard and the candidate's `/jobs` search.

## 2. Can you show me the exact eligibility logic/code flow?

**✅ Yes** — `feed_jobs_for_candidate()`:

1. Identity: `_uid uuid := auth.uid()` (never a client-supplied candidate id); `IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'`.
2. Applies the same filters as the public feed (city, category, job_type, work_mode, salary/experience range, search text, etc.) plus `status = 'active'` and not expired.
3. Excludes already-applied jobs *inside* the scored CTE, before ranking:
   ```sql
   AND NOT EXISTS (
     SELECT 1 FROM public.applications a
     WHERE a.job_id = j.id AND a.candidate_id = _uid
   )
   ```
4. Scores the remaining rows (boost + freshness + quality — see Q7), computes `count(*) OVER()`, then applies `ORDER BY` / `LIMIT` / `OFFSET`.

Exclusion happening *before* pagination is the detail that matters — it's why
totals and "Load More" stay correct instead of pages going sparse. This
matches the invariant the planning doc (`applied-jobs-discovery-feed-implementation.md`) called for, and it was actually built that way.

Front end: `src/lib/job-feed.ts` exports `fetchCandidateJobFeed()` (calls this
RPC) alongside `fetchPublicJobFeed()` (calls the old public `feed_jobs()`),
and `src/routes/jobs.tsx` picks between them based on session
(`isCandidateFeed = !!session && !isEmployer`). The candidate Dashboard
(`src/routes/_authenticated/candidate/dashboard.tsx`) uses the candidate
fetcher too, with no leftover client-side ranking.

## 3. What prevents the system from incorrectly hiding a job that a candidate is actually eligible for?

**✅ Low risk, by construction.** The `NOT EXISTS` predicate keys strictly on
`(a.job_id = j.id AND a.candidate_id = _uid)` — an exact row match, no fuzzy
matching by title/company. A reposted job with a new `job.id` is a different
row and is **not** excluded (confirmed unchanged, matches the plan's explicit
"out of scope" note). `_uid` only ever comes from `auth.uid()`, so nothing a
candidate's browser sends can make the exclusion set larger or smaller than
their own real application history.

The actual risk in this feature is the opposite direction — **jobs staying
visible that should be hidden** (see Q4), not eligible jobs being wrongly
hidden.

## 4. If a candidate has already applied for a job, can that job still appear anywhere — search, recommendations, category pages, saved jobs, APIs, direct links?

**⚠️ Mixed — properly fixed in the two surfaces the plan targeted, not fixed in two others.**

| Surface | Status | Evidence |
|---|---|---|
| Dashboard "Recommended for you" | ✅ Excluded | `dashboard.tsx` uses `fetchCandidateJobFeed` |
| `/jobs` search — every sort, for a signed-in candidate | ✅ Excluded | `jobs.tsx` routes all candidate sorts through `fetchCandidateJobFeed`, not just the default |
| `/jobs` search — guest/employer | N/A by design | no application history to exclude |
| Category pages | ✅ Excluded | same `/jobs` route/RPC handles category as a filter, not a separate page |
| Direct job link (`/jobs/:jobId`) | ✅ Intentionally still shown | renders `Applied {date} · {status}` + **View application** as the primary action instead of a disabled Apply button (`src/routes/jobs.$jobId.tsx`) |
| Saved Jobs | ⚠️ Still shown, no enhanced state | `src/routes/_authenticated/candidate/saved.tsx` renders `<JobCard>` with the default `"full"` variant — same generic disabled-"Applied" card as before, not the richer "Applied on X" treatment. This is arguably in-scope per the plan's own design (Saved Jobs isn't a discovery surface) but it's *not* the improved UX either — just unchanged. |
| **MCP tools** (`search-jobs`, `my-saved-jobs`) | ❌ **Not implemented — real gap** | `src/lib/mcp/tools/search-jobs.ts` queries `jobs` directly with no `applications` exclusion and no auth-based candidate filtering at all. `my-saved-jobs.ts` doesn't annotate applied status either. A candidate can rediscover an already-applied job through the MCP `search-jobs` tool today. |

## 5. What exactly changed in the job recommendation algorithm compared with the previous version?

**⚠️ Less than "algorithm change" implies.** The *scoring formula itself* —
boost decay + freshness + quality — is **byte-identical** between the old
public `feed_jobs()` and the new `feed_jobs_for_candidate()`. What actually
changed:

1. The already-applied anti-join (Q2).
2. An explicit `_sort` parameter so the candidate RPC also serves non-default sort orders, which the public RPC didn't need.

No ranking *weights* changed. Also worth flagging directly: **CLAUDE.md's own
description of the ranking formula is stale.** It says weights are "skills
overlap 60, location 20, experience fit 15, salary overlap 5, plus
tier/boost/freshness bonuses." The actual shipped SQL
(`supabase/migrations/20260924053542_job_boost_engine_ddl.sql:280-290`) is:

```
score = boost_weight * (remaining_boost_time / total_boost_window)
      + freshness_weight * max(0, 1 - days_since_created/7)
      + quality_weight * (quality_score/100)
```
with defaults `boost_weight=40, freshness_weight=20, quality_weight=10`
(admin-editable in `boost_settings`). **No skills, location, experience, or
salary signal exists in the live ranking query at all** — see Q7.

## 6. You said recommendations are now "fresher" and "more actionable" — what are the measurable before-vs-after numbers proving that?

**🚫 None exist.** There is no analytics/telemetry SDK anywhere in
`package.json` (no PostHog, Segment, Mixpanel, Amplitude, GA, Sentry), and the
specific events the plan doc proposed to track this
(`job_feed_loaded`, `job_feed_applied_excluded`, `job_feed_empty`,
`job_card_opened`, `apply_started`, `application_submitted`) have **zero
occurrences anywhere in `src/`** — they exist only as names in the planning
markdown, never implemented. "Fresher"/"more actionable" is a qualitative
description of the anti-join behavior (Q2), not a measured claim — there is
nothing in this repo that could produce a before/after number.

## 7. What ranking signals are being used for recommendations — skills, experience, location, salary, recency, employer quality, application history, or something else?

**✅ Directly answerable, and it contradicts the framing of the question.**
The live `feed_jobs()`/`feed_jobs_for_candidate()` ranking uses exactly three
signals: **active boost** (paid, decays linearly over its window), **recency**
(linear decay over 7 days since posting), and **job quality score**
(0–100, a JD-completeness metric — not "employer quality"). That's it.

- **Skills / location / experience / salary**: not used for ranking at all.
  `src/lib/matching.ts` *does* implement skills(60%)/location(20%)/
  experience(15%)/salary(5%) scoring, but a repo-wide search found **zero
  call sites** — it isn't imported or invoked anywhere, including the
  candidate's own "match %" badge that CLAUDE.md's architecture rules assume
  exists. It is currently dead code.
- **Application history**: used only as a binary exclude filter (Q2), never as a ranking weight.
- **Employer quality**: no such signal exists in the schema or query.

## 8. What happens if the application status in the database is incorrect, delayed, missing, or inconsistent with what the candidate sees?

**⚠️ Partially resilient, one behavior worth knowing.** The status column is a
real Postgres enum (Q9), so an *invalid* value is impossible — the database
itself rejects anything outside the 6 defined statuses. There's no separate
audit/history table or reconciliation job found that would catch a status
that's technically valid but stale/wrong (e.g. an employer's action failing
to update it) — I did not find evidence of such a mechanism either way, so I
can't confirm resilience beyond "the value can't be garbage."

One concrete, deliberate behavior worth flagging: the discovery-feed
exclusion (Q2) doesn't care what the status **value** is — *any* row in
`applications` for that candidate+job hides it, including `withdrawn` and
`rejected`. So a candidate who withdraws an application can never see that
job again in search/recommendations (only via a direct link they still have,
and even then they can't re-apply — `(job_id, candidate_id)` is unique). This
is explicitly the rule the plan document asked for, not a bug, but it's a
real UX consequence worth being aware of.

## 9. What are all possible application statuses, and is there one single source of truth for those statuses across the entire platform?

**⚠️ One true source in the database; one frontend list has drifted from it.**

DB: `CREATE TYPE public.application_status AS ENUM ('applied','shortlisted','interview','hired','rejected','withdrawn')`
(`supabase/migrations/20260617111751_...sql`), never altered since — a genuine
single enum, not a plain-text/CHECK column that could silently accept a typo.

Frontend gap: `src/lib/applicantStatus.ts`'s `APPLICANT_STATUSES` array
(used for the employer-facing status badges/labels) lists only **5 of the 6**
values — it's missing `withdrawn`. Other frontend files (`jobs.$jobId.tsx`,
`candidate/applications.tsx`, `employer-analytics.functions.ts`) do reference
`withdrawn` directly as a string literal, so the app as a whole knows about
all 6 states, but this one shared "list of statuses" module doesn't — a
concrete drift point, not a hypothetical one.

## 10. How does the system differentiate between "there are no matching jobs" and "the API/database/search system failed" so that an error isn't shown as an empty result?

**❌ It doesn't.** Confirmed directly in `src/routes/jobs.tsx`: both
`fetchPublicJobFeed`/`fetchCandidateJobFeed` (`src/lib/job-feed.ts`) return
`{ rows: [], total: 0, error: error.message }` on an RPC failure — the error
message is captured, but the calling code in `jobs.tsx`'s fetch effect
discards it (`if (error) { setLoading(false); return; }` — no error state is
ever set). `jobs` stays at its initial empty array, and the render path
(`loading ? spinner : jobs.length === 0 ? <empty state> : ...`) shows the
exact same "No jobs match your filters" (or "You've already applied to all
matching jobs") copy for a genuine zero-row result and for an outright query
failure. `loadMore` has the identical pattern. There is no distinct
"something went wrong, try again" state anywhere in this flow.

## 11. You said search, filters, sorting, and pagination are now consistent — what exact test cases were run to verify this?

**❌ None — there is no way to answer this with a test list, because no
automated tests were run.** `package.json` has no `test` script at all,
`bun:test` (the only test runner referenced in the repo) is never invoked by
any script, there is no `.github/workflows/` CI pipeline, and the 10 existing
`*.test.ts` files in `src/` (e.g. `jd-template.test.ts`, `jobQuality.test.ts`)
aren't wired to anything — they don't even type-check under this project's
`tsconfig.json` because `bun-types` isn't a declared dependency. "Now
consistent" is a design claim backed by the shared `job-feed.ts` adapter
(Q2), not a tested claim.

## 12. Have you tested multiple filters combined with sorting and pagination, and what happens at edge cases — zero results, very large result sets, rapidly changing jobs?

**❌ No evidence of any of this being tested.** Same root cause as Q11 — no
test runner, no CI, and no test fixtures exist under `supabase/` either. The
zero-results and "all applied" empty states exist as UI copy (Q10's context)
but nothing demonstrates they were exercised against combined filter/sort/
pagination states, large datasets, or a job set that changes mid-session.

## 13. You said job cards now perform fewer background checks — which checks were removed, why were they unnecessary, and what risks did removing them create?

**⚠️ True, but overstated — only one of at least two per-card queries was
removed.** `src/components/site/JobCard.tsx` gained a `variant: "discovery" | "full"` prop. In `"discovery"` mode (used by Dashboard and the candidate
`/jobs` results), it skips the per-card `.from("applications")` lookup — safe
to skip because the server-side RPC (Q2) already guarantees no applied job
reaches that list, so the check was genuinely redundant there. No risk was
created by removing it.

**What wasn't removed:** every card, in *every* variant including
`"discovery"`, still makes an unconditional per-card `saved_jobs` lookup via
the `useSavedJob` hook (`src/hooks/use-saved-job.ts`), plus a per-card
`supabase.auth.getSession()` call. So the N+1-per-card-request pattern the
plan's checklist explicitly called out ("Discovery card has no application
lookup") is only half-fixed — the applications query is gone, the saved-job
query is not, and it's the same shape of problem.

## 14. What are the actual before-vs-after API calls, database queries, response times, and page-load times for the job browsing experience?

**🚫 Not measurable from this codebase.** No `EXPLAIN ANALYZE` usage, no
perf/benchmark scripts, no APM tool (Sentry/Datadog/New Relic) in
`package.json`, and no comments anywhere recording measured timings. Nothing
in this repo could produce these numbers; they'd have to come from manual
profiling that left no artifact here.

## 15. Are employer subscription limits (live jobs, posting quotas, boosts, candidate unlocks, response-history access) enforced on the backend, or only through the UI?

**✅ Backend-enforced, for everything checked:**

- **Live jobs / posting quotas / tier pricing** — `activate_job_with_tier()`, the *only* RPC that can flip a job from `draft` to `active`; it independently re-reads the company's plan limits via `get_company_entitlements()` and re-counts live jobs itself.
- **Boosts** — `apply_boost()`, `SECURITY DEFINER`, checks same-day/credit rules server-side before deducting.
- **Candidate unlocks** — `unlock_candidate()`, `REVOKE`d from `anon`/`authenticated` entirely and `GRANT`ed only to `service_role` (`supabase/migrations/20260924103235_db_access_model.sql`) — a browser literally cannot call this RPC directly; it must go through the TanStack server function, which authenticates the user first.
- **Candidate DB search rate limits** (`db_searches_per_hour`, `db_rows_per_day`) — enforced inside `search_candidates_for_company`. Note: these two specific caps are currently **global** settings (`plan_settings`), not per-plan-tier values, unlike the others.
- **Response retention** — enforced by a scheduled DB-side purge (`log_employer_activity(...'responses.purged'...)`), not a UI-level filter.

## 16. What prevents an employer from bypassing subscription limits directly through an API call or manipulated frontend request?

**✅ Genuinely enforced, not just documented.** Three layers, all server-side:

1. **RLS**: the `jobs` table's INSERT policy only permits `status = 'draft'` — there is no way to `INSERT`/`UPDATE` a job to `active` directly via PostgREST/the Supabase JS client, manipulated request or not.
2. **Every entitlement-changing RPC re-derives the truth itself**: `activate_job_with_tier`, `apply_boost`, `unlock_candidate`, `create_plan_order`, etc. look up the company's plan/limits/balance from Postgres tables using the authenticated `auth.uid()` → membership check, never trusting a client-sent `company_id`, tier, or price.
3. **Privilege grants**: money-moving functions (`unlock_candidate`, `fulfill_razorpay_order`, `create_plan_order`, `activate_company_plan`) are `REVOKE`d from `anon`/`authenticated` and only callable by `service_role` — meaning even a valid, logged-in user's browser can't invoke them directly; only the server (via `supabaseAdmin`, after its own auth middleware runs) can.

This matches `CLAUDE.md`'s stated architecture rule 2 and, on inspection, is actually implemented that way — not just aspirational documentation.

## 17. Walk me through the complete Razorpay flow: payment initiated → payment success → webhook → verification → subscription activation. What happens if any one of those steps fails?

**✅** (Traced directly in `src/lib/credits.functions.ts`, `src/lib/plans.functions.ts`, `src/lib/razorpay.server.ts`, `supabase/migrations/20260923064309_razorpay_hardening_gst.sql`, `supabase/migrations/20260926065745_plan_subscription_purchase.sql`, `src/routes/api/public/webhooks/razorpay.ts`.)

1. **Quote** — `create_credit_pack_order`/`create_plan_order` (SECURITY DEFINER) re-validates membership, prices from the DB (never client input), inserts a `razorpay_orders` row (`status='created'`) with a frozen GST-inclusive quote.
   *Failure:* stable error code → friendly message, nothing created, nothing charged.
2. **Razorpay order created** — server calls Razorpay's `/v1/orders` REST API with `RAZORPAY_KEY_ID/SECRET` (server-only secrets).
   *Failure:* the local order row is marked `status='failed'`, reason recorded, user sees a toast, checkout modal never opens.
3. **Link attached** — `razorpay_order_id` written onto the local row.
   *Failure:* also marked `failed`.
4. **Checkout** — client opens Razorpay's modal with that `order_id`; user pays.
5. **Client verify** — on success, the client calls `verifyRazorpayPayment`/`verifyPlanPayment`, which:
   - Recomputes the HMAC-SHA256 signature (constant-time compare via `timingSafeEqual`) — rejects a forged/tampered success callback.
   - Calls `fulfill_razorpay_order()`, which `FOR UPDATE`-locks the order row, so it's safe to run concurrently with the webhook without double-crediting.
   - If already `'paid'`, returns `already_applied: true` immediately — idempotent even if called twice.
   - Grants the credit-pack delta (`apply_credit_delta`) or activates the plan (`activate_company_plan`), then issues a GST invoice — **an invoice failure is caught and logged as a warning but never blocks the actual grant** (deliberate — a derived record must never block the core paid flow).
   *Failure (network drop before this call completes):* Razorpay may have captured the payment, but the user sees an error toast and no local grant happened yet — step 7 is the safety net.
6. **`payment.failed` handling** — both the client SDK's `on('payment.failed')` handler and the webhook call `mark_razorpay_order_failed()`. Razorpay still allows retrying checkout on the *same* order id, and a later successful retry fulfils normally.
7. **Webhook** — independently, Razorpay's server-to-server webhook (`payment.captured`/`order.paid`) HMAC-verifies the payload against `RAZORPAY_WEBHOOK_SECRET`, then calls the exact same `fulfilRazorpayOrder()` helper. This is what grants the purchase even if the browser crashed/lost network right after paying.
   *Failure modes:* bad signature → `401`, ignored; order not recognized (e.g. a stray event) → `200` "order not found" so Razorpay stops retrying; any other error → `500`, so Razorpay retries automatically — safe because fulfilment is idempotent. If `RAZORPAY_WEBHOOK_SECRET` isn't configured in an environment at all, the route returns `503` and **the client-verify path becomes the only safety net** — worth knowing operationally.
8. **Amount mismatch** — if Razorpay reports a paid amount different from the frozen quote (checked in the webhook path, which carries the real captured amount), the order is flipped to `status='amount_mismatch'` and nothing is granted — preserved as an investigable state, not silently accepted or silently dropped.

## 18. What happens if Razorpay shows a successful payment but our database doesn't activate the subscription, or our database activates it but Razorpay payment confirmation fails?

**Case A — Razorpay charged, but nothing local ever fulfils:**
possible only if *both* independent paths fail — the client verify call never
completes **and** the webhook never arrives (e.g. `RAZORPAY_WEBHOOK_SECRET`
missing, or Razorpay's webhook delivery is down). In that state the
`razorpay_orders` row is stuck at `'created'` (or `'failed'`) despite a real
charge on Razorpay's side. **⚠️ Gap:** I found no reconciliation job anywhere
in this repo that periodically cross-checks Razorpay's payment records
against local `razorpay_orders` rows to catch and repair this drift — the
system relies entirely on at least one of the two paths succeeding, with no
scheduled backfill sweep as a third layer.

**Case B — DB activates without real Razorpay confirmation:** structurally
not possible with the current code. `fulfill_razorpay_order()` is the *only*
function that grants anything, and every path into it requires either a
signature-verified client callback (something only Razorpay's SDK could have
produced) or an HMAC-verified webhook payload from Razorpay itself. There is
no code path that grants a credit or plan without one of those two
Razorpay-originated confirmations — the closest thing to "DB says paid,
Razorpay disagrees" is the `amount_mismatch` state, which explicitly blocks
the grant rather than allowing it through.

## 19. How exactly does the Basic-plan downgrade work when an employer already has more live jobs than the Basic plan permits, and what prevents them from keeping those jobs indefinitely?

**⚠️ Real, deliberate gap — worth knowing precisely.** `switch_company_plan_to_basic()`
(`supabase/migrations/20260926065745_plan_subscription_purchase.sql`) only
flips the company's active `company_plans` row to `status='cancelled'`. It
does **not** touch the `jobs` table at all — every job that was already
`status='active'` stays active, even if the count now exceeds Basic's 5-job
cap.

What's actually constrained is the *next* publish: `activate_job_with_tier()`
re-counts live jobs against the (now-Basic) limit on every new activation
attempt and blocks with `live_jobs_max_reached` if the company is at/over
cap — the same error this whole thread started from.

**Nothing prevents an over-cap company from keeping those jobs indefinitely**
on Basic — the cap only blocks *new* activity, it never auto-closes existing
jobs to force compliance. Jobs do eventually disappear via the separate,
unrelated job-expiry system (`expires_at`), but that's not triggered or
accelerated by a plan downgrade — it's just normal expiry running on its own
timeline. This was a conscious scope decision made explicitly this session
(confirmed directly, since this RPC was built in this same working session),
not an oversight discovered after the fact — but it should be understood as
"can't post more" rather than "hard 5-job ceiling."

## 20. For every item in this report, show me the ticket/task, deployment date, QA test result, production status, known bugs, and rollback plan.

**⚠️ Partial, and this is the most important gap to be direct about.**

- **Ticket/task**: none exist. This repo has no issue tracker integration; `git log --oneline -30` shows only free-text commit messages ("Applied jobs", "Razorpay integration", etc.) with no ticket-ID convention anywhere. The closest thing to a spec is `prompt structure/P0-06-ranking-and-feed.md`-style docs, which use plain unchecked Markdown checkboxes (`- [ ] ...`) under an "Acceptance" heading — not linked to any test or CI run.
- **Deployment date**: the discovery-feed changes (migration + front-end) landed in commit `6569c76 "Applied jobs"` (2026-09-26, 15:46:33 +0530) on `main`. I cannot independently confirm every running environment is actually serving that commit — this session separately caught a case earlier today where a long-running local dev server kept serving pre-fix code until restarted, so "committed" and "actually running in front of a user" are not automatically the same thing here.
- **QA test result**: none — see Q11/Q12. No automated tests ran; no manual QA artifact exists in the repo.
- **Production status**: the new `feed_jobs_for_candidate` RPC and its supporting code are committed to `main`; I did not independently re-verify a live production URL is serving the new front-end bundle (see the deployment-date caveat above).
- **Known bugs** (concrete, from this audit):
  1. MCP `search-jobs`/`my-saved-jobs` don't exclude applied jobs (Q4).
  2. Saved Jobs shows no enhanced applied-state (Q4).
  3. `JobCard`'s per-card `saved_jobs` lookup wasn't removed despite the "fewer background checks" framing (Q13).
  4. No-results vs. query-error are visually identical to the user (Q10).
  5. `applicantStatus.ts`'s status list is missing `withdrawn` (Q9).
  6. CLAUDE.md's documented ranking formula doesn't match the shipped SQL (Q5/Q7).
  7. No payment-reconciliation job for the rare "Razorpay charged, neither client nor webhook fulfilled" case (Q18).
  8. Basic-plan downgrade doesn't cap or close over-limit existing live jobs (Q19).
- **Rollback plan**: the planning doc proposed a `candidate_discovery_v2` feature flag specifically so this could be disabled instantly. **It was never built** — this codebase has no feature-flagging mechanism of any kind (confirmed by repo-wide search). If this needs to be rolled back today, there is no flag to flip; it would require a manual revert commit and redeploy.

# JobsKart Job Discovery, Hiring Pipeline, and Engagement — Implementation Plan

**Status:** Read-only audit and implementation plan. No application source, database schema, Supabase configuration, or production data was changed.

**Scope:** The nineteen items shown in the supplied Job Discovery & Search, Job Application & Hiring Pipeline, and Notification & Engagement flow diagrams.

**Repository caveat:** “Implemented” means code/migrations exist in this repository. Confirm migration history, bucket/provider secrets, Edge Function deployment, cron schedules, and live RLS behavior before declaring any feature available in production.

## Summary of findings

JobsKart already supports public job discovery, filterable job listings, category/city filters, candidate-specific exclusion of previously applied jobs, fast application, application status tracking, employer applicant workflow, interview scheduling, in-app notifications, candidate job alerts, and email notifications for several events.

The main gaps are:

1. Search is currently PostgreSQL/RPC based; Elasticsearch and Algolia are not integrated.
2. “Nearby” is city-based, not geospatial/radius-based.
3. Public SEO pages exist only in a limited route sense; a complete sitemap, indexation policy, structured data strategy, and scalable category/city landing pages were not found.
4. Push notifications and real WhatsApp delivery are not implemented as a complete, consented delivery system.
5. Retention and referral/reward systems are not implemented as product capabilities.
6. Candidate analytics are limited to basic dashboard/application counts rather than a full funnel and outcome analytics product.

---

# Flow 1 — Job Discovery & Search

## 1. Home Feed

### Description

The home feed is the candidate’s primary job-discovery surface. It should present eligible, timely jobs with a clear distinction between personalised recommendations, generic popularity, promoted jobs, and explicit user-selected sorts.

### Current state

**Partially implemented.** Candidate dashboard and `/jobs` use feed RPCs. The candidate-scoped feed excludes jobs the current candidate has already applied to before pagination. However, its default ranking is based on job boost, freshness, quality, and trending tier—not the candidate’s profile or preferences.

### Existing evidence

- `src/routes/_authenticated/candidate/dashboard.tsx` — “Recommended for you” dashboard section.
- `src/routes/jobs.tsx` and `src/lib/job-feed.ts` — discovery listing/filter integration.
- `supabase/migrations/20260926071831_feed_jobs_for_candidate.sql` — applied-job exclusion.
- `supabase/migrations/20260928061220_trending_ranking_bonus.sql` — current generic job-ranking formula.

### Implementation plan

1. Establish feed types and labels:
   - **Recommended for you:** candidate-specific matching.
   - **New jobs:** recency-based, explicit label.
   - **Popular jobs:** based on approved engagement metrics.
   - **Promoted jobs:** paid placement, always labelled and capped.
   - **Nearby jobs:** distance/radius-based once geospatial data exists.
2. Build a dedicated `recommend_jobs_for_candidate()` service/RPC. It must derive identity from `auth.uid()` rather than accepting candidate IDs from the browser.
3. Filter before ranking: active/unexpired jobs, not already applied/withdrawn/hidden, candidate eligibility, and mandatory job requirements.
4. Rank using approved candidate-job signals: canonical skills, target role, experience, salary expectations, work mode, preferred areas/distance, job quality, and bounded freshness/boost effects.
5. Return score version and explanation fields such as “matches 4 of your skills” and “fits your preferred work mode.”
6. Add diversity constraints: cap repeated companies/near-identical titles and mix relevant categories where scores are close.
7. Add cursor/page consistency, no-result states, skeleton/error states, and a safe cold-start fallback labelled as generic discovery.
8. Instrument impressions, detail views, saves, applications, hides, and recommendation errors by feed type/rank/version.

### Acceptance criteria

- Two candidates with different preferences receive materially different Recommended results.
- Applied jobs are never returned in candidate discovery pages.
- Paid placement cannot silently replace relevance as the dominant ranking signal.

## 2. Smart Job Filters

### Description

Smart filters help candidates narrow jobs by title/keyword, city, category, job type, work mode, salary, experience, education, shift, language, employer, vehicle requirement, verified employer, and posting date.

### Current state

**Implemented at a functional level.** The `/jobs` experience and feed RPC support a broad set of filters, including explicit sort modes. There is also AI-assisted search broadening logic for zero/overly narrow results.

### Existing evidence

- `src/routes/jobs.tsx` — job search/filter UI.
- `src/lib/job-feed.ts` — shared RPC argument adapter.
- `supabase/migrations/20260926071831_feed_jobs_for_candidate.sql` — candidate-aware filter/query contract.
- `src/lib/search-broaden.functions.ts` — search-broadening assistance.

### Implementation plan

1. Keep the current filters, but normalize their values to master data IDs where practical. Avoid relying on inconsistent free-text values for category, city, skills, and job titles.
2. Treat filters as URL state so results can be shared, bookmarked, indexed only when suitable, and restored after login.
3. Add filter counts only when they can be computed cheaply; do not run one expensive query per filter option.
4. Add “clear all,” active-filter chips, saved searches, and persistent candidate default filters.
5. Add a query parser that can recognize common job-seeker inputs such as “delivery jobs in Pune, 20k, night shift.” The parsed filters must remain visible/editable before search.
6. Improve zero-result behavior: show why the query may be too narrow, offer controlled broadening, and preserve the original query.
7. Track filter use, zero-result rate, filter-removal recovery, and query-to-application conversion.
8. Review database indexes and query plans for every high-selectivity filter. Add only evidence-backed indexes; partial indexes for active/unexpired jobs are likely candidates after measuring real workload.

### Acceptance criteria

- Filter combinations are applied server-side before pagination.
- Candidate and guest result sets are correct for their access model.
- A zero-result search offers useful recovery rather than a blank page.

## 3. Elasticsearch / Algolia

### Description

Elasticsearch or Algolia provides specialized full-text search, typo tolerance, faceting, synonyms, ranking controls, and low-latency autocomplete at larger marketplace scale.

### Current state

**Not implemented.** No Elasticsearch/Algolia client, index configuration, indexing worker, webhook, or provider environment variables were found. Current search uses PostgreSQL/Supabase RPC filtering and `ILIKE` title/city/company matching.

### Decision required

Do not introduce a second search system purely because the diagram names one. PostgreSQL full-text search plus well-designed indexes may be sufficient initially. Adopt a dedicated search engine when search latency, typo tolerance, faceting, autocomplete, or scale requirements justify operational complexity.

### Implementation plan

1. Establish baseline metrics first: p50/p95 search latency, result count, zero-result rate, query volume, autocomplete latency, and database load.
2. Decide between:
   - **Postgres-first:** full-text search (`tsvector`), trigram indexes, synonym tables, and RPC ranking.
   - **Algolia:** managed fast search/faceting with lower operations effort.
   - **Elasticsearch/OpenSearch:** maximum control at higher operational cost.
3. Define a single public job search document: job ID, title, normalized title, category, skills, company name/verification, city/locality/state, salary range/period, experience range, work mode, job type, active/expiry status, quality, boost metadata, and geospatial point when available.
4. Create an asynchronous outbox/indexing pipeline triggered by job create/update/status/expiry/delete events. It must be idempotent, retryable, observable, and capable of full reindex.
5. Do not copy candidate private data into a public job index.
6. Apply the same source-of-truth eligibility checks to search result retrieval; index lag must not expose expired or inactive jobs.
7. Implement typo tolerance, synonyms, language-aware stemming only after reviewing Indian-language/role vocabulary needs.
8. Use provider query rules carefully: sponsored/boosted jobs must be labelled and bounded.
9. Build shadow queries against the existing database results, compare recall/ranking, then progressively route a small percentage of traffic to the new engine.

### Acceptance criteria

- Index updates are idempotent and recoverable after outage/replay.
- An inactive/expired job cannot remain publicly visible merely because of index delay.
- Search relevance and latency improve against a documented baseline.

## 4. Nearby Jobs

### Description

Nearby Jobs lets candidates find opportunities within a chosen radius/locality and helps local employers reach geographically relevant candidates.

### Current state

**Not implemented as true nearby search.** Current job/candidate logic stores city and related text fields; matching uses city/preferred-city/state comparisons. No latitude/longitude or PostGIS geography implementation was found.

### Implementation plan

1. Define location consent, precision, retention, employer visibility, and opt-out policy before collecting coordinates.
2. Store normalized city, locality, pincode, state, geocode source/confidence, and a precision-limited geography point for job locations and candidate preferred areas.
3. Enable PostGIS after environment verification. Use geography data types and GiST indexes; use radius bounding prefilters before exact distance calculations.
4. Add candidate settings for preferred localities/radius, travel willingness, relocation, and remote work.
5. Add nearby filters and result cards showing distance bands rather than exposing sensitive precise locations.
6. Exclude/handle remote, multi-location, field-sales, and pan-India jobs explicitly rather than assigning misleading distance values.
7. Add a geocoding queue with retry/manual correction for unrecognized or ambiguous addresses.
8. Test location consent withdrawal, missing coordinates, duplicate city names, rural locations, radius boundaries, and remote-job behavior.

## 5. Category-wise Jobs

### Description

Category-wise Jobs organizes active jobs into consistent career/industry categories for browsing, filtering, SEO landing pages, and analytics.

### Current state

**Implemented at a basic level.** Jobs have a category field and the feed supports category filtering. The project also has master-data/admin capabilities and category-aware job tools.

### Implementation plan

1. Define a canonical category taxonomy with stable IDs, display names, descriptions, parent/child relationship if needed, synonyms, and active status.
2. Require/validate category assignment in the job-creation workflow. Use controlled AI suggestions only as editable assistance.
3. Add category browse pages that query only active/unexpired, publicly visible jobs and paginate server-side.
4. Add category-specific filters and useful content blocks without creating thin, duplicate SEO pages.
5. Track category supply, applications/job, fill rate, salary range, candidate demand, and zero-result rate.
6. Create an admin taxonomy workflow for merge, rename, deprecate, and remap jobs without breaking URLs or historical reporting.

## 6. City-wise Jobs

### Description

City-wise Jobs lets candidates browse jobs in a city and supports location pages that can be useful for SEO and marketplace liquidity.

### Current state

**Implemented at a basic level.** Jobs contain city/state/locality fields, city is a feed filter, and the project has a `cities` master table.

### Implementation plan

1. Use the `cities` master record/slug as the canonical location identity; retain free-text historical labels only for migration/display compatibility.
2. Validate city/state mapping at job creation and offer locality/pincode suggestions from the selected city.
3. Add city browse pages with active/unexpired jobs, useful filters, pagination, canonical URLs, and a no-jobs fallback that suggests nearby cities/categories.
4. Support multi-city and remote jobs deliberately; do not force them into one city page without clear rules.
5. Add city availability/quality checks so thin or empty pages are no-indexed or omitted from sitemaps.
6. Track city-level supply, application conversion, response times, and candidate demand.

## 7. SEO Public Listings

### Description

SEO public listings make eligible job, city, and category pages discoverable by search engines while avoiding duplicate, expired, low-value, or private content.

### Current state

**Partially implemented.** Public job and public company/candidate-style routes exist, and route-level metadata is used. A comprehensive sitemap, robots policy, structured data, canonical strategy, and controlled city/category SEO page system were not found in the repository.

### Implementation plan

1. Define indexable page types: active job detail, approved city landing pages, approved category landing pages, and selected city-category combinations with sufficient content/supply.
2. Define non-indexable pages: internal dashboards, search query/filter URLs, application pages, expired/removed jobs, thin pages, candidate private data, and duplicate pagination variants as appropriate.
3. Generate dynamic XML sitemaps from active/unexpired canonical records. Split sitemaps if volume requires it, include `lastmod`, and remove expired jobs promptly.
4. Add `robots.txt`, canonical URLs, page titles, meta descriptions, Open Graph metadata, and predictable slug handling.
5. Add `JobPosting` JSON-LD to public active job-detail pages. Include only accurate fields and remove/refresh structured data when a job expires.
6. Return correct HTTP semantics for deleted, expired, moved, and private jobs; do not return soft-404 pages with indexable success responses.
7. Prevent search-result/filter pages from creating crawl traps with arbitrary combinations.
8. Add SEO monitoring for index coverage, crawl errors, invalid structured data, sitemap freshness, organic landing-page traffic, and expired-job impressions.

---

# Flow 2 — Job Application & Hiring Pipeline

## 8. Fast Apply

### Description

Fast Apply lets a candidate submit a job application quickly using their saved profile/resume, with only job-specific information requested when necessary.

### Current state

**Implemented.** Application UI/components, saved resume handling, application records, duplicate prevention at database level, and candidate application views are present.

### Existing evidence

- `src/components/candidate/ApplyDialog.tsx` and `ApplicationFormFields.tsx`.
- `src/routes/_authenticated/candidate/applications.tsx`.
- `supabase/migrations/20260617111751_66a186bd-1332-4c08-9ce7-ae5e0d3c4349.sql` — application constraints/policies.

### Implementation plan

1. Preserve the current saved-profile/resume default while identifying required job-specific answers in job schema.
2. Add a pre-apply readiness check: required resume/document present, mandatory question answers, candidate eligibility, job active/unexpired, and no existing active application.
3. Keep application creation atomic in a server/RPC transaction; use database uniqueness as the final duplicate guard.
4. Add an idempotency key/client retry strategy so network retries never create multiple applications.
5. Clearly display what information will be shared with the employer before submission.
6. Permit candidate withdrawal only under clear status/time rules and log it in history.
7. Track form abandonment, time-to-apply, duplicate-attempt rate, submit failures, and application-to-response conversion.

## 9. Application Tracking

### Description

Application tracking lets candidates see each application and its current stage, while employers manage candidate progress reliably.

### Current state

**Implemented.** The candidate application page shows applications, statuses, related job information, and interview details. Status history is written by database triggers when status changes.

### Existing evidence

- `src/routes/_authenticated/candidate/applications.tsx`.
- `supabase/migrations/20260630002107_42eb8531-a932-41c7-a5d0-1822a6af0b79.sql` — `application_status_history` trigger writes.

### Implementation plan

1. Establish one canonical application state machine, e.g. `applied → reviewed → shortlisted → interview → hired/rejected`, with `withdrawn` as candidate action and permitted transitions defined explicitly.
2. Ensure every transition records actor, timestamp, reason code, optional note visibility, and source (UI, bulk action, automation).
3. Replace arbitrary browser table updates for sensitive transitions with a membership-checked RPC/server function that validates the state machine.
4. Show candidates a timeline with human-friendly status descriptions, timestamps, and next actions; do not expose employer-only notes.
5. Add service-level reminders for applications that have not been viewed/responded to within target time windows.
6. Add bulk employer actions only where all selected applications have a valid transition.
7. Test concurrent status changes, unauthorized cross-company updates, candidate withdrawal, expired-job effects, and duplicate notifications.

## 10. HR Viewed Status

### Description

HR Viewed Status confirms that an employer has opened/reviewed a candidate’s application, reducing candidate uncertainty before a shortlist or rejection decision.

### Current state

**Not clearly implemented as a distinct, reliable status.** The pipeline has `applied`, `shortlisted`, `interview`, `hired`, `rejected`, and `withdrawn`; no repository evidence was found for a persisted `viewed_at` event/state when HR opens an application.

### Implementation plan

1. Decide whether “viewed” is a separate display-only event or a state. It should usually be an event (`first_viewed_at`, `last_viewed_at`) rather than a state that competes with shortlist/rejection.
2. Create a membership-checked `mark_application_viewed(application_id)` mutation/RPC. It must confirm the actor belongs to the job’s company.
3. Write only the first-view event once for candidate messaging; optionally retain a separate review-event table for audit/analytics.
4. Do not mark viewed when an employer merely loads a bulk list; mark it when the employer opens the application/review panel or explicitly selects it for review.
5. Send one in-app/email/push candidate update according to notification preferences: “Your application was viewed.” Avoid repeated alerts on each revisit.
6. Add employer metrics: time to first view, unread applications, and view-to-shortlist conversion.

## 11. Interview Scheduled

### Description

This step creates, shares, reminds, reschedules, cancels, and records an interview between employer and candidate.

### Current state

**Implemented substantially.** The project includes employer interview scheduling, candidate interview display, interview token/join flow, Zoom integration support, reminders, and scheduling-related migrations/Edge Functions.

### Existing evidence

- `src/components/employer/ScheduleInterviewModal.tsx`.
- `src/routes/_authenticated/employer/interviews.tsx` and `src/routes/interview-join.tsx`.
- `supabase/migrations/20260917125938_interview_zoom_scheduling.sql` and `20260918053901_interview_t30_reminder_cron.sql`.
- `supabase/functions/interview-scheduled` and `supabase/functions/interview-reminder`.

### Implementation plan

1. Audit all interview modes (video, phone, onsite) and providers against a single interview schema/state machine: scheduled, rescheduled, cancelled, completed, no-show.
2. Verify candidate/employer authorization on every create, reschedule, cancel, join, and note action.
3. Require timezone-aware display/storage; store in UTC and render with candidate/employer locale rules.
4. Add calendar invitations/ICS files and a reschedule/cancel policy with clear ownership and notifications.
5. Make reminders idempotent: exactly one intended reminder per interview/channel/time window, with delivery outcomes logged.
6. Add no-show/outcome capture and optionally follow-up tasks for the employer.
7. Monitor Zoom/provider failures and provide a safe fallback meeting link/instructions without leaking credentials.

## 12. Rejected / Selected

### Description

Employers close a candidate’s process as rejected or hired/selected, and candidates receive an accurate, respectful update.

### Current state

**Implemented at a basic pipeline level.** Applicant statuses include `hired` and `rejected`; candidate and employer interfaces group/show outcomes. Status changes are written to history and create in-app notifications. Email is designed for shortlisted, interview, and rejected statuses.

### Implementation plan

1. Use “hired” as the canonical selected outcome internally; show user-friendly “Selected” wording if preferred.
2. Enforce allowed state transitions and employer membership through a controlled server/RPC mutation.
3. Add optional employer-only reason codes and optional candidate-facing rejection templates. Never expose internal discriminatory/free-text comments to candidates.
4. Ensure a hired/rejected decision finalizes or cancels outstanding interview reminders appropriately.
5. Offer feedback only where it is safe, standardized, and operationally sustainable; do not force recruiters to write free-form rejection explanations.
6. Track time to decision, candidate response rate, rejection reason distribution, offer acceptance where applicable, and unresolved/abandoned applications.
7. Define data retention after outcome, including when candidate documents/responses should be purged under existing retention policy.

## 13. Candidate Analytics

### Description

Candidate analytics helps a job seeker understand progress: profile strength, job views, applications, response rate, interview conversion, outcomes, and practical improvement actions.

### Current state

**Partially implemented.** Candidate dashboard has basic counts for applied, shortlisted, interview, views, applications this week, profile strength, and missing-profile prompts. It is not a detailed analytics/funnel product.

### Existing evidence

- `src/routes/_authenticated/candidate/dashboard.tsx`.
- `candidate_profiles.profile_views` and application tables/migrations.

### Implementation plan

1. Define candidate-safe metrics: profile completion, verified status, profile views, application count, employer first-view rate, shortlist rate, interview rate, outcome rate, and median response time.
2. Clearly define denominators and display them only after minimum sample sizes to avoid misleading conclusions.
3. Create server-side aggregate queries/rollups; candidates must only see their own data.
4. Add a time-series view for last 7/30/90 days and category/city breakdown where it provides actionable insight.
5. Pair every weak metric with a concrete next action: improve missing skills, upload/refresh resume, broaden location, or set alerts.
6. Do not expose employer-private decisions, ranking data, or reasons not intended for candidates.
7. Add privacy controls and ensure analytics are not used as a hidden trust/eligibility score.

---

# Flow 3 — Notification & Engagement

## 14. Job Match Trigger

### Description

A job match trigger determines when a candidate should be notified about a newly created/updated job that fits their saved alert or preference profile.

### Current state

**Partially implemented.** Candidate job alerts support keyword/city queries with instant, daily, and weekly frequencies. There are Edge Functions for instant alerts and digests; matching is currently simple title/city alert matching rather than the full candidate recommendation score.

### Existing evidence

- `src/routes/_authenticated/candidate/alerts.tsx`.
- `supabase/functions/alert-instant-notify`, `alert-digest`, and `send-alert-confirmation`.
- `supabase/migrations/20260914075503_alert_job_notifications.sql` — alert deduplication and digest cron schedules.

### Implementation plan

1. Separate alert matching from recommendation ranking. Alerts need predictable explicit query/preference matches; recommendation relevance can be broader and scored.
2. Create one event/outbox row whenever a job becomes publicly active or materially changes. Process matching asynchronously rather than looping over all candidates inside a job-write transaction.
3. First apply candidate consent, frequency limits, timezone, recent sends, job eligibility, and deduplication; then compute alert/recommendation compatibility.
4. Use the existing `(alert_id, job_id)` deduplication concept for every delivery channel and include a delivery idempotency key.
5. Handle updates carefully: do not re-notify on trivial edits; define meaningful changes such as newly active, salary increase, location change, or urgency change.
6. Build a dead-letter/retry strategy for delivery failure and an operational dashboard for queued/failed/suppressed notifications.
7. Measure match-to-open, match-to-apply, unsubscribe/hide rates, and notification fatigue.

## 15. Push Notifications

### Description

Push notifications reach installed web/mobile clients for time-sensitive events such as application status changes, interviews, saved alerts, and relevant job matches.

### Current state

**Not implemented.** In-app notifications exist, but no PWA service worker, native push provider, device-token table, notification permission flow, or push delivery worker was found.

### Implementation plan

1. Deliver PWA/native-app foundation first. Browser push requires a service worker; mobile push requires platform provider configuration.
2. Add a device subscription/token model containing user ID, platform, endpoint/token, keys, consent state, locale/timezone, last-seen, invalidated-at, and device/app version.
3. Request permission only after a clear value moment, not immediately on page load. Explain the notification types and let users choose categories.
4. Create a central notification orchestration service that selects in-app, push, email, WhatsApp, or no delivery based on event type, preference, consent, frequency cap, and recent delivery history.
5. Use deep links safely; notification payloads must not contain private resume/contact data.
6. Remove invalid tokens on provider response and implement retry/backoff only for retryable failures.
7. Build tests for permission denied, multiple devices, logout/token removal, deep links, duplicate events, and quiet hours.

## 16. WhatsApp Notifications

### Description

WhatsApp notifications deliver consented transactional or approved template messages for high-value events, particularly in a mobile-first hiring market.

### Current state

**Partially prepared but not implemented end-to-end.** Candidate profile schema includes WhatsApp number/opt-in fields and migrations include a WhatsApp send registration helper. No complete provider integration, approved-template catalogue, delivery worker, or candidate preference UI flow was found.

### Implementation plan

1. Choose an approved WhatsApp Business API provider and document template approval, pricing, regional compliance, opt-in/opt-out, and data-processing requirements.
2. Collect explicit, granular WhatsApp consent. Store timestamp, source, policy version, phone normalization, and opt-out state; do not infer consent from a mobile number.
3. Define message categories: transactional application/interview updates, job alert summaries, and marketing/re-engagement. Apply different consent and frequency rules.
4. Create a template registry with stable IDs, variables, language, approval status, owner, and fallback copy. Render/validate variables server-side.
5. Send through a secure server/Edge Function queue; never expose provider tokens in the client.
6. Log attempts, provider message ID, delivery/read/failure webhooks, cost, suppression reason, and idempotency key.
7. Implement STOP/opt-out webhook processing immediately and mirror opt-out to candidate settings.
8. Add fallback to in-app/email/push when WhatsApp is unavailable or declined.

## 17. Email Notifications

### Description

Email notifications provide durable transactional updates and job-alert delivery, with preference controls, delivery monitoring, and unsubscribe compliance.

### Current state

**Implemented partially.** Resend helper/templates and Edge Functions support alert confirmation, instant/digest job alerts, and application-status emails for shortlisted/interview/rejected flows. In-app notification writes also occur through database triggers.

### Existing evidence

- `supabase/functions/_shared/resend.ts` and `_shared/templates.ts`.
- `supabase/functions/alert-digest`, `alert-instant-notify`, `application-status-notify`.
- `supabase/migrations/20260630002107_42eb8531-a932-41c7-a5d0-1822a6af0b79.sql` — in-app application notification trigger.

### Implementation plan

1. Create a channel-independent notification event/outbox. The action that changes an application should commit independently from external email delivery.
2. Use event IDs/idempotency keys so retries, client retries, and webhooks never send duplicate messages.
3. Centralize templates with versioning, locale, transactional/marketing classification, preview tests, and variables validated before send.
4. Respect notification preferences, unsubscribe/opt-out rules, quiet hours for non-urgent mail, and candidate account status.
5. Process provider webhooks for delivered, bounced, complained, deferred, and suppressed outcomes; update suppression state rather than repeatedly sending to invalid addresses.
6. Complete lifecycle coverage: new application acknowledgement, employer first view (when implemented), shortlist, interview create/reschedule/cancel/reminder, rejection, hired, job alert, invitation to apply, and security/account notices.
7. Confirm scheduled digest infrastructure is available in the target Supabase plan/environment; the existing migration notes pg_cron availability requirements.
8. Add dashboard metrics for send volume, delivery rate, bounce/complaint rate, open/click rate where permitted, and alert-to-application conversion.

## 18. Retention Engine

### Description

A retention engine encourages meaningful re-engagement—such as completing a profile, responding to an interview, reviewing new matched jobs, or refreshing an outdated resume—without spam or manipulative messaging.

### Current state

**Not implemented as a cohesive system.** Candidate nudges, alerts, notifications, job-expiry reminders, and response-retention/purge operations exist independently, but there is no behavioural segmentation, campaign orchestration, frequency capping, or retention measurement system.

### Implementation plan

1. Define permitted retention goals and exclusion rules: never message suspended users, opted-out users, recently hired users, or candidates with an active critical workflow unless the event is relevant.
2. Define candidate lifecycle segments: new/unverified, onboarding incomplete, profile incomplete, active searcher, applied-awaiting-response, interview active, dormant, hired, and reactivated.
3. Design a small initial set of trigger campaigns with clear value:
   - resume/profile completion reminder;
   - new high-match job alert;
   - saved-search/job-alert reminder;
   - application follow-up where employer has not responded;
   - resume/profile refresh after a defined inactivity period.
4. Create an event-driven campaign/outbox model with audience eligibility, schedule, channel priority, per-user caps, quiet hours, control group, and dedupe key.
5. Require explicit channel consent and add “pause notifications”/frequency preferences.
6. Measure incremental lift using holdout groups: reactivation, profile completion, application rate, interview attendance, unsubscribe rate, and complaint rate.
7. Add campaign governance: owner, purpose, review date, template version, rollout percentage, and emergency stop control.

## 19. Referral & Rewards

### Description

Referral and rewards incentivize candidates/employers to introduce legitimate new users or successful outcomes, with fraud prevention and clear reward rules.

### Current state

**Not implemented.** No referral code model, attribution table, reward ledger, reward workflow, or referral UI was found.

### Implementation plan

1. Define the business model before implementation: who can refer whom, qualifying events, reward type (credit, cash, voucher, subscription benefit), expiry, caps, tax/compliance, and dispute process.
2. Create immutable referral attribution and reward-ledger records. Never use a mutable profile field as the sole reward source of truth.
3. Bind attribution at sign-up/first verified action, with a short, documented correction window. Prevent self-referral and circular referrals.
4. Award rewards only after a qualifying event such as verified onboarding, first valid application, first paid employer purchase, or verified hire—depending on the approved model.
5. Add fraud controls: unique verified phone/account checks, device/IP risk signals, payout thresholds, velocity limits, manual review, reversal ledger entries, and audit events.
6. Build candidate/employer referral screens with code/link, status timeline, terms, pending/earned reward state, and support/dispute entry point.
7. Integrate reward fulfilment with the existing credit/payment ledger only through atomic, idempotent server/database operations.
8. Track invite-to-signup, verified conversion, qualified conversion, fraud/reversal rate, cost per acquired qualified user, and cohort retention.

---

# Recommended delivery sequence

## Phase 0 — Verify and secure existing flows

1. Verify migrations, RLS policies, Edge Function deployments, email secrets, and cron schedules in each environment.
2. Formalize application state transitions and replace sensitive direct status writes with a guarded mutation boundary.
3. Define notification preferences, consent, channel caps, and idempotency policy.
4. Add `HR viewed` as an audited event if product stakeholders approve it.

## Phase 1 — Improve relevance and discoverability

1. Build candidate-specific job recommendation service and correct the “Recommended” label/behavior.
2. Normalize skills, titles, categories, and locations used for search/matching.
3. Improve smart filters, saved searches, zero-result recovery, and search telemetry.
4. Implement SEO sitemap, canonical/noindex policy, and JobPosting structured data.

## Phase 2 — Notification foundation

1. Implement a channel-independent notification outbox/orchestrator.
2. Migrate alert/application/interview email delivery to idempotent event processing.
3. Add provider webhook monitoring, failure/retry handling, and delivery dashboards.
4. Add PWA/native push only after installation/service-worker foundations are in place.
5. Add WhatsApp only after consent, templates, provider compliance, and opt-out workflow are approved.

## Phase 3 — Marketplace scale features

1. Decide Postgres full-text versus Algolia/Elasticsearch using production metrics.
2. Implement the selected search indexing/query architecture if needed.
3. Add geocoding/PostGIS, nearby jobs, and distance ranking.
4. Build candidate analytics rollups and practical coaching prompts.

## Phase 4 — Growth systems

1. Deploy governed retention campaigns with holdout measurement.
2. Launch referral/reward model with fraud controls and immutable ledger.
3. Iterate on campaigns/search/recommendations using conversion and quality data.

# Cross-cutting acceptance checklist

- All job search and recommendation queries filter inactive/expired jobs before pagination.
- Candidate identity comes from authenticated server context, not client-supplied IDs, for candidate-specific data.
- RLS protects candidate applications, notifications, documents, and preferences from cross-user/cross-company access.
- Any privileged RPC checks `auth.uid()` and company membership, has restricted `search_path`, and has explicit execution grants.
- Notification sends are idempotent, consent-aware, frequency-capped, logged, and independently retryable from the original transaction.
- Search indexes, if introduced, are asynchronous, replayable, and cannot expose stale private/inactive records.
- SEO output reflects only public, active, canonical jobs and is removed promptly at expiry.
- New analytics/reporting use server-side aggregates and do not expose private employer decision data to candidates.
- Referral rewards are ledger-based, reversible by counter-entry, and protected from self-referral/velocity abuse.

# Priority backlog

| Priority | Item | Reason |
|---|---|---|
| P0 | Candidate-specific recommendation feed | Current “Recommended” feed is not profile-personalised. |
| P0 | Verify live deployment of existing alert/email/cron features | Repository code alone does not prove operational delivery. |
| P0 | Guard application state transitions and add idempotency | Application outcomes and candidate messaging must be reliable. |
| P1 | Notification outbox/orchestrator | Needed before adding push, WhatsApp, or retention automation safely. |
| P1 | SEO sitemap/indexation/structured data | Public job listings need controlled discoverability and expired-page hygiene. |
| P1 | HR viewed event | Directly addresses a requested pipeline milestone and improves transparency. |
| P2 | Candidate analytics | Builds on reliable application history and status events. |
| P2 | Geospatial nearby/distance foundation | Required for genuine nearby jobs; includes privacy/consent work. |
| P2 | Search-engine decision and scale implementation | Adopt only after measuring current PostgreSQL search limits. |
| P3 | Retention engine | Requires consent, notification orchestration, and measurement first. |
| P3 | Referral and rewards | Requires approved economics, fraud controls, and ledger design. |


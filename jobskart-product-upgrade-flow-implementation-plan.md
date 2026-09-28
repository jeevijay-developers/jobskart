# JobsKart Product Upgrade Flows — Detailed Implementation Plan

**Status:** Planning document only. No application, database, or configuration changes were made while preparing it.

**Audit scope:** Repository source, migrations, routes, server functions, Supabase Edge Functions, and existing implementation plans were reviewed on 28 September 2026.

> **Deployment note:** This document describes what is present in the repository. It does not prove that every migration or Edge Function is deployed to the linked Supabase project. Before a feature is marked live, verify migration history, bucket configuration, secrets, and deployed function versions in the target environment.

## Executive summary

JobsKart already has a strong web-platform base: candidate and employer onboarding, private resume storage, resume parsing, candidate profile completion, employer-team roles, a protected admin area, candidate search, and employer-side candidate recommendations.

The highest-priority correction is the candidate-facing **“Recommended for you”** feed. It currently uses a generic job-ranking formula based on boost, freshness, quality, and tier/trending signals. It excludes jobs the candidate has already applied to, but it does **not** score jobs using that candidate's preferences, skills, experience, salary expectations, or location. The product label should not be treated as personalised until a candidate-specific recommendation RPC replaces this ranking.

The other priority production gap is authentication: the mobile OTP interface currently operates in demo mode and accepts any six-digit code. It must be replaced with a real provider-backed OTP flow before public production use.

## Current architecture in brief

```text
React / TanStack Start UI
        |
        +-- Direct Supabase client reads/writes protected by RLS
        +-- TanStack server functions for privileged or integration workflows
        +-- Supabase RPCs for matching, feeds, admin and employer workflows
        +-- Supabase Storage for private candidate documents
        +-- Edge Functions / scheduled jobs for notifications and operational sweeps
```

The project uses imperative SQL migrations under `supabase/migrations`. Any future database work must be added through reviewed migrations, with RLS enabled on exposed tables, least-privilege grants, explicit function execution grants, and verification in an isolated environment before release.

## Delivery principles

1. **Security before convenience.** OTP, authorization, candidate documents, personally identifiable information, and `SECURITY DEFINER` functions require explicit controls and tests.
2. **Deterministic matching before opaque AI.** Start with explainable skills, preferences, location, experience, and salary rules. Introduce model-based ranking only after outcome data and fairness controls exist.
3. **Separate eligibility from ranking.** First remove jobs a candidate cannot take; then score the remaining jobs. Paid boost must be bounded and disclosed so it cannot silently override relevance.
4. **Use canonical data.** Skill names, cities, localities, salary periods, and job types should be normalized before they are used in filters or scores.
5. **Protect location privacy.** Do not expose a candidate's exact home location to employers. Store/use only the precision required for matching and gain explicit user consent.
6. **Measure every new system.** Add events, dashboards, alerts, and acceptance tests with each feature; otherwise recommendation and trust systems cannot be improved safely.

---

# Flow 1 — Admin control panel and platform infrastructure

## 1. Admin Control Panel

### Description

The admin control panel is the internal operating surface for managing users, jobs, companies, KYC/verification, master data, plans, credits, banners, and learning content.

### Repository finding

**Implemented.** The repository includes a dedicated `/admin` layout, login route, navigation shell, and individual operational routes. The route guard checks the authenticated user against `has_platform_role(..., 'super_admin')`.

### Existing evidence

- `src/routes/admin/route.tsx` — admin authentication and platform-role guard.
- `src/routes/admin/dashboard.tsx` — current platform KPI dashboard.
- `src/components/admin/AdminShell.tsx` — shared admin navigation.
- `src/routes/admin/*` — users, companies, jobs, credits, plans, masters, banners, resumes, learning, and verification surfaces.

### Remaining implementation plan

1. Create an operations inventory that lists every existing admin route, the mutation it permits, the applicable role, and the audit record it creates.
2. Add queue-oriented views for pending KYC, reported jobs, suspicious accounts, failed resume parses, failed notification deliveries, and recommendation-health alerts.
3. Add a read-only audit-log search screen with actor, action, target, timestamp, company, and correlation ID filters.
4. Add server-side pagination, date filters, and exports for large queues; do not rely on loading entire tables into the browser.
5. Add an admin action confirmation policy for high-impact actions: suspension, data deletion, role changes, credit refunds, and verification decisions.
6. Add end-to-end tests proving an ordinary authenticated candidate/employer cannot enter, query, or mutate admin data.

### Acceptance criteria

- Every admin mutation is performed by a server function or tightly scoped RPC, is auditable, and returns a safe error to unauthorized users.
- Operations staff can resolve all major support queues without direct database access.

## 2. RBAC Access Control

### Description

Role-based access control decides who can view data and perform actions. JobsKart needs this at two levels: platform administration and employer-company teams.

### Repository finding

**Partially implemented.** Platform RBAC currently defines only `super_admin`. Employer membership and roles exist, including company-scoped authorization helpers. This is sufficient for a small owner/admin/recruiter model, but not for delegated internal operations.

### Existing evidence

- `supabase/migrations/20260623052758_0ba1b5c8-af92-4093-a646-18007f53fa42.sql` — `platform_roles`, `has_platform_role`, and current `super_admin` role.
- `supabase/migrations/20260617103716_eef5bf4a-6e35-428c-9e87-6804c9952d2e.sql` — `employer_members`, company membership/role helpers, and company policies.

### Implementation plan

1. Write and approve a permission matrix before changing code.

   | Scope | Recommended roles | Examples |
   |---|---|---|
   | Platform | super admin, operations, support, moderator, finance, analyst | moderation, refunds, read-only analytics, KYC review |
   | Employer company | owner/super admin, HR admin, recruiter, viewer | company edits, job posting, applicant handling, reporting |

2. Define permissions as capabilities, not merely screen access; for example `candidate.unlock`, `job.publish`, `credit.refund`, `kyc.review`, and `analytics.read`.
3. Extend platform role schema only after deciding whether a user can hold multiple roles and whether roles need an expiry or scope.
4. Enforce authorization at the database/RPC/server-function boundary. UI hiding is helpful but is not authorization.
5. For every RLS policy, use both ownership/scope predicates and `WITH CHECK` for writes. Never rely on `TO authenticated` alone.
6. For every privileged SQL function, use an explicit `auth.uid()`/membership check, a restricted `search_path`, and revoke `PUBLIC` execution before granting the intended role.
7. Create a role-test matrix covering select, insert, update, delete, RPC execution, file access, direct URL access, and cross-company access.
8. Add an append-only audit event for role assignments, revocations, permission-sensitive actions, and failed authorization attempts.

### Acceptance criteria

- No role can access another company's candidate, job, credit, or document data.
- Support/moderation roles can complete their permitted work without receiving super-admin financial or role-management rights.
- Every new role has automated positive and negative authorization tests.

## 3. Analytics Dashboard

### Description

The analytics dashboard should turn platform activity into decisions: acquisition, activation, job supply, application demand, quality, revenue, and operational risk.

### Repository finding

**Partially implemented.** The admin dashboard provides useful live KPI cards: users, candidates, employers, open jobs, applications, KYC pending, 30-day revenue, and job-quality measures. It does not yet provide time-series analysis, funnels, cohorts, drill-down, or a central event model.

### Existing evidence

- `src/routes/admin/dashboard.tsx` — KPI cards.
- `src/lib/admin-overview.functions.ts` — server-side aggregation of current KPIs.

### Implementation plan

1. Define an event dictionary with stable names and payload ownership. Minimum events: account created, OTP verified, onboarding step completed, resume uploaded, resume parsed, profile completed, job viewed, job saved, job applied, employer invite sent, candidate unlocked, candidate contacted, interview scheduled, job expired, and payment completed.
2. Capture sensitive events server-side wherever possible. Client events may enrich interaction data but must not be the source of truth for money, verification, authorization, or application status.
3. Create daily aggregate tables/materialized rollups for high-volume reporting rather than repeatedly scanning raw events on every dashboard request.
4. Build dashboard sections in this order:
   - Acquisition: registrations by channel/device/location.
   - Activation: OTP-to-onboarding, onboarding-to-profile-complete, resume parsing success.
   - Marketplace health: active jobs, candidate availability, applications per active job, time to first applicant.
   - Recommendation quality: impressions, opens, saves, applies, hide/not-interested rate, zero-result rate.
   - Revenue: purchases, refunds, credits consumed, plan conversion.
   - Trust and safety: KYC funnel, reports, suspensions, suspicious-login/OTP signals.
5. Add date ranges, comparison periods, CSV exports, and drill-down links to the relevant admin queue.
6. Add data-quality alerts for delayed event ingestion, large metric changes, recommendation RPC errors, failed background jobs, and parser failure spikes.

### Acceptance criteria

- A stakeholder can answer “where candidates drop off,” “which job categories convert,” and “whether recommendations cause applications” without manual SQL.
- Dashboard totals reconcile with source-of-truth transaction/application tables.

## 4. Cloud Resume Storage

### Description

Candidates need secure, durable résumé/document storage. Candidates should manage their own files; employers should only be able to access documents where a legitimate hiring relationship exists.

### Repository finding

**Implemented at a basic level.** Résumés are uploaded to the private `candidate-docs` bucket. Storage policies permit candidate-owned access and a later migration permits hiring employers to read applicable documents. Signed URLs are generated for viewing.

### Existing evidence

- `src/routes/_authenticated/onboarding/candidate.tsx` and `src/routes/_authenticated/candidate/profile.tsx` — resume upload and signed URLs.
- `supabase/migrations/20260617120736_0e8f1800-bfa1-475b-a3e0-f96b32eacae7.sql` — candidate document tables and storage policies.
- `supabase/migrations/20260915063243_fix_applicant_data_access.sql` — hiring-employer access rules.

### Implementation plan

1. Confirm the production bucket is private, has a file-size limit, and its policies exactly match the migration intent.
2. Move upload authorization and path construction into one shared server-side policy/helper. Enforce a path such as `<candidate-id>/<document-id>/<safe-file-name>`.
3. Validate extension, MIME type, file signature (“magic bytes”), size, and page/image limits. Browser MIME type alone is not sufficient.
4. Upload files first to a quarantine prefix/bucket. Scan for malware and unsafe content asynchronously; only promote clean files to the normal candidate-document path.
5. Store a document record containing owner, object path, original safe filename, MIME type, byte count, SHA-256 checksum, scan status, parse status, source, and deletion timestamp.
6. Issue short-lived signed URLs through a server-side authorization check. Record employer document views/downloads.
7. Define a data lifecycle: candidate replacement/versioning, user-requested deletion, account deletion, retention requirements, and failure recovery.
8. Add tests for candidate ownership, employer access only after applying/unlocking according to product policy, and complete denial of cross-candidate/cross-company file access.

### Acceptance criteria

- A malicious or unsupported file never reaches the resumé parsing path or an employer-visible location.
- Document access is traceable, scoped, and revocable.

## 5. API Architecture

### Description

The API architecture is the contract between UI, business logic, database, authentication, and external services.

### Repository finding

**Partially implemented.** JobsKart uses a healthy mix of TanStack server functions, Supabase RPCs, RLS-protected direct queries, and Edge Functions. The remaining need is consistent ownership: some business rules are still distributed between browser code and server/database code.

### Implementation plan

1. Create an API/domain map for Auth, Candidate Profile, Resume/Documents, Jobs, Applications, Employer Team, Candidate Search, Recommendations, Payments, Notifications, and Admin.
2. Decide the execution boundary for each operation:
   - Candidate-owned simple reads/writes: direct client access with RLS may be acceptable.
   - Cross-table, money, authorization-sensitive, AI, or external-provider workflows: server function or RPC only.
   - Long-running/background work: Edge Function or queued worker.
3. Standardize Zod validation, success payloads, error codes, and safe user-facing error mapping.
4. Use idempotency keys for payment fulfilment, invitation sends, document promotions, and recurring/background actions.
5. Add rate limits for unauthenticated and high-cost endpoints, including OTP requests, parsing, candidate search, and recommendation generation.
6. Add request/correlation IDs that flow through server functions, RPC logs, Edge Functions, and audit events.
7. Document the API contracts and deprecation process before exposing any external/public API.
8. Add integration tests for validation, authorization, idempotency, and expected error handling per domain.

## 6. Hyperlocal Hiring Infrastructure

### Description

Hyperlocal hiring means jobs and candidates can be matched by actual locality/distance and commute suitability, not just broad city names.

### Repository finding

**Not implemented.** Current matching deliberately uses exact city, preferred city, and same-state tiers. There are no latitude/longitude fields or geospatial extensions in the repository.

### Existing evidence

- `supabase/migrations/20260924052105_intelligent_candidate_ranking.sql` explicitly documents the city/state approximation and lack of coordinates.

### Implementation plan

1. Approve the product/privacy policy: permitted precision, candidate consent language, whether home location is optional, employer-visible precision, and deletion behavior.
2. Select a geocoding provider and create an address-normalization service for city, locality, pincode, state, and landmark inputs.
3. Enable PostGIS only after verifying environment support. Store geography points and source/precision/confidence metadata; do not overload free-text city fields as the source of truth.
4. Store job-site coordinates at an employer-approved location. Store candidates' preferred work areas or approximate location—not necessarily their exact residence.
5. Create GiST spatial indexes and use bounding-radius prefilters before exact distance calculations.
6. Add a geocoding queue/retry process for newly created or changed locations; preserve manual fallback and a `not_geocodable` state.
7. Return distance bands (for example “within 3 km”, “3–10 km”) to candidates rather than precise personal location information.
8. Add radius, locality, and commute filters to candidate search and candidate job discovery.
9. Test results for duplicate city names, rural addresses, missing coordinates, pan-India/remote jobs, and a user withdrawing location consent.

---

# Flow 2 — Candidate onboarding and AI profile flow

## 7. App Install

### Description

“App install” means an installable Progressive Web App (PWA) or native mobile application entry point with reliable mobile behavior and deep linking.

### Repository finding

**Not implemented in this repository.** No web manifest, service worker, PWA plugin, or native application project was found.

### Implementation plan

1. Choose the product target: PWA first, native Android/iOS first, or PWA followed by native packaging.
2. For a PWA, add a web app manifest, icons, install prompts, service worker, offline application shell, update prompts, and clear caching rules.
3. Do not cache sensitive/private API responses, signed document URLs, or authentication state in a service worker.
4. Ensure authentication callbacks, OTP deep links, application links, interview links, and notification links open the intended route after installation.
5. Add mobile-device QA for low bandwidth, interrupted uploads, resumed sessions, permission denial, and update rollout.
6. Track install prompt exposure, acceptance, launch frequency, and install-to-onboarding conversion.

## 8. OTP Login and Authentication

### Description

Candidates and employers use mobile number authentication to create or access an account.

### Repository finding

**UI implemented; production authentication gap.** The current UI describes OTP verification, but the code labels it demo mode, accepts any six digits, and server-mints a magic-link session rather than verifying a provider-issued SMS code.

### Existing evidence

- `src/routes/auth.tsx` — demo OTP messages and client verification path.
- `src/lib/auth-mobile.functions.ts` — server function accepts any six-digit code and creates/looks up accounts.

### Implementation plan

1. Decide whether Supabase Phone Auth or another SMS provider is the primary OTP service. Document country support, sender identity, rate/cost model, fallback provider, and production secrets.
2. Replace demo OTP creation with provider-backed OTP sending. Never create a session, account, or `mobile_verified` status merely because the UI submitted six digits.
3. Verify the OTP directly with the auth provider and establish the session only after successful verification.
4. Add server-side throttles by phone number, IP, device fingerprint/anonymous device token, and account state. Add resend cooldown, maximum attempts, temporary lockouts, and CAPTCHA/anti-bot protection.
5. Protect against account enumeration: use neutral messages for unknown/known phone numbers where appropriate.
6. Define account linking rules for a user who changes phone, has a legacy synthetic email, or tries to use the same phone for candidate and employer roles.
7. Add monitoring for delivery failures, resend rate, verification success, unusual volume, provider errors, and cost spikes.
8. Build integration/E2E tests using provider test numbers and ensure real OTP failure rejects the session.

### Acceptance criteria

- A random six-digit number cannot authenticate a user.
- Repeated OTP abuse is rate-limited without blocking legitimate retry/recovery paths.

## 9. Resume Upload

### Description

The candidate uploads a resumé so it can populate their profile and be used in an application.

### Repository finding

**Implemented.** File validation, upload, storage persistence, replacement, and manual fallback are present.

### Implementation plan

This item is functionally available. Apply the Cloud Resume Storage hardening plan before scaling it: quarantine, scan, authoritative document records, signed URL authorization, and lifecycle controls. Then add upload progress, safe retry, version history, and visible scan/parse status.

## 10. AI Resume Parsing

### Description

AI resume parsing extracts structured candidate details from PDF, DOCX, and image resumes, allowing a candidate to review and edit suggested profile fields.

### Repository finding

**Implemented as best effort.** The parser extracts text/uses visual parsing where appropriate, calls the configured AI gateway, validates output with Zod, and makes parsing non-blocking for upload success.

### Existing evidence

- `src/lib/resume.functions.ts` — extraction, model call, structured output validation, and safe error mapping.
- `src/components/candidate/ResumeUpload.tsx` — upload-first, parse-second UX.

### Implementation plan

1. Add a `resume_parse_jobs` record with document ID, input checksum, state (`queued`, `processing`, `succeeded`, `failed`, `needs_review`), attempt count, model/version, cost/usage, timings, and safe failure category.
2. Run parsing asynchronously after a clean file is promoted from quarantine; do not keep a browser request open for a long-running parse.
3. Define a strict JSON schema per output field and a confidence score/source span for name, city, experience, education, skills, and contact details.
4. Show a review screen that compares extracted and current data. Candidates must explicitly approve sensitive contact, salary, or profile changes.
5. Redact content from ordinary logs and define retention for source text and model prompts.
6. Add cost controls: document-size limits, deduplication by checksum, maximum retry count, provider timeout, and fallback model/manual path.
7. Track parse success rate, median latency, per-field acceptance/correction rate, and error distribution.

## 11. AI Skill Extraction

### Description

Skill extraction identifies skills in a resume and makes them useful for profile display, search, and matching.

### Repository finding

**Implemented in raw form.** The resume parser returns an editable string array of skills. Matching currently uses case/whitespace-normalized exact string comparisons.

### Implementation plan

1. Establish `skills_master` as the canonical vocabulary and add a controlled synonym/alias mapping (for example “MS Office” → “Microsoft Office”).
2. Store canonical skill IDs in a join table or an equivalent normalized representation while retaining the user-entered display text where useful.
3. Add AI extraction confidence and a candidate-confirmation mechanism; do not add questionable skills invisibly.
4. Allow a candidate to mark a skill as primary, working knowledge, or remove it.
5. Update matching/search to compare canonical IDs and approved synonym groups instead of raw text.
6. Add an admin workflow for new skills, duplicate merges, aliases, and deprecations.
7. Test synonym matching, ambiguous skills, multilingual terms, and skill removal propagation.

## 12. Profile Completion

### Description

Profile completion guides a candidate to supply enough accurate information for job discovery and employer trust.

### Repository finding

**Implemented.** Onboarding saves profile data, calculates `profile_strength`, and candidate screens identify missing items.

### Existing evidence

- `src/lib/profileStrength.ts` — completion calculation and missing-item suggestions.
- `src/routes/_authenticated/onboarding/candidate.tsx` — candidate onboarding persistence.
- `src/routes/_authenticated/candidate/dashboard.tsx` — profile completion prompts.

### Implementation plan

1. Separate “completion” from “trust” in both data and UI. A fully populated profile is not automatically a verified or reliable profile.
2. Write a versioned completion rubric for fresher, experienced candidate, student, and return-to-work flows.
3. Recalculate completion on the server/database after profile changes; use client calculation only for immediate preview.
4. Preserve draft progress at each step and let candidates skip nonessential fields without being trapped in onboarding.
5. Prioritize the next best action, for example “add three skills” or “confirm preferred city,” rather than a generic percentage alone.
6. Instrument per-step completion, abandonment, time-to-complete, and resulting application conversion.

## 13. Candidate Trust Score

### Description

A trust score should communicate validated reliability signals to candidates and employers without turning profile completeness or sensitive attributes into a hidden judgment.

### Repository finding

**Partially implemented.** The application includes mobile verification, KYC status, candidate documents, profile strength, and profile views, but there is no unified trust-score calculation, stored breakdown, or employer-facing explanation.

### Implementation plan

1. Establish governance before scoring: intended use, prohibited uses, user disclosure, appeal/review process, retention, and bias review.
2. Keep two scores:
   - **Profile completeness:** candidate-controlled information quality.
   - **Trust status/score:** verified phone/KYC/document and behavioral reliability signals.
3. Use only defensible signals: successful phone verification, reviewed identity checks, verified work/education where offered, application/interview reliability, and confirmed abuse/dispute outcomes.
4. Exclude protected characteristics and avoid using location, age, gender, name, inferred socioeconomic status, or opaque model outputs as trust inputs.
5. Store a versioned breakdown with reason codes, source events, expiration/review dates, and manual-review overrides.
6. Show candidates actionable improvement steps and show employers only the minimum useful band/status plus plain-language reasons.
7. Add auditing and monitoring for score distribution, missing-data effects, disparate impact, appeals, and manual override use.

---

# Flow 3 — AI job matching and recommendations

## 14. Candidate Preferences

### Description

Candidate preferences specify what work the candidate wants: role, city, work mode, job type, pay, and experience fit.

### Repository finding

**Implemented.** Candidate onboarding/profile persist preferred cities, job types, work mode, salary expectation, skills, and experience details.

### Implementation plan

1. Normalize stored preferences to master IDs where practical; preserve display labels separately.
2. Add optional preference fields required for stronger recommendations: target role/title, industries, shift, language, availability date, minimum salary and salary period, relocation openness, commute radius, and preferred locality.
3. Mark each preference as explicit candidate input, AI suggestion, or inferred signal. Explicit input should win unless the candidate confirms a change.
4. Add preference freshness timestamps and prompt candidates to review stale preferences.
5. Make every preference independently editable from profile/settings without rerunning full onboarding.

## 15. AI Matching Criteria

### Description

Matching criteria create a score that reflects how well a candidate and job fit each other, with transparent reasons.

### Repository finding

**Partially implemented as deterministic ranking.** `compute_candidate_match()` evaluates skills, city/state fit, experience, salary, recent activity, application intent, and a city-based proximity bonus. It is shared by employer candidate search/recommendations.

### Existing evidence

- `supabase/migrations/20260924052105_intelligent_candidate_ranking.sql` — current matching formula and documented limitations.
- `supabase/migrations/20260928130001_job_candidate_recommendations.sql` — employer-side recommended candidates using the shared score.

### Implementation plan

1. Retain a deterministic baseline and make it the source of truth until outcome data justifies learned ranking.
2. Define hard eligibility filters separately: job active/within expiry, candidate eligibility, required licenses/assets, mandatory location/work mode, and application exclusion.
3. Define soft-score components with approved weights: canonical skills, title/role family, experience, pay compatibility, work mode, city/distance, candidate preferences, freshness, and verified trust signals where appropriate.
4. Produce an explanation payload with matched skills, missing requirements, location/distance band, salary fit, and reasons a score is capped.
5. Version the formula and save version/feature values with recommendation impressions so performance can be analyzed later.
6. Add fairness and quality checks: no protected characteristics in scoring, no unexplained hard rejection from incomplete data, and minimum diversity/novelty in feed results.
7. Only after sufficient event data exists, evaluate a learned re-ranker against the deterministic baseline with offline and controlled online tests.

## 16. Geo-tagging Based Matching

### Description

Geo-tagging lets the matching engine evaluate nearby jobs and candidates using coordinates rather than only city names.

### Repository finding

**Not implemented.** Current “nearby” semantics are city/preferred-city based.

### Implementation plan

Implement this together with Hyperlocal Hiring Infrastructure:

1. Capture consented, normalized locations.
2. Geocode to controlled precision and store source/confidence.
3. Use PostGIS geography types and GiST indexes.
4. Use spatial prefilters followed by exact calculation.
5. Add remote/pan-India exceptions and missing-location fallbacks.
6. Return distance bands, not a candidate's exact address.

## 17. Distance Ranking

### Description

Distance ranking orders eligible nearby opportunities based on travel distance or commute time.

### Repository finding

**Not implemented.** The existing proximity bonus is based on city/preferred-city/state, not kilometers or travel time.

### Implementation plan

1. Start with straight-line distance calculated from privacy-preserving geography points.
2. Define bands that match hiring behavior, such as `<3 km`, `3–10 km`, `10–25 km`, `25–50 km`, and beyond radius.
3. Let candidates set a default radius and override it per search.
4. Score distance after hard eligibility and core skills/role fit; distance should not cause a weakly matched job to outrank a strongly matched job solely because it is closer.
5. Add commute-time support only after validating provider cost, latency, transport coverage, and consent needs.
6. Test same coordinate, missing coordinate, remote, pan-India, rural, and boundary-radius cases.

## 18. AI Recommendation Engine

### Description

The recommendation engine should identify jobs relevant to the currently signed-in candidate, not simply rank attractive/boosted jobs globally.

### Repository finding

**Employer-side implementation exists; candidate-side implementation is missing.** Employers can receive ranked candidate recommendations through `get_recommended_candidates_for_job()`. Candidate dashboard and `/jobs` call `feed_jobs_for_candidate()`; this safely excludes applied jobs but calculates ranking using job boost, freshness, quality, and trending signals rather than candidate-specific matching.

### Existing evidence

- `supabase/migrations/20260928130001_job_candidate_recommendations.sql` — implemented employer-side candidate recommendation RPC and invitation/dismissal actions.
- `supabase/migrations/20260928061220_trending_ranking_bonus.sql` — candidate feed ranking formula.
- `src/lib/job-feed.ts` and `src/routes/_authenticated/candidate/dashboard.tsx` — candidate feed integration.

### Implementation plan

1. Define the candidate recommendation contract: input identity from `auth.uid()`, filters, pagination/cursor, explanation payload, score/version, and no client-supplied candidate ID.
2. Create a dedicated `recommend_jobs_for_candidate()` RPC/service. Do not overload the generic boosted `feed_jobs_for_candidate()` behavior.
3. Apply eligibility filtering before scoring:
   - active and unexpired job;
   - candidate has not applied, withdrawn, hidden, or blocked it;
   - candidate meets mandatory conditions;
   - candidate preference/availability constraints where configured.
4. Calculate a candidate-job score using the approved deterministic matching contract. Blend business signals only as bounded secondary factors:
   - skills/role family;
   - experience;
   - work mode;
   - location/distance;
   - salary compatibility;
   - job quality/freshness;
   - controlled boost weight.
5. Diversify the first page to prevent repeated employers, duplicate titles, or one category from dominating all slots.
6. Add recommendation impression, open, save, apply, hide, and error events. Associate each event with recommendation version and rank.
7. Update candidate dashboard and `/jobs?sort=recommended` to call the new service. Keep explicit newest/oldest/salary sorts separate and predictable.
8. Add a safe fallback for cold-start candidates: profile-completion prompts plus quality/freshness/location-filtered jobs, clearly labelled as “Popular near you” rather than personalised recommendations.
9. Add tests for candidate isolation, applied-job exclusion before pagination, preference relevance, remote/pan-India behavior, and repeat-result control.

### Acceptance criteria

- Two candidates with substantially different skills/preferences receive measurably different Recommended results.
- A candidate never receives a job they already applied to on the recommendation feed.
- Each recommended card can explain at least one meaningful reason for appearing.

## 19. Urgent + High Salary Jobs

### Description

This feature identifies time-sensitive openings that pay unusually well for the role, experience range, location, and salary period.

### Repository finding

**Not implemented as a product feature.** Salary filtering/sorting and some salary benchmarks exist, but there is no explicit urgency field/workflow or a combined “urgent and high salary” ranking rule.

### Implementation plan

1. Add a controlled urgency model: `urgent_until`, urgency reason, set-by actor, review status, and automatic expiry. Do not allow permanent uncontrolled urgency.
2. Restrict who may mark a job urgent and require an auditable business reason; add abuse monitoring and admin revocation.
3. Normalize salary to a comparable monthly/annual basis before determining “high salary.” Take pay type, incentives, city, role family, and experience into account.
4. Use existing salary-benchmark capability as a starting point, then store the benchmark version used for each classification.
5. Return separate flags/badges for `urgent`, `high_salary`, and `urgent_high_salary`; do not hide why a job is promoted.
6. Add a dedicated candidate feed section/filter with a capped ranking boost so urgency cannot overwhelm relevance.
7. Measure application speed, expiry conversion, employer misuse, candidate hides, and post-hire quality.

## 20. AI Personalized Feed

### Description

The personalised feed is the candidate home discovery experience. It learns from explicit preferences and consented behavioral feedback while maintaining relevance, diversity, transparency, and control.

### Repository finding

**Not implemented as a true personalised feed.** The current feed is a candidate-aware discovery feed with applied-job exclusion, but its recommended sorting is generic job ranking.

### Implementation plan

1. Deliver the candidate recommendation engine first; a feed should consume that result rather than duplicate ranking logic in the UI.
2. Add candidate controls: “not interested,” reason selection, hide employer, save, change preference, and undo. Explicit negative feedback must suppress or down-rank future results promptly.
3. Capture privacy-safe behavioral events: impression, view, dwell bucket, save, apply, share, hide, and alert opt-in. Do not collect unnecessary sensitive data.
4. Blend signals in layers:
   - explicit preferences and eligibility;
   - deterministic relevance score;
   - freshness/quality and bounded boost;
   - behavioral personalization only after enough candidate-specific events exist;
   - diversity/repetition constraints.
5. Provide card-level explanation labels such as “Matches your skills,” “Within your preferred area,” “Matches your salary preference,” or “Newly posted.”
6. Add a cold-start policy and an exploration budget so new categories can be tested without flooding the feed with irrelevant jobs.
7. Build monitoring dashboards for feed latency, zero-result rate, repeat rate, hide rate, application conversion, employer concentration, category concentration, and score distribution.
8. Run A/B tests only after establishing a stable deterministic baseline and event instrumentation. Guard against revenue/boost changes masking relevance regressions.

---

# Recommended delivery sequence

## Phase 0 — Decisions and safety baseline

1. Approve the product definitions for trust, urgency, personalised ranking, location precision, and paid boost boundaries.
2. Confirm which migrations/functions are actually deployed in each environment.
3. Replace demo OTP before public-scale launch.
4. Audit RLS, function grants, Storage bucket policies, and current admin/company authorization tests.

## Phase 1 — Data foundations

1. Canonical skills and aliases.
2. Normalized candidate preferences and preference freshness.
3. Event taxonomy and analytics pipeline.
4. Resume/document hardening and asynchronous parse-job state.
5. Location privacy policy and geocoding/PostGIS technical design.

## Phase 2 — Correct matching and recommendations

1. Formalize candidate-job eligibility and explainable deterministic scoring.
2. Build `recommend_jobs_for_candidate()`.
3. Replace the candidate “Recommended” feed while retaining generic explicit sort modes.
4. Add candidate feedback controls and recommendation telemetry.
5. Add employer/candidate recommendation quality monitoring.

## Phase 3 — Hyperlocal and marketplace enhancements

1. Geocode jobs and candidate preferred areas.
2. Add radius filters and distance bands.
3. Add distance-aware ranking.
4. Add governed urgency and salary-benchmark promotion.
5. Add diversification and cold-start logic.

## Phase 4 — Scale and optimization

1. Build advanced analytics and operational queues.
2. Add daily rollups, indexes, query-plan review, and recommendation latency monitoring.
3. Evaluate learned re-ranking only after deterministic matching has sufficient outcome data and fairness review.
4. Consider PWA/native application delivery once OTP, uploads, deep links, and notification behavior are production-ready.

# Cross-cutting verification checklist

Before each feature release, verify:

- Database migration is reviewed, applied in non-production, and listed in target migration history.
- New exposed tables have RLS enabled and minimal grants.
- Every `SECURITY DEFINER` function has authorization checks, restricted `search_path`, and explicit execution grants.
- `UPDATE` policies have both `USING` and `WITH CHECK` conditions where ownership must remain unchanged.
- The browser never contains Supabase `service_role` credentials or provider secrets.
- Storage uploads have owner-scoped paths and replacement/upsert permissions cover insert, select, and update correctly.
- Candidate, employer, admin, and unauthenticated negative tests pass.
- Recommendation/matching changes have deterministic fixtures and assertions for score explanations, eligibility, pagination, and data isolation.
- Metrics, error alerts, and an operational rollback plan exist before rollout.

# Priority backlog

| Priority | Work item | Reason |
|---|---|---|
| P0 | Replace demo OTP with real provider verification | Current flow accepts arbitrary six-digit values. |
| P0 | Verify deployed migration/function/bucket state | Repository presence alone does not prove production availability. |
| P0 | Build candidate-specific recommendation service | Current “Recommended for you” ranking is not candidate-personalised. |
| P1 | Resume/document quarantine and scanning | Candidate documents are sensitive and untrusted uploads. |
| P1 | RBAC matrix plus automated authorization tests | Platform roles are currently only super-admin; authorization must scale safely. |
| P1 | Event taxonomy and recommendation analytics | Needed to measure conversion, quality, and regressions. |
| P2 | Canonical skills and aliases | Required for robust matching beyond exact text. |
| P2 | Hyperlocal/geospatial foundation | Enables real nearby and distance ranking. |
| P2 | Candidate trust model | Needs governance, transparent signals, and auditability. |
| P3 | Urgent/high-salary feature | Depends on governed urgency and salary normalization. |
| P3 | PWA/native install experience | Valuable, but must follow stable auth/upload/deep-link flows. |


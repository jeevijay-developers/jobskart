# Candidate Onboarding: Resume/LinkedIn Import, Salary Selection, and Smart Education Flow

## Purpose and scope

This plan covers the three requested candidate-onboarding improvements:

1. **Resume and/or LinkedIn import** — reduce manual profile entry by extracting candidate data and presenting it for review.
2. **Salary selection** — make expected-salary entry quick, clear, monthly, and relevant to the candidate's intended role and location.
3. **Smart education flow** — collect only the education information needed to start matching, then progressively request details when they are useful.

This is a design and implementation plan only. It intentionally makes no source-code or database changes.

## Product principles

- **Candidate remains in control.** Imported or AI-extracted values are proposed changes, never silently overwrite profile data.
- **Fast path first.** A candidate should reach a useful job feed after supplying only data needed for basic matching.
- **No LinkedIn scraping.** Do not ask for a LinkedIn password, scrape a public profile URL, or use browser automation to copy profile data.
- **Transparent recommendations.** Salary suggestions must say that they are market ranges, identify their scope/confidence, and allow a custom amount or “prefer not to say.”
- **AI is an assistant, not the source of truth.** Use structured validation, deterministic rules, source provenance, and human review around model output.

---

## Current JobsKart assessment

| Requested capability | Current state | Evidence in the repository | Required work |
| --- | --- | --- | --- |
| Resume upload during onboarding | **Implemented** | `ResumeUpload` is embedded in `src/routes/_authenticated/onboarding/candidate.tsx`; the shared parser is in `src/lib/resume.functions.ts`. | Improve source selection, import review/merge UX, document classification feedback, retries, and metrics. |
| AI extraction of education and experience | **Partially implemented** | Resume parsing returns structured experience and education. The profile resume review can save them to `candidate_experiences` and `candidate_education`. Onboarding currently uses only selected fields. | Make the onboarding review explicitly merge all proposed fields, retain provenance, and protect existing values from accidental overwrite. |
| LinkedIn profile import | **Not implemented** | No LinkedIn integration/configuration was found. | Build export-based import first; enable OAuth only after LinkedIn confirms approved access to the exact profile data required. |
| Monthly expected salary | **Implemented as a raw number** | `candidate_profiles.expected_salary` exists and career/profile UI uses a numeric monthly amount. | Add ranges/chips, deterministic role/location suggestion, a clear opt-out, and candidate telemetry. |
| Role-based salary suggestions | **Partially implemented, employer-facing** | `salary_bands`, `get_salary_suggestion()` and employer `SalarySuggestionCard` already provide an auditable title/city fallback ladder. | Reuse this trusted data source in a candidate-safe read endpoint and UI; do not duplicate or invent salary estimates in the browser. |
| Collect education lightly, complete it later | **Substantially implemented** | Onboarding asks only for highest qualification and says full school/college details can be added later; profile has an Education manager. | Formalize the progressive-profiling state, trigger timing, eligibility checks, notification limits, and measurement. |

### Important implementation consequence

The recommended delivery is **not** three independent feature builds. It is one onboarding data-capture system with three input paths (manual, resume, LinkedIn export), one review-and-merge stage, and progressive profile tasks. This reduces duplication and prevents contradictory candidate records.

---

## How established job products approach this

### Resume and profile import

Professional job products generally let candidates upload a resume and then review information before it is used. LinkedIn supports resume upload for job applications, while LinkedIn members can request a download of their own account data from Settings & Privacy. The latter is a legitimate candidate-controlled route for a JobsKart import fallback. [LinkedIn: upload a resume](https://www.linkedin.com/help/linkedin/answer/a510363/upload-your-resume-to-linkedin?lang=en), [LinkedIn: download your data](https://www.linkedin.com/help/linkedin/answer/a1339364?lang=en)

The best JobsKart version is therefore:

- offer **Upload resume** first;
- also offer **Import LinkedIn data export or LinkedIn-generated resume PDF**;
- parse either source into the same draft model;
- show a short confirmation screen; and
- preserve manual entry for candidates whose documents are incomplete or non-resume documents.

### Salary guidance

Salary tools typically provide a contextual range from title, experience and location rather than a single “AI salary.” For example, Indeed’s salary calculator asks for role-related details and compares them with a salary database; it frames the result as a personalized range to support job search and negotiation. [Indeed Salary Calculator](https://www.indeed.com/job-search-services/salary-calculator-ntgy4)

JobsKart should follow that pattern: a range with context and confidence, then let the candidate choose a preference. It must keep job-posted salary distinct from a platform estimate.

### Progressive profiling

The common low-friction pattern is to collect only fields that unlock the next benefit, show the value immediately (better feed, more matches, ability to apply), and request optional detail later. JobsKart already has the foundation: highest qualification in onboarding and a full education editor in profile. The missing part is a deliberate lifecycle and nudge policy.

---

## Feature 3 — Resume and/or LinkedIn Import

### What the feature means

Candidates can provide a resume or a candidate-owned LinkedIn export during onboarding. JobsKart extracts structured contact, headline, skills, experience, and education data; the candidate confirms which fields to save. The goal is less typing and higher onboarding completion without trusting arbitrary files or silently changing data.

### Recommended product decision

Launch in two layers.

1. **MVP: resume plus LinkedIn-export import.** Support standard resume formats and a LinkedIn-generated resume PDF / selected CSV files from a candidate’s LinkedIn data download. This works without privileged LinkedIn API access.
2. **Later: direct LinkedIn OAuth, only if approved.** Standard “Sign in with LinkedIn” OpenID Connect provides identity-oriented userinfo, not a guaranteed complete resume (work history, education, skills). LinkedIn access and scopes must be confirmed through its developer/partner process before promising full-profile import. [LinkedIn OpenID Connect documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)

Do **not** use a pasted LinkedIn URL as an import mechanism. It can be saved as an optional link, but it must not trigger automated scraping.

### Candidate flow

```text
OTP/authentication
  -> “Build profile faster” (Upload resume | Import LinkedIn export | Enter manually | Skip)
  -> file validation and private upload
  -> extraction / normalization job
  -> review changes grouped by Personal, Experience, Education, Skills
  -> candidate selects values to apply and resolves conflicts
  -> save approved records + provenance + original file metadata
  -> continue concise onboarding
```

### UX requirements

- State accepted types and size limits before upload. Keep the current safe allowlist; show a human-friendly error for scanned images, passwords, empty files, and unsupported documents.
- Ask the candidate whether the document is a **resume**, **LinkedIn PDF/export**, or **other career document**. Auto-detection may suggest a type but must not block a manual override.
- Display parsing progress, retry, and “continue manually” paths. Never make onboarding wait indefinitely on an AI call.
- In the review screen, label each value with its source: `Resume`, `LinkedIn export`, or `Existing profile`.
- For every conflict, default to retaining existing candidate-entered data; require an explicit choice to replace it.
- Allow editing before save and allow “save only skills,” “save only experience,” etc.
- Do not expose uploaded files to employers by default. Existing candidate document consent/access rules must remain the controlling policy.

### Parsing, normalization, and confidence design

1. Upload to the existing private candidate document storage path.
2. Create an import record with source, checksum, MIME type, size, status, timestamps, and parser version.
3. Extract text locally/server-side for PDF/DOCX where possible; OCR image-only documents only after clear notice.
4. Run the existing resume pre-gate and parser through the existing server-side AI adapter.
5. Validate the result against the existing controlled values (qualification levels, cities, job types) and normalize dates, titles, skill capitalization, and salary units.
6. Store the raw model response only for a short, defined troubleshooting period; store validated proposed fields separately.
7. Calculate per-field confidence from extraction evidence, not from an unsupported model “confidence” number. For example: email/phone pattern valid; date range parseable; qualification maps to approved level.
8. Show low-confidence values as “Please check,” never auto-select them.
9. Apply approved changes transactionally; record source and import id at field/row level where practical.

### LinkedIn export input formats

Implement in this order:

| Priority | Input | Handling |
| --- | --- | --- |
| 1 | LinkedIn-generated PDF/resume PDF | Use the existing document extraction pipeline. |
| 2 | Candidate-selected CSV files from LinkedIn data download (positions, education, skills where available) | Parse only documented, selected files; present the files to be imported before processing. |
| 3 | ZIP archive containing the above | Add after secure archive inspection: reject path traversal, cap compressed/uncompressed size and file count, then accept only expected CSV/PDF files. |
| 4 | Direct OAuth profile import | Enable only after approved LinkedIn product/scopes can return the fields JobsKart needs. |

For privacy, explicitly explain that a large LinkedIn archive may contain unrelated personal data. Prefer selected files rather than asking users to upload their entire archive.

### Suggested data additions

The implementation migration should use additive tables/columns and RLS, rather than changing existing candidate records blindly.

- `candidate_imports`: `id`, `candidate_id`, `source` (`resume`, `linkedin_pdf`, `linkedin_export`, `linkedin_oauth`), storage reference, file metadata, checksum, status, error code, parser/version, consent timestamp, created/expired timestamps.
- `candidate_import_proposals`: `import_id`, field/path, normalized value JSON, evidence/excerpt reference, validation status, confidence band, selected/applied timestamps.
- Optional source metadata on `candidate_experiences` and `candidate_education`: `source_import_id`, `source_kind`, `verified_by_candidate_at`. Do not store raw resume content in general profile fields.
- A retention job that removes raw import artifacts/proposals on the documented schedule while preserving minimal audit metadata.

All tables require owner-only RLS for candidates, service-role-only parser writes, and no employer visibility unless the candidate separately shares a document.

### Delivery work breakdown

1. Map parser output to a canonical draft schema shared by onboarding and the profile resume dialog.
2. Build import state/status APIs through authenticated server functions; keep provider credentials and parsing calls off the client.
3. Extend `ResumeUpload` into a source-picker and import-status component without removing the current resume path.
4. Build the review/merge screen and conflict-resolution rules.
5. Add PDF and selected-CSV LinkedIn-export adapters; test malformed/empty/large archives before ZIP support.
6. Add audit, retention, error taxonomy, metrics, and candidate delete/revoke behavior.
7. Pilot with real, consented CVs across PDF/DOCX/scanned image/LinkedIn export formats; measure extraction and completion rates before expanding OAuth.

### Acceptance criteria

- A candidate can finish onboarding if upload/parsing fails.
- No parsed field updates an existing profile value without a visible candidate decision.
- Resume and LinkedIn-export imports create the same canonical review experience.
- Candidate can delete an import and its raw artifact according to the product’s retention policy.
- Tests cover authorization, invalid files, duplicate upload/idempotency, parser malformed output, partial saves, and conflicting profile data.

---

## Feature 4 — Salary Selection

### What the feature means

Candidates choose an **expected monthly salary** through clear range chips, get a role/location/experience-aware market range when JobsKart has sufficient data, and can set a custom monthly amount or decline to disclose it. This value improves matching but should never become an undisclosed hard rejection criterion.

### Recommended candidate UX

1. After role, city, and experience status are known, show “What monthly salary are you looking for?”
2. Request a recommendation from the existing salary-band engine using intended role, category, city, experience bucket, and fixed-pay context.
3. If a credible band exists, display: `Typical range for [role] in [city]: ₹X–₹Y/month`, plus a scope/confidence explanation.
4. Show five accessible chips derived from the returned range: below lower range, lower-middle, around median, upper-middle, above upper range. Never hard-code city-independent amounts as the primary recommendation.
5. Include `Enter exact amount`, `I am flexible`, and `Prefer not to say`.
6. Confirm the chosen amount as a monthly figure and allow editing in Career preferences later.

### Data and rule design

- Continue using `candidate_profiles.expected_salary` as the canonical numeric expected monthly amount for compatibility with applications and ranking.
- Add explicit context fields if needed: `expected_salary_period` (initially fixed to `monthly`), `expected_salary_choice_kind` (`chip`, `custom`, `flexible`, `undisclosed`), selected band/suggestion id, and updated-at timestamp.
- Reuse `salary_bands` and `get_salary_suggestion()` rather than creating a separate AI estimate. The existing function has a useful fallback ladder (city, state, national, category) and deliberately returns no result when data is insufficient.
- Introduce a candidate-safe read function/wrapper that derives experience bucket and returns only display-safe values. It must not reveal private employer or candidate records.
- Treat suggestions as advice, not validation. A candidate may select any positive custom amount.
- Preserve salary privacy: do not expose current salary to employers unless the candidate separately consents; the existing application field remains expected salary.

### What role-based suggestion should use

| Signal | Source | Use |
| --- | --- | --- |
| Target role/title | onboarding role / `interested_roles` / last role | normalize to salary-band title key |
| Category | selected role/category | fallback if exact title lacks data |
| City/state | candidate preference | localize market range |
| Experience | experience status and years | choose experience bucket |
| Job nature | fixed versus incentive/commission | prevent comparing incompatible pay |
| Data freshness/sample size | `salary_bands` metadata | label confidence or suppress suggestion |

### Delivery work breakdown

1. Define the candidate salary contract, including flexible/undisclosed behavior and recruiter/ranking visibility rules.
2. Add an authenticated, read-only candidate suggestion function based on the existing engine and ensure RLS/security-definer review.
3. Build mobile-friendly, keyboard-accessible chips plus exact-number entry and a monthly-unit label.
4. Add onboarding and profile editor integration; preserve the existing raw value during migration.
5. Add analytics: suggestion shown, chip chosen, custom entry, flexible/undisclosed, save, later edit, and job-match impact.
6. Validate bands for city/title/experience edge cases and test no-data behavior before release.

### Acceptance criteria

- Salary selection never blocks onboarding.
- Every suggested number is explicitly monthly, contextual, and traceable to a current salary band.
- No-data locations/titles show neutral generic chips or custom entry—not a fabricated AI estimate.
- Existing expected-salary application and matching code continues to receive a numeric value only when the candidate actually chooses one.

---

## Feature 5 — Smart Education Flow

### What the feature means

Smart education flow minimizes initial onboarding effort. It asks for the highest qualification early only when it materially improves matching, then requests detailed education data later at helpful moments. The candidate can skip non-critical detail and is shown why it helps.

### Recommended critical-data policy

**Collect during initial onboarding:** highest qualification (when candidate is willing), plus only role/city/experience/skills data needed for the first job feed. Keep college, board/university, year, marks, certificates, and multiple education records optional.

**Ask detailed education later when one of these occurs:**

- Candidate opens a job that requires a qualification not yet recorded.
- Candidate tries to apply to a job where qualification evidence/education details are relevant.
- Candidate has viewed/saved a defined number of jobs but their profile remains incomplete.
- Candidate returns after a time delay and has not dismissed the prompt recently.
- Candidate opens Profile or Profile Strength and sees the direct benefit.

**Do not interrupt:** while OTP is in progress, during resume import review, immediately after an error, or more often than the configured prompt cap.

### Proposed experience

```text
Initial onboarding
  -> “What is your highest qualification?” (chips; Skip for now)
  -> first personalized jobs and profile completion indicator

Later, contextual prompt
  -> “Add college and passing year to improve matches for [job/role]”
  -> short form with Save / Not now
  -> full Education manager only when candidate chooses it
```

Resume import should pre-fill this flow: show extracted education records in the same review screen and let candidates save one, several, or none. A parser result must never make education mandatory.

### State and data model

Use an explicit task/nudge model rather than inferring every decision from null fields:

- `candidate_profile_tasks`: candidate id, task key (`education_highest`, `education_details`), status (`not_started`, `dismissed`, `completed`, `snoozed`), last shown, snoozed until, completion source, timestamps.
- `candidate_profile_events`: event key, candidate id, context/job id where applicable, timestamp, metadata subject to privacy policy.
- Optional `candidate_education` completeness fields/rules calculated from existing rows instead of a second source of truth.

The task evaluator should run after relevant candidate events and return at most one non-blocking prompt. It should use server-side eligibility rules; the browser should only render the decision.

### Nudge and frequency policy

- First reminder only after the candidate has received value (for example, first matched feed or saved job).
- “Not now” snoozes a task for a defined period; do not treat it as missing data on every page load.
- Cap prompts (for example, one education prompt per session and a small weekly maximum); confirm final values with product/UX.
- Stop prompts once highest qualification and the minimum required detail for the candidate’s target jobs are present.
- Keep every prompt dismissible and accessible; do not prevent job browsing merely because education is incomplete.

### Delivery work breakdown

1. Confirm which education fields are truly required for matching, application, KYC, and legal/compliance purposes by job category.
2. Define the task states, event triggers, snooze duration, prompt limits, and success metrics with product and recruitment operations.
3. Add task/event tables, owner-only RLS, and an idempotent server-side evaluator.
4. Convert the current education onboarding UI into an explicitly skippable highest-qualification task while retaining the profile Education manager.
5. Add contextual prompts in feed/job detail/application/profile-strength surfaces.
6. Connect resume/LinkedIn imported education proposals to the existing full Education manager.
7. Instrument funnel and A/B-test prompt timing; tune only after checking match quality and candidate complaints.

### Acceptance criteria

- A candidate can browse and receive a personalized feed with no detailed education record.
- Highest qualification is enough for initial matching where permitted by the target role.
- A job-specific prompt clearly tells the candidate why the extra education data matters.
- Dismissed/snoozed prompts honor frequency limits across devices/sessions.
- Detailed education saved through manual or import flow appears consistently in profile, application context, and employer-permitted views.

---

## Shared architecture, security, and quality controls

### Service boundaries

| Responsibility | Recommended boundary |
| --- | --- |
| Upload, file metadata, candidate consent | authenticated server function + Supabase Storage/private bucket |
| Text extraction, OCR, AI parsing | server-only worker/function; never expose AI provider key to browser |
| Import draft/review | candidate-owned database records protected by RLS |
| Apply profile changes | transactional server function with candidate ownership check |
| Salary suggestions | authenticated read-only database function/wrapper over existing salary bands |
| Progressive task evaluation | server-side rule evaluator invoked by authenticated candidate events |

### Security and privacy requirements

- Validate content type, extension, magic bytes where feasible, file size, text/OCR limits, and archive expansion limits.
- Scan uploads for malware before marking them usable; quarantine rejected files.
- Store documents in private storage with signed URLs of short duration; log access without logging document text.
- Make consent clear: what is read, what fields will be proposed, who can see the uploaded file, and how to delete it.
- Keep AI provider prompts free of unnecessary account data; redact/mask data in application logs.
- Add rate limits, idempotency keys, timeout/retry behavior, and per-user quotas around expensive parsing.
- Run RLS, Storage policy, and SECURITY DEFINER function reviews before deployment.
- Add model-output safeguards: strict JSON schema validation, length limits, enum mapping, and prompt-injection-resistant treatment of document text as untrusted content.

### Observability and success measures

Track only privacy-appropriate, aggregate product events:

- import start/upload/parse/review/save/failure, source type, duration, retry, and manual fallback;
- extraction acceptance rate by field type and document format;
- onboarding completion and time-to-first-feed by import path;
- salary suggestion availability, chosen mode, later changes, and match/application outcomes;
- education prompt display/dismiss/snooze/complete rates, time-to-completion, and application quality;
- error rate, model cost/latency, file rejections, and consent/deletion requests.

Define success before rollout: increased completed onboarding and verified profile completeness, without reduced completion from parsing failures, privacy complaints, or degraded job-match quality.

---

## Phased implementation plan

### Phase 0 — Decisions and design validation

- Confirm candidate eligibility, consent copy, retention periods, and whether imported data can be shown to employers.
- Decide exact monthly salary range/chip policy and what “flexible” means for matching.
- Define the minimum education required per job category.
- Confirm LinkedIn strategy: export-based MVP first; direct OAuth only after legal/product approval of scopes and LinkedIn access.
- Produce wireframes and analytics event dictionary.

### Phase 1 — Harden and reuse existing capabilities

- Test the existing upload/parser flow against varied genuine resumes and failures.
- Create canonical import-draft and review/merge contracts.
- Reuse existing private resume storage, AI adapter, `candidate_experiences`, `candidate_education`, `candidate_profiles`, and salary-band lookup.
- Implement source provenance, parsing status, retries, and deletion/retention behavior.

### Phase 2 — Candidate onboarding improvements

- Ship source-picker/import review for resume and LinkedIn PDF.
- Ship monthly salary chips/custom/flexible/undisclosed candidate UI backed by salary bands.
- Make highest-qualification selection explicitly skippable and introduce profile-task state.
- Add an immediately visible benefit after onboarding: personalized jobs plus a non-blocking profile-strength card.

### Phase 3 — Contextual completion and LinkedIn export

- Add selected LinkedIn CSV data-export parsing and candidate-controlled mapping.
- Add education follow-up prompts on job detail, apply, saved jobs, and profile surfaces with caps/snoozes.
- Add observability dashboards and a controlled pilot/feature flag.

### Phase 4 — Optional direct LinkedIn OAuth and optimization

- Proceed only after scope/partner approval and a privacy/security review.
- Implement OAuth authorization-code flow with PKCE/state/nonce, verified callback URLs, encrypted short-lived token handling, revocation, and reconnection UX.
- Request only approved minimum scopes; do not represent basic OIDC identity data as a complete profile import.
- Tune salary and progressive education rules using measured outcomes; periodically refresh and audit salary bands.

---

## Testing and rollout checklist

- Unit tests: normalizers, date/qualification mapping, salary-chip derivation, prompt eligibility, data-retention decisions.
- Integration tests: RLS ownership, upload scanning/quarantine states, parsing retries/idempotency, atomic profile merge, salary no-data fallback.
- End-to-end tests: resume path, LinkedIn PDF/export path, manual fallback, existing-profile conflict, skip education, education prompted at application, mobile chip selection.
- Security tests: malicious file/archive, unauthorized import lookup, signed URL expiry, parser prompt injection, OAuth state/redirect misuse if OAuth launches.
- Accessibility/localization: keyboard chips, screen-reader labels, clear INR/month labels, low-bandwidth and mobile-first upload behavior.
- Release behind feature flags by source and feature; pilot internally, then a small candidate cohort; monitor before broad rollout.

---

## What credentials, services, and decisions are needed

### Required to build the recommended MVP

| Item | Is it needed? | Why |
| --- | --- | --- |
| Existing Supabase project (Auth, Storage, Database, Edge/server functions) | **Yes** | Stores private imports, proposals, tasks, policies, and salary data. |
| One server-side AI provider key — Gemini **or** OpenAI **or** OpenRouter | **Usually, already supported** | The existing resume parser uses JobsKart’s AI adapter. Configure one provider, not several, for the MVP. Keys must remain server-side/secrets only. |
| Malware scanning solution | **Recommended before public upload** | Protects the resume/import upload pipeline. This may be self-hosted scanning or a vetted vendor, depending on deployment. |
| Curated/validated salary bands and refresh ownership | **Yes** | The database engine exists, but candidate guidance is only as good as the bands and their update process. No AI key is needed. |
| Product/legal decisions for consent, retention, employer visibility, salary privacy | **Yes** | Required before handling additional career documents and profile imports. |

### Needed only for optional direct LinkedIn OAuth

| Item | Is it needed? | Notes |
| --- | --- | --- |
| LinkedIn Developer application | **Yes** | Create and verify an application, configure approved redirect URLs, and follow LinkedIn app review rules. |
| `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` | **Yes** | Server-side secrets only; never expose the secret in the React client. |
| Approved LinkedIn product/scopes for the exact data desired | **Yes** | Standard OIDC may only yield basic identity/userinfo. Full experience/education/skills import must not be assumed without explicit approved access. |
| Gemini/OpenAI key | **No, not for OAuth itself** | AI can normalize imported text if needed, but it is unrelated to LinkedIn authentication. |

### Clear recommendation

Start with **one AI key only**—the provider already supported by JobsKart’s server-side adapter (Gemini is a reasonable low-cost first choice if its terms, region, and budget suit the business). Do not add multiple model keys “just in case.”

For LinkedIn, start with **candidate-uploaded LinkedIn PDF/data export**, which needs no LinkedIn API key. Request LinkedIn OAuth credentials only after confirming that LinkedIn will approve the required scope and after the privacy/security decisions above are signed off.


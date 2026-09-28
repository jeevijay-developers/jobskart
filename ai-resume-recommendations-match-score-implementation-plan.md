# JobsKart AI Resume Builder, Recommendations, and Match Score — Detailed Implementation Plan

**Status:** Planning document only. No application code, database schema, configuration, secrets, or production data were changed.

**Scope:**

1. AI Resume Builder (profile-based)
2. AI Recommendations: semantic similarity, geo-intelligence, behavioural signals, semantic search, semantic job matching, location-aware recommendations, and role-to-skill mapping
3. AI Match Score System

## Executive recommendation

Build these features as an **explainable, staged marketplace intelligence system**, not as one large opaque AI feature.

The recommended order is:

1. Launch a template-based profile résumé builder with optional AI copy suggestions.
2. Repair/complete candidate-facing deterministic job recommendations and make score explanations visible.
3. Normalize skills, titles, locations, and salary data—the foundation for every later AI feature.
4. Add semantic retrieval using embeddings as a candidate generator, while keeping deterministic filters and score components as the final decision layer.
5. Add consented behavioural personalization and privacy-preserving geo ranking only after event/geo foundations exist.

An LLM should improve résumé language, summarize content, map job text to skills, and explain scores. It should **not** be the only source of truth for ATS résumé generation, candidate eligibility, or automated hiring decisions. The final recruiter-facing match score must retain deterministic, inspectable components and must not rely on protected/sensitive attributes.

---

# 1. What major job platforms do, and what JobsKart should learn

## 1.1 Established patterns

| Market pattern | Evidence | JobsKart interpretation |
|---|---|---|
| Profile-based résumé export/builder | LinkedIn lets members download a profile in résumé format and provides a custom Resume Builder where available. | Use JobsKart profile as the canonical résumé data source and allow several controlled, role-appropriate templates. |
| Recommendations from explicit preferences and profile | LinkedIn describes job recommendations driven by job titles, locations, work mode, employment type, profile headline/about/experience/education, searches, alerts, and activity. | Explicit candidate preferences and verified profile facts must be the base layer; behavioural signals are an optional later refinement. |
| Transparent job-match insights | LinkedIn exposes summaries of how profile/resume qualifications match required/preferred job qualifications and recommends skills to develop, while keeping job match level invisible to hirers. | Show candidates matched/missing qualifications and practical next steps; do not expose candidate-facing score to employers by default. |
| Skills as a shared language | LinkedIn Skills Match compares profile skills with job-required skills, including skills inferred from profile text. | Build a JobsKart canonical skill taxonomy with aliases, reviewed inferred skills, and source/evidence labels. |
| Feedback improves recruiter recommendations | LinkedIn Recommended Matches uses job signals, job-seeking signals, and recruiter save/hide/message feedback, and updates recommendations after actions. | Start with simple explicit positive/negative feedback and use it only after measuring bias, quality, and feedback volume. |

Sources: [LinkedIn résumé upload and builder](https://www.linkedin.com/help/linkedin/answer/a510363/upload-your-resume-to-linkedin?lang=en), [LinkedIn job recommendations](https://www.linkedin.com/help/linkedin/answer/a512279/), [LinkedIn job match insights](https://www.linkedin.com/help/linkedin/answer/a7120158), [LinkedIn Skills Match](https://www.linkedin.com/help/linkedin/answer/a793433/skills-match-insight-on-jobs?lang=en), [LinkedIn Recommended Matches](https://www.linkedin.com/help/linkedin/answer/a413241/recommended-matches-in-recruiter?lang=en-US), and [Indeed résumé guidance](https://www.indeed.com/career-advice/resumes-cover-letters/how-to-make-a-resume-with-examples).

## 1.2 Design principles for JobsKart

1. **Profile is the source of truth.** The résumé is a generated, editable version/snapshot—not a separate profile that silently diverges.
2. **AI suggestions require candidate approval.** Never add achievements, years of experience, qualifications, certifications, employers, or skills that the candidate has not confirmed.
3. **ATS-friendly means simple and valid.** Use stable section headings, readable fonts, single-column layouts, real text, logical reading order, and machine-readable PDF output. Avoid image-only/CV-design templates for the ATS default.
4. **Hard filters before AI.** Status, expiry, job type, work mode, location consent, qualifications, mandatory licensing/assets, and duplicate application rules are eligibility logic—not LLM judgment.
5. **Semantic retrieval is a helper, not the final score.** Embeddings find candidates/jobs with related meaning; a transparent ranker determines final ordering.
6. **Explicit user control wins.** A saved/hide/not-interested action, updated location preference, or role selection overrides weak inferred behavioral signals.
7. **No automated hiring decisions.** A score supports review and discovery; it must not auto-reject, auto-shortlist, or prevent a candidate from applying without a separately approved, audited policy.

---

# 2. Current JobsKart status and reuse opportunities

## 2.1 Already present in the repository

| Capability | Current state | Reuse |
|---|---|---|
| Candidate profile | Implemented: skills, experience, preferred cities/job types/work mode, salary, résumé pointer, profile strength, onboarding state | Canonical inputs for résumé building and matching. |
| Resume upload and AI parsing | Implemented as an upload-first, best-effort structured parsing workflow | Pre-fill profile/resume builder; candidate must review extracted fields. |
| AI provider adapter | Implemented: Lovable, Gemini, OpenAI, and OpenRouter provider paths; structured JSON/Zod support; cascade/cost-control patterns | Reuse for copy suggestions, job/skill extraction, explanations, and embeddings through a dedicated provider abstraction. |
| Deterministic candidate-job match | Implemented for employer candidate search/applicant ranking: skills, city/state, experience, salary, activity, intent, city proximity | Preserve as baseline; improve canonical skills, actual geo distance, versioning, and candidate-facing use. |
| Employer recommended candidates | Implemented through `get_recommended_candidates_for_job()` with invite/dismiss actions | Extend only after score versioning/quality controls. |
| Candidate discovery feed | Implemented and excludes previously applied jobs, but default ranking is boost/freshness/quality/trending, not profile-personalized | Replace only “Recommended” candidate sort with a candidate-specific recommendation service. |
| Similar jobs | Implemented as client-side deterministic role/category/city/skills/salary overlap | Can become a fallback/secondary module; do not confuse it with personalised feed. |
| Learning resources | Implemented with admin publishing | Link match gaps and skill suggestions to candidate learning actions. |
| Job description PDF | Implemented separately for employers | Do not reuse its print markup as a candidate résumé builder; share only the general print/PDF delivery approach if appropriate. |

## 2.2 New work required

- Profile-based résumé document model, templates, preview/editor, versioning, job-targeting, export, and auto-update controls.
- Canonical skills/titles taxonomy with aliases and source/evidence information.
- Candidate-facing recommendation RPC that uses candidate data in ranking.
- Embedding generation, vector storage/indexing, semantic retrieval, and reindex workflow.
- Consent-aware event pipeline/behavioural signals.
- Geocoding, coordinate privacy model, PostGIS/radius/distance ranking.
- Match-score versioning, explanations, monitoring, fairness safeguards, and recruiter-review guardrails.

## 2.3 Important existing gaps/risks to correct

1. The current candidate “Recommended for you” feed is not actually profile-personalised. It ranks jobs with boost/freshness/quality/trending signals after excluding applied jobs.
2. Current match uses raw normalized strings rather than a canonical skill/alias system.
3. Current “nearby” semantics use city/state tiers; no coordinates/actual distance exist.
4. `src/lib/matching.functions.ts` contains AI applicant scoring and optional automatic shortlisting. This must be reviewed before expansion: score generation should be structured/validated, explainable, bounded, and should not automatically advance candidates based only on an LLM score.
5. A résumé builder is not currently present; existing résumé handling is upload/parse/storage, not profile-to-resume generation.

---

# 3. AI Resume Builder (Profile-Based)

## 3.1 Description

The AI Resume Builder creates a polished, ATS-friendly résumé from JobsKart profile data. It helps a candidate select a target role and template, improves wording based on confirmed data, previews changes, and exports a private PDF/DOCX-style document. It must not fabricate qualifications or silently overwrite profile information.

## 3.2 Candidate flow

```text
Candidate opens Resume Builder
        ↓
Selects generic résumé or target JobsKart job/role
        ↓
Reviews profile data included in the résumé
        ↓
Selects ATS template and optional AI suggestions
        ↓
Edits/accepts content and previews in real time
        ↓
Saves version and downloads PDF
        ↓
Optionally marks résumé “sync with profile” and receives a refresh prompt after relevant profile changes
```

## 3.3 Functional requirements

### Profile-to-résumé generation

- Import candidate-approved name/contact, headline, city, target role, summary, skills, experiences, education, languages, certifications, links, and selected documents.
- Give the candidate inclusion controls per section/entry; profile data that is private or irrelevant must not be included automatically.
- Support candidate categories: fresher/student, experienced, career switcher, and frontline/blue-collar roles.
- Offer a generic master résumé and job-targeted copies. A targeted copy is a version; it never rewrites the master résumé without confirmation.

### AI suggestions

- Generate a professional summary from approved profile facts.
- Rewrite an existing responsibility into concise, truthful achievement-oriented bullet options.
- Suggest missing résumé sections only when supported by existing data.
- Suggest target-role skill ordering and role-specific keywords drawn from a selected job/role taxonomy.
- Identify formatting/completeness issues and explain ATS improvements.
- Require candidate acceptance for each content proposal; show the original and suggested text side-by-side.

### Templates and ATS compatibility

Start with three controlled single-column templates:

1. **Classic ATS** — standard chronological layout; default for all users.
2. **Skills-first** — appropriate for freshers/career changers/frontline roles.
3. **Experienced professional** — emphasizes summary, experience achievements, and selected skills.

Rules for every default template:

- selectable actual text, not canvas/image text;
- standard headings such as Summary, Skills, Experience, Education, Certifications;
- no tables/columns/text boxes in default ATS export;
- no icon-only contact labels;
- predictable reading order and sufficient contrast;
- PDF metadata/title, valid Unicode/font embedding, and print-friendly A4 layout;
- HTML preview and export from the same structured résumé JSON.

### Auto-update design

“Auto-update” should **not** silently modify a résumé that a candidate previously downloaded/applied with.

Implement two modes:

- **Manual refresh (default):** after profile changes, show “3 résumé sections can be refreshed” and let candidate inspect/apply them.
- **Sync draft (opt-in):** update an editable draft when mapped profile fields change, preserving candidate edits through field-level source tracking and conflict review.

Every download/application attachment references an immutable résumé version. Never alter historical application documents after submit.

## 3.4 Data model proposal

| Entity | Purpose | Essential fields |
|---|---|---|
| `candidate_resume_documents` | Candidate-owned résumé document/container | id, user_id, title, source profile version, target job/role, selected template, sync mode, active draft/version |
| `candidate_resume_versions` | Immutable saved/exported snapshot | document ID, version number, structured content JSON, template version, created by/source, accepted suggestion IDs, rendered path/checksum, exported at |
| `candidate_resume_section_overrides` | Candidate edits that differ from profile source | document/version, source entity/field, content, status, profile source timestamp |
| `candidate_resume_suggestions` | AI-generated or deterministic suggestions | document/version/context, type, input hashes, suggested content, reason/evidence, model/prompt version, accepted/rejected status |
| `resume_template_catalog` | Controlled templates | ID, version, role/candidate applicability, renderer, ATS status, active/published state |
| `resume_export_jobs` | Asynchronous render/export tracking if needed | version ID, status, output path/checksum, renderer version, failure reason |

All candidate résumé records must be private to the candidate by default. Sharing happens only when the candidate attaches a specific immutable version to an application or creates an explicit sharing link with tight expiry/controls.

## 3.5 Implementation plan

1. Define a versioned résumé JSON schema independent of UI/template. Use it for preview, export, AI suggestions, and application attachment.
2. Build server-side profile snapshot assembler. It must use authenticated candidate identity, load only candidate-owned records, and sanitize optional sections.
3. Build template renderer from the structured schema. Start with HTML/CSS print-to-PDF/controlled server rendering; do not use an LLM to lay out documents.
4. Add résumé builder routes, preview, section editor, inclusion controls, autosave draft, undo/redo, and accessible mobile editing.
5. Create deterministic résumé quality checks: empty summary, missing dates, inconsistent chronology, duplicate skills, excessive length, no target role, missing contact preference, unsupported characters.
6. Add AI suggestion server functions using the existing provider adapter, strict Zod schemas, low temperature, content provenance, quotas, and candidate confirmation.
7. Implement immutable saved versions and PDF generation. Add DOCX later only when template fidelity and QA support it; PDF is the MVP export.
8. Add a “Use this version for application” selector that attaches a specific version, not a mutable profile résumé path.
9. Add profile-change detection and manual refresh suggestions; implement opt-in sync drafts only after override/conflict behavior is tested.
10. Add admin template management/versioning, template preview tests, and ATS validation fixtures.

## 3.6 Acceptance criteria

- A candidate can create, preview, save, and download a résumé based on their profile without using an AI API.
- Every AI-generated phrase is candidate-reviewed and traceable to approved source facts.
- An application retains the exact résumé version submitted.
- Profile changes never silently alter previously downloaded or submitted documents.

---

# 4. AI Recommendations

## 4.1 Description

Recommendations surface relevant jobs for candidates and relevant candidates for employers. They must balance relevance, explicit preferences, freshness, location, quality, diversity, marketplace rules, and user feedback.

## 4.2 Recommendation architecture

Use a two-stage approach:

```text
Eligibility filters
  → Candidate generation (deterministic filters + optional semantic retrieval)
  → Transparent multi-signal ranker
  → Diversity/business-rule pass
  → Explanations, feedback capture, monitoring
```

### Stage A: eligibility filters

For candidate job feed: active/unexpired job, not applied/withdrawn/hidden, preferred job type/work mode where selected, basic location/eligibility, and any mandatory requirement policy.

For employer candidate recommendation: active job, company membership, candidate availability/visibility policy, no existing application/dismissal where required, and unlocked/contact privacy rules.

### Stage B: candidate generation

- deterministic skill/title/category/location filters;
- canonical skill overlap;
- optional vector similarity for related roles/skills;
- freshness and job quality threshold;
- location radius/city fallback;
- enough candidates/results for later ranking and diversity.

### Stage C: final ranker

Start with a versioned, deterministic weighted model. Semantic similarity is one bounded feature, never the only score.

Example candidate-job components (weights must be validated, not copied blindly):

| Component | Purpose | Safeguard |
|---|---|---|
| Role/title similarity | Compare canonical title/role family and semantic relevance | Do not infer a role solely from name/gender/location. |
| Skill fit | Required/preferred canonical skills and evidence | Show matched/missing skills; aliases require review. |
| Experience fit | Compare stated experience to range | Avoid hard rejection for ambiguous/missing data unless truly mandatory. |
| Work mode/job type | Respect candidate explicit preferences | Explicit preference should outweigh behaviour inference. |
| Salary fit | Compare normalized salary period/band | Treat missing salary as uncertainty, not a penalty. |
| Location/distance | Consent-aware geo/city fallback | Never expose exact candidate home point. |
| Job quality/freshness | Keep timely, complete posts discoverable | Bounded contribution. |
| Behavioural feedback | Saved/opened/applied/hidden signals | Opt-in/transparent, capped, decay over time. |
| Paid boost | Marketplace placement | Clearly labelled and capped so it cannot dominate relevance. |

## 4.3 Semantic similarity models

### Description

Semantic similarity compares the meaning of a job/profile/search query beyond exact keyword matching. It helps recognize related titles, responsibilities, and skills.

### Implementation plan

1. Do not start with all raw résumé text. Define minimal embedding documents:
   - job: normalized title, category, responsibilities, skills, experience, work mode/location summary;
   - candidate: candidate-approved headline, target role, canonical skills, experience summary, preferred work mode/location summary;
   - query: user search text only.
2. Add `pgvector` after confirming Supabase environment/extension availability. Store embeddings in private/internal tables with entity ID, text hash, model/version, dimensions, state, and updated timestamp.
3. Build an outbox/reindex job triggered by relevant job/profile changes. Make it idempotent by source text hash and model version.
4. Use HNSW/IVFFlat indexes only after measuring expected data volume and query plans; reindex/calibrate when model dimensions/version change.
5. Use vector similarity only to retrieve a bounded candidate set. Apply normal eligibility and final deterministic ranking afterward.
6. Store semantic score/version for debugging but present candidates with understandable matched-title/skill explanations—not “embedding score 0.83.”
7. Build offline test sets for synonyms, related roles, Indian job titles, English/Hindi terms, misleading keyword stuffing, and sparse profiles.

## 4.4 Geo-intelligence and location-aware recommendations

### Description

Geo-intelligence moves from city string matching to consented, privacy-preserving distance/locality ranking.

### Implementation plan

1. Define consent, precision, retention, candidate/employer visibility, and opt-out before storing coordinates.
2. Normalize city/locality/pincode/state and geocode job locations and candidate preferred work areas—not necessarily home addresses.
3. Enable PostGIS after environment validation; store geography points plus accuracy/source/confidence metadata and spatial GiST indexes.
4. Use distance bands/radius rather than exposing exact locations. Handle remote, pan-India, multi-site, and field jobs explicitly.
5. Include distance as a bounded rank feature after core role/skill fit, with city/state fallback when no coordinates exist.
6. Add geocode retry/manual correction and never fabricate coordinates for ambiguous locations.

## 4.5 Behavioural prediction

### Description

Behavioural prediction personalizes recommendation order using consented marketplace actions such as saves, applications, hides, alert subscriptions, explicit preference changes, recruiter outreach, and recruiter save/hide feedback.

### Implementation plan

1. Build event collection and a consent/controls model before a predictive model. Minimum candidate events: recommendation impression, detail open, save, apply, hide/not interested, report, alert creation, and preference update.
2. Record event context: candidate/user ID, entity ID, recommendation version/rank, timestamp, surface, and source—not sensitive free-text unless needed.
3. Start with transparent rules: boost recently saved categories, suppress hidden jobs/companies, decrease repeated ignored results, and use recency decay.
4. Do not infer sensitive attributes or “job-seeking desperation.” Do not use protected characteristics, private messages, resume audio, interview practice data, or employer-private information.
5. Add behavioural ML/reranking only after enough clean events, offline evaluation, control groups, privacy review, and outcome monitoring exist.
6. Give candidates controls to update preferences, hide a job/company, reset personalization, and opt out where required.
7. For recruiters, treat save/hide/invite/reply as feedback with reason options and strict company/job scope; do not learn from protected traits or unreviewed free text.

## 4.6 Semantic search

### Description

Semantic search lets a query like “night shift delivery work near me” or “customer support job with Hindi” retrieve relevant jobs even if exact terms differ.

### Implementation plan

1. Preserve keyword/filter search as the default reliable path. Semantic search complements, not replaces, exact titles, salary filters, city filters, and compliance-critical requirements.
2. Parse query into explicit filters first (city, salary, work mode, job type); keep the remaining intent text for semantic retrieval.
3. Retrieve keyword and vector result sets separately, union/deduplicate, then re-rank with eligibility, textual relevance, canonical skill/title match, and preference signals.
4. Show and allow editing of inferred filters. Do not silently turn a query into a different search.
5. Add query suggestions from canonical title/skill/city data before relying on generative query rewriting.
6. Build tests for misspellings, code-switched queries, ambiguous job names, safety-sensitive requirements, zero results, and irrelevant semantic expansion.

## 4.7 AI maps job role to common skills

### Description

This feature derives likely skills from a job title/category/description to improve job creation, résumé targeting, question banks, semantic matching, and candidate learning suggestions.

### Implementation plan

1. Establish a curated `skills_master`, role taxonomy, aliases, and role-to-skill mapping as the primary source. Each mapping includes required/preferred/recommended level and source/review metadata.
2. Use AI only to propose mappings from unstructured job descriptions/title; validate output against existing canonical skills and queue unknown skills for admin review.
3. Keep proposed vs confirmed skills separate. A job poster/candidate/admin must confirm before a proposal becomes a requirement or profile skill.
4. Support synonyms and skill families, for example “MS Excel”/“Microsoft Excel,” without treating unrelated adjacent skills as equivalent.
5. Feed approved mappings into job wizard suggestions, résumé builder keyword ordering, match explanations, interview preparation, and learning resource links.
6. Monitor false positives, unknown-skill volume, edit/acceptance rate, and role-category disagreement.

---

# 5. AI Match Score System

## 5.1 Description

The AI Match Score System compares a job and profile to help candidates decide where to apply and recruiters prioritize review. It should be an explainable relevance score, not a hiring decision or a statement that a candidate will succeed in the role.

## 5.2 Current state

**Partially implemented.** JobsKart already has `compute_candidate_match()` used for employer candidate database search, recommended candidates, and applicant ranking. It returns a score/breakdown/tags using skill overlap, city/state fit, experience, salary, activity, intent, and city-tier proximity. A separate AI applicant scoring function exists as well.

## 5.3 Recommended model

Maintain two related but distinct scores:

1. **Candidate Job Match:** candidate-visible, private, for a candidate’s own job discovery/application decision.
2. **Recruiter Relevance:** employer-visible, job-scoped aid for sorting/review, with explanation and human control.

Do not expose an employer score as the candidate’s score or vice versa. They have different goals, permitted signals, and privacy boundaries.

## 5.4 Score contract

Each score response should include:

```json
{
  "score": 72,
  "band": "good_match",
  "version": "match-v2",
  "eligible": true,
  "breakdown": {
    "role": 15,
    "skills": 30,
    "experience": 12,
    "work_mode": 5,
    "salary": 4,
    "location": 6
  },
  "matched": ["Customer support", "Hindi", "CRM"],
  "to_review": ["Night shift availability"],
  "explanation": ["Matches 3 of 4 priority skills", "Located within your preferred area"],
  "limitations": ["Salary is not listed"],
  "generated_at": "..."
}
```

The exact numerical weights need product/market validation; store the score version and feature snapshot so a result can be reproduced and audited.

## 5.5 Implementation plan

1. Establish hard eligibility rules separately from score. Return `eligible=false` with a plain reason where a truly mandatory condition is unmet; do not hide this behind a low score.
2. Normalize/validate inputs: canonical skills, title families, experience ranges, salary period, work mode, job type, and location precision.
3. Refactor deterministic matching into a versioned, centrally tested score service/RPC used consistently by candidate/recruiter flows with different visibility rules.
4. Add candidate-facing `get_job_match_for_candidate(job_id)` / `recommend_jobs_for_candidate()` interfaces that derive identity from `auth.uid()`.
5. Add recruiter-facing `get_candidate_relevance_for_job(job_id, candidate_id)`/batch query interfaces guarded by company membership, candidate visibility, and contact-unlock rules.
6. Add semantic similarity as one bounded feature after embeddings are live and evaluated. Retain a full deterministic fallback if vectors/provider are unavailable.
7. Add score explanations, matched/missing skills, user controls, and a “why am I seeing this?”/“improve my profile” experience.
8. Add human decision guardrails: recruiter can sort/filter but must review profile/application; no automatic rejection. Remove or disable automatic shortlisting based only on generative AI until a formal legal/fairness/quality review approves a controlled workflow.
9. Log score calculation input hashes/version/results for operational audit, not raw sensitive contents where unnecessary.
10. Test and monitor calibration, false positives/negatives, sparse profile behavior, cross-language behavior, city/rural bias, and impact by non-protected proxy categories.

## 5.6 Candidate quality and application quality

To improve application quality without discriminating or blocking candidates:

1. Before applying, show a private match explanation and optional checklist: résumé selected, key skills evidenced, required question answered, location/work mode reviewed.
2. Let candidates apply even with a low score unless a clear mandatory job requirement is objectively missing and transparently communicated.
3. Encourage résumé targeting and skill learning; do not tell candidates to fabricate missing skills.
4. Provide recruiters a transparent sorting aid and role-specific filters, but preserve access to the complete eligible applicant pool.
5. Evaluate quality by recruiter review/response and candidate outcomes, but avoid training on historic biased rejection data without careful review.

---

# 6. Data, security, and operations architecture

## 6.1 New data domains

| Domain | Data | Security expectation |
|---|---|---|
| Résumé builder | documents, immutable versions, drafts, AI suggestions, exports | candidate private; specific immutable version only is shared through application process |
| Skills taxonomy | canonical skills, aliases, role-skill mappings, review state | public/readable active masters; admin-managed writes |
| Embeddings | entity ID, vector, model/version, source hash, status | internal/private access; never expose raw vector queries cross-tenant |
| Recommendation events | impressions, opens, saves, applies, hides, feedback | user/company scoped; consent-aware; minimal payload |
| Location intelligence | normalized text, consent, accuracy, geo point | exact points private; employer sees only approved coarse data/distance band |
| Score audit | score version, input hash, breakdown, timestamp | candidate sees own; employer sees only allowed job-scoped relevance |

## 6.2 Privacy and responsible-AI controls

- Do not use name, gender, date of birth, marital status, disability/health, religion/caste, photo, voice, precise home address, or other protected/sensitive attributes in matching/ranking.
- Do not use interview-practice transcripts/audio or private candidate documents for employer score/recommendation.
- Clearly distinguish candidate-visible profile improvement advice from recruiter-visible relevance.
- Allow candidates to update preferences, hide roles/employers, reset behavioural personalization, and delete generated résumé drafts under defined retention rules.
- Keep all AI/provider secrets server-side. Never use `VITE_`/client-exposed variables for provider keys.
- Add data retention and deletion workflows for résumé exports, AI suggestion history, vectors after profile deletion, and behavioural event records.

## 6.3 Reliability and cost controls

1. Use content hashes to avoid regenerating résumé suggestions/embeddings when input has not changed.
2. Queue/retry asynchronous embedding and PDF render work; do not block profile/job save on model/provider availability.
3. Set per-candidate daily quotas for costly suggestion generation and per-company/role throttles for batch recruiter scoring.
4. Return deterministic fallback resume templates, keyword search, and match scores when AI providers are unavailable.
5. Record provider/model/task/latency/token or embedding counts/error category per job for budget and incident monitoring.
6. Add a kill switch per task: résumé suggestions, embedding generation, semantic search, recruiter AI explanation, behavioural reranker.

---

# 7. Phased delivery plan

## Phase 0 — Foundations and governance

1. Approve product definitions for ATS-friendly templates, profile sync, match-score visibility, location consent, behavioral personalization, and automated-decision boundaries.
2. Audit the current AI applicant scoring/auto-shortlist path and disable any unsafe automatic advancement pending a formal review.
3. Define canonical role/title/skills taxonomy and data ownership/review workflow.
4. Define match-score version contract, explanations, tests, event dictionary, retention, and fairness review criteria.
5. Verify existing AI provider configuration and keep all secrets server-only.

## Phase 1 — Profile résumé builder MVP (no new AI key required if suggestions are deferred)

1. Build structured résumé JSON schema, profile snapshot service, three ATS templates, preview/editor, immutable versions, and PDF export.
2. Add candidate controls for section inclusion/order, manual text edits, target-role selection, and attach-version-to-application.
3. Add deterministic résumé quality checks and template test fixtures.
4. Add manual profile-refresh prompts; do not ship automatic sync drafts yet.

## Phase 2 — AI résumé suggestions and role-skill mapping

1. Add candidate-approved summary/bullet/keyword suggestions through the existing AI adapter.
2. Add strict structured output, provenance, quotas, side-by-side acceptance, fallback, and suggestion reporting.
3. Add AI-proposed job-role-to-skill mapping with admin confirmation; build aliases and canonical skills.
4. Connect learning resources and résumé improvements to confirmed skill gaps.

## Phase 3 — Candidate-facing deterministic recommendations and match explanations

1. Create `recommend_jobs_for_candidate()` and switch only Recommended candidate feed surfaces to it.
2. Implement candidate job-match explanation/card detail and private profile-improvement checklist.
3. Version/refactor existing deterministic match logic, preserve employer/candidate visibility boundaries, and remove unsafe AI-only auto-shortlisting.
4. Add recommendation feedback controls: save, hide/not relevant, role preference update, company hide where policy permits.

## Phase 4 — Semantic retrieval and semantic search

1. Enable `pgvector`, implement embedding documents/outbox/reindex, and build offline relevance tests.
2. Add semantic candidate generation and job search as a bounded retrieval stage.
3. Blend/re-rank with deterministic matching and run shadow evaluation before user rollout.
4. Add semantic explanations and vector/index health monitoring.

## Phase 5 — Geo and behavioural intelligence

1. Introduce consented geocoding/PostGIS and distance bands/ranking.
2. Add minimal event-driven behavioural rules, then measure with control groups.
3. Evaluate learned personalization only after sufficient data, privacy review, fairness testing, and rollback control.

---

# 8. Testing and acceptance plan

## Résumé builder tests

- Profile snapshot includes only candidate-authorized fields.
- AI suggestions cannot introduce unsupported achievements/skills/certifications.
- Templates render valid readable PDF with expected section order.
- Immutable application résumé version remains unchanged after profile update.
- Candidate cannot access any other candidate’s drafts/export files.
- Export and rendering failures preserve draft and return a recoverable status.

## Match/recommendation tests

- Candidate gets only their own score/recommendations; employer access is job/company scoped.
- Applied/hidden/inactive/expired jobs are excluded before pagination.
- Explicit work-mode/location preference wins over weak behavioural inference.
- Canonical skill aliases match correctly; unrelated skills do not.
- Missing salary/location results in a visible limitation/neutral treatment rather than hidden penalty.
- Semantic retrieval failure falls back to deterministic results.
- Score explanation matches stored breakdown/version.
- No protected/sensitive field influences scoring fixtures.

## Operational tests

- Embedding jobs are idempotent and replayable.
- Vector/model migration can reindex without serving mixed incompatible dimensions.
- AI quota/rate-limit, retry, kill-switch, and provider failure states work.
- Geocoding consent withdrawal removes/invalidates coordinate-based matching.
- Analytics can measure recommendation exposure and outcome without exposing raw private profile data.

---

# 9. What you need: keys, services, and configuration

## 9.1 Do not provision everything at once

You do **not** need Gemini, OpenAI, and OpenRouter keys simultaneously. The repository already has one provider adapter. For each AI task, configure **one primary provider** and optionally one fallback after the MVP is stable.

## 9.2 Required for Phase 1 résumé builder MVP

| Need | Required? | Notes |
|---|---:|---|
| Existing Supabase project credentials | Yes | Already required by JobsKart; use Storage/private RLS and database migrations. |
| AI key | No | The template/profile-to-PDF builder can launch without AI suggestions. |
| PDF renderer | Yes, but no external key necessarily | Use server-side or browser-controlled HTML-to-PDF approach; validate output quality. |
| Private storage bucket/policies | Yes | For saved exports if retained; never make private résumé versions public. |

## 9.3 Required for Phase 2 AI suggestions

Choose one primary provider already supported by `src/lib/ai/provider.ts`:

| Option | Required environment configuration | When to choose |
|---|---|---|
| Gemini | `AI_PROVIDER=gemini`, `AI_MODEL=<chosen Gemini model>`, `GEMINI_API_KEY` | Good choice if you want Google model access and it meets your cost/language/region requirements. |
| OpenAI | `AI_PROVIDER=openai`, `AI_MODEL=<chosen model>`, `OPENAI_API_KEY` | Good choice if you choose OpenAI models for structured generation/embeddings. |
| OpenRouter | `AI_PROVIDER=openrouter`, `AI_MODEL=<provider/model>`, `OPENROUTER_API_KEY` | Useful if you need provider/model routing and a controlled fallback catalog. |
| Lovable gateway | `AI_PROVIDER=lovable`, `AI_MODEL=<chosen model>`, `LOVABLE_API_KEY` | Use only if this is the approved deployment/provider path for your environment. |

Also configure:

- `AI_CHEAP_MODEL` only if you intentionally use the existing cascade pattern.
- Budget alerts, per-task quota, and secret storage in the server/deployment environment—not `VITE_*` variables and not browser code.

## 9.4 Required for Phase 4 semantic recommendations/search

| Need | Required? | Notes |
|---|---:|---|
| Embedding model/provider key | Yes | Choose a provider/model suitable for embeddings. It may be the same AI provider, but verify dimensions, cost, language support, and data terms. |
| Supabase `pgvector` extension | Yes | Database capability, not an external API key. Confirm it is enabled/supported before migration. |
| Worker/Edge Function/server execution | Yes | For idempotent embedding generation and reindex jobs. |
| Vector monitoring/reindex process | Yes | Model/version changes require controlled re-embedding. |
| Elasticsearch/Algolia key | No, initially | Only needed if you later choose a separate search engine; semantic retrieval can begin with Postgres + pgvector. |

## 9.5 Required for Phase 5 geo intelligence

| Need | Required? | Notes |
|---|---:|---|
| Geocoding provider key | Yes | Choose Google Maps, Mapbox, or another approved provider after comparing India coverage, price, rate limits, terms, and privacy. This is not an AI key. |
| PostGIS extension | Yes | Database capability for geographic storage/distance queries. |
| Candidate location consent/policy | Yes | A product/legal requirement, not a technical optional extra. |

## 9.6 Optional future services

- Analytics/error monitoring provider for recommendation/model cost and quality monitoring.
- Dedicated search provider credentials only if Postgres full-text/vector search no longer meets measured latency/relevance needs.
- DOCX rendering service/library only after PDF MVP is stable; no AI key is required for DOCX generation.

## 9.7 Secrets checklist

1. Store AI/geocoder keys only in server/hosting secrets or Supabase Edge Function secrets as appropriate.
2. Never add provider keys to `.env.example` with actual values, Git, frontend variables, browser bundles, logs, screenshots, or client-side error messages.
3. Use separate keys/projects for development, staging, and production.
4. Set provider spending limits, usage alerts, rotation ownership, and a documented incident/revocation procedure.
5. Minimize data sent to providers and verify the provider’s retention/training/data-processing settings before production.

---

# 10. Priority backlog

| Priority | Work item | Why |
|---|---|---|
| P0 | Audit/guard current AI applicant auto-shortlisting | An opaque LLM score should not automatically advance/reject candidates. |
| P0 | Résumé builder structured schema, templates, immutable versions | Delivers profile-based builder without needing AI keys. |
| P0 | Candidate-facing deterministic recommendation and match explanation | Corrects the current generic “Recommended” feed semantics. |
| P1 | Canonical skills/title taxonomy and aliases | Required for reliable résumé targeting, matching, search, and learning gaps. |
| P1 | AI suggestion layer with candidate acceptance, quotas, provenance | Safely adds “AI-powered” résumé improvement. |
| P1 | Recommendation events and explicit feedback controls | Foundation for personalization and quality measurement. |
| P2 | pgvector embeddings and semantic retrieval | Add only after deterministic baseline and offline test data are ready. |
| P2 | Geocoding/PostGIS and distance ranking | Requires privacy/consent and location data foundation. |
| P3 | Behavioural ML/reranker | Needs sufficient quality events, privacy review, controls, and monitoring. |

# 11. Final implementation checklist

- Candidate profile remains canonical; résumé versions are controlled snapshots.
- ATS template export works without AI and is tested with real parsers/fixtures.
- AI never invents facts and all suggestions are candidate-approved.
- Matching separates hard eligibility from relevance ranking and returns explanations/versioning.
- Candidate-facing and recruiter-facing scores use separate visibility contracts.
- No protected/sensitive data, practice-interview data, or hidden behavioral profile is used for hiring scores.
- Vector/geo work is asynchronous, consented, indexed, monitored, and has deterministic fallback.
- Provider keys are server-only; choose one primary AI provider first rather than buying every key.
- New Supabase tables/functions have RLS, narrow grants, ownership checks, and migration/test review.
- Every phase has quota, cost monitoring, kill switch, audit logs, and rollback plan before rollout.


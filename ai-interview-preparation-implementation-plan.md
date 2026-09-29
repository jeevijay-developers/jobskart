# JobsKart AI Interview Preparation — Detailed Implementation Plan

**Status:** New feature proposal. This document is planning only; no application code, database schema, configuration, secrets, or production data were changed.

**Feature goal:** Give a candidate a private, job-relevant practice experience before a real interview: prepare by role, study a curated question bank, complete text or voice mock interviews, receive safe actionable feedback, understand skill gaps, and connect those gaps to JobsKart learning resources.

## Executive recommendation

Build this as a **candidate-owned practice and coaching product**, not an employer assessment or automated hiring decision tool.

The first version should be available from:

1. A candidate’s scheduled interview card, pre-filled from the actual JobsKart job and interview date.
2. A job detail/application page, for candidates considering or applying to the job.
3. A standalone “Interview prep” destination, where a candidate can choose a target role even without a current interview.

The product should begin with role/job-specific question preparation and typed mock sessions, then add opt-in voice practice. It should provide **readiness bands and observable coaching**, rather than claiming to measure a candidate’s personality, emotion, honesty, employability, or objective “confidence.” Practice content and results must never be shared with employers by default.

---

# 1. What established platforms do, and what JobsKart should learn from them

## 1.1 Market patterns

Current career/interview products generally combine these elements:

| Pattern | Why it works | JobsKart adoption |
|---|---|---|
| Job-specific practice | Questions derived from the actual job description are more relevant than generic question lists. | Generate a practice plan from JobsKart job title, skills, responsibilities, experience, work mode, and interview type. |
| Safe mock interview | Candidates can practise repeatedly without an employer seeing the attempts. | Make every practice session private by default and clearly say so. |
| Text and voice modalities | Text is accessible and cheap; voice helps candidates rehearse spoken answers. | Ship typed mode first; make voice an opt-in second phase with transcript review. |
| Transcript plus feedback | Candidates need evidence and specific rewrites, not a vague score. | Return transcript, answer-level feedback, strengths, missed points, and a better answer outline. |
| Readiness summary | A simple low/medium/high or banded summary helps prioritise preparation. | Use a transparent “practice readiness” band, not a hiring prediction. |
| Learning follow-up | Feedback is useful only if it leads to the next practice/resource. | Link detected skill/communication gaps to JobsKart `learning_resources` and practice drills. |
| Rate/cost controls | Voice and AI sessions are costly and can be abused. | Add per-user quotas, short session caps, idempotency, and cost telemetry from the first release. |

## 1.2 Research basis

LinkedIn’s current AI interview-prep experience is tied to real job descriptions, supports speaking or typing responses, and returns readiness feedback, strengths/improvements, a transcript, and improvement examples. It also applies session limits. [LinkedIn Learning AI interview prep FAQ](https://www.linkedin.com/help/learning/answer/a9308146)

LinkedIn also distinguishes practice interviews from employer screening: practice responses are not shared with employers, while screening interviews have separate data handling and accessibility expectations. [LinkedIn AI interviews help](https://www.linkedin.com/help/linkedin/answer/a10376002)

Indeed’s current mock-interview guidance emphasizes role-relevant questions, practising aloud, realistic interview conditions, recording/reviewing responses, practical feedback, and avoiding rigid memorisation. [Indeed mock interview guidance](https://www.indeed.com/career-advice/interviewing/prepare-for-a-mock-interview), [Indeed interview practice guidance](https://www.indeed.com/career-advice/interviewing/job-interview-practice)

## 1.3 Product choices that make JobsKart better suited to its users

1. **Interview-linked prep:** A scheduled interview can generate a focused plan with days remaining, job requirements, likely interview format, and the candidate’s existing profile/resume.
2. **India-first accessibility:** Hindi/English and code-switching must be a deliberate roadmap item; voice is optional, and typed practice remains fully capable.
3. **Low-bandwidth first:** A candidate should be able to practise through text or recorded answer upload, not only a live streaming conversation.
4. **Real improvement loop:** Every feedback item links to a small drill, question retry, or curated JobsKart learning resource.
5. **No employer surveillance:** Practice is separate from the real JobsKart interview and never visible to the employer unless the candidate later chooses an explicit sharing feature that is separately designed and consented.
6. **No pseudo-science:** Do not infer confidence, truthfulness, personality, emotion, eye contact, attractiveness, age, gender, disability, accent quality, or employability from video/audio.

---

# 2. Fit with the existing JobsKart project

## 2.1 Existing capabilities that can be reused

| Existing capability | Reuse in interview prep |
|---|---|
| Candidate profile, skills, experience, preferred roles, resume | Pre-fill role context and tailor practice questions. Candidate must review/choose what is used. |
| Jobs, job skills, salary/experience, work mode, job description | Generate role/job-specific prep plans and questions. |
| Applications and scheduled interviews | Display “Prepare for this interview” for the candidate’s own application/interview. |
| Candidate dashboard and app shell | Add an Interview Prep navigation entry and dashboard CTA. |
| `learning_resources` and admin learning area | Attach resources/drills to question categories and detected gaps. |
| Existing AI adapter and Zod output validation | Use provider-agnostic server-only AI calls, structured outputs, validation, fallback, and existing cost-control approach. |
| Server functions and Supabase RPC/RLS pattern | Protect candidate-owned sessions, answers, transcripts, and feedback. |
| Notification/interview reminder infrastructure | Nudge candidates to practise only with consent and sensible limits. |

## 2.2 Existing capabilities that must remain separate

1. Existing employer interview scheduling/Zoom functions are for real interviews. Do not reuse their meeting rooms, links, recordings, or access controls for practice sessions.
2. Employer applicant ranking/AI shortlist scores are not suitable inputs to candidate practice feedback and must not be exposed.
3. Candidate practice scores must not be fed into employer candidate search, recommendation, application rank, trust score, or job eligibility.
4. Resume parsing may provide candidate-approved profile context, but raw resume/document contents should not be repeatedly sent to an AI model for each practice question.

## 2.3 Current repository evidence

- `src/components/candidate/InterviewInfo.tsx` and `src/routes/_authenticated/candidate/applications.tsx` — candidate-side scheduled-interview context.
- `src/lib/interview.functions.ts` and `src/components/employer/ScheduleInterviewModal.tsx` — real interview scheduling infrastructure to keep separate.
- `src/routes/admin/learning.tsx` and candidate dashboard learning section — existing learning resource management/display.
- `src/lib/ai/provider.ts` — centralized AI provider adapter, structured JSON validation, provider configuration, and cost-aware cascade pattern.
- `src/lib/resume.functions.ts` — existing structured AI extraction/error-handling pattern.

---

# 3. Scope and non-goals

## 3.1 In-scope user flow

```text
Candidate chooses a target role or a real upcoming JobsKart interview
        ↓
Reviews a generated preparation brief
        ↓
Studies role/job-specific question bank
        ↓
Runs a private mock interview (text first; voice when enabled)
        ↓
Reviews transcript, answer feedback and practice readiness
        ↓
Retries weak questions / completes drills and learning resources
        ↓
Returns for a short final rehearsal before the real interview
```

## 3.2 Initial non-goals

- Employer-facing AI screening, automated rejection, or ranking.
- Video-based facial-expression, eye-contact, emotion, personality, or lie detection.
- Claims that a score predicts hiring success.
- Real-time live human interview replacement.
- Open-ended counselling, legal/medical advice, or the generation of fabricated work history.
- Mandatory audio recording; text-only practice must remain available.
- Sharing practice recordings/transcripts with employers.

## 3.3 Phased scope decision

| Release | Include | Exclude |
|---|---|---|
| MVP | Role/job prep brief, curated question bank, typed mock, structured feedback, readiness bands, learning links, private history | Voice, live conversational interruption, video, employer sharing, multi-language voice |
| Voice beta | Opt-in record-and-submit voice answers, transcription, transcript feedback, pacing/filler-word coaching, deletion controls | Video analysis, continuous audio streaming, employer access |
| Conversational voice | Turn-by-turn AI interviewer, text-to-speech, follow-up questions, Hindi/English rollout | Hiring decision automation |
| Mature product | Personalised drills, spaced repetition, progress analytics, interview-linked reminders, curated/admin workflow | Unvalidated behavioural/biometric scoring |

---

# 4. Detailed design for each requested flow point

## 4.1 Role-wise Preparation

### Description

Role-wise preparation creates a preparation brief and practice path for a candidate’s desired role or a specific upcoming interview.

### Product design

The candidate selects one of three contexts:

1. **Prepare for my upcoming interview** — a candidate-owned scheduled interview pre-fills job and employer context.
2. **Prepare for a JobsKart job** — a candidate chooses a public/applicable job.
3. **Prepare for a role** — candidate selects a title/category without an associated job.

The resulting brief includes:

- likely interview format (phone, video, onsite) when known;
- role summary and core responsibilities;
- required and preferred skills from the job;
- candidate-approved strengths to highlight from profile/resume;
- likely question categories;
- a practice plan matched to time remaining (for example 10-minute quick practice, 20-minute mock, 3-day preparation plan);
- job/company research checklist based only on public/available information.

### Implementation plan

1. Create a preparation-context resolver that accepts exactly one context: `role`, `job_id`, or candidate-owned `interview_id`/`application_id`.
2. Validate ownership server-side. A candidate can use only their own application/interview; no client-supplied candidate identity is trusted.
3. Build a normalized context object from job title/category, skills, responsibilities, experience, work mode, interview mode, candidate experience/skills, and approved profile summary.
4. Generate a structured preparation brief with the AI adapter, but constrain it to source facts and vetted templates. It must not invent company facts, job requirements, or candidate achievements.
5. Cache the brief by context version (job update timestamp + candidate profile relevant fields + prompt/template version) to control cost and keep results stable.
6. Let the candidate edit focus areas and remove any profile detail before question generation.
7. Provide a deterministic fallback brief and generic question plan whenever the AI provider is unavailable.

### Acceptance criteria

- A candidate can begin preparation from a scheduled interview, a job, or a generic role.
- A prep brief never reveals employer-private notes or other candidates’ data.
- AI outage does not prevent access to question-bank practice.

## 4.2 Interview Question Bank

### Description

The question bank gives candidates a reliable, explainable library of questions and answer frameworks by role, seniority, skill, and interview format.

### Product design

Question groups for the initial release:

- introduction and work story;
- motivation/role fit;
- behavioural questions using STAR/CAR structure;
- role/skill-specific questions;
- situational/problem-solving questions;
- customer-service/sales/operations questions where appropriate;
- practical logistics: availability, shift, location, salary, notice period;
- candidate questions to ask the employer;
- interview-format tips for phone, video, and onsite interviews.

Each question should have a target role/category, seniority band, skill tags, difficulty, answer framework, evaluation rubric, optional sample outline, safety review state, and usage status. Do not show a single “perfect answer” that encourages copied or fabricated responses.

### Implementation plan

1. Create a curated base question-bank model owned by admin/content staff. Use AI to propose drafts, but require editorial review before global publication.
2. Store question templates separately from generated session questions. Templates are reusable, versioned, taggable, and auditable.
3. Add question categories, role/category mappings, skills, experience bands, language, mode applicability, and quality/review metadata.
4. Build a deterministic selector that chooses a balanced set of questions by category/difficulty; avoid repeatedly asking the same question.
5. Optionally generate a small number of job-specific variants from approved templates and job text; validate factual grounding and retain template linkage.
6. Add candidate controls: save question, mark difficult, retry, hide, report unsafe/irrelevant question, and choose practice categories.
7. Extend the existing admin learning interface or create a dedicated Interview Prep admin area for question authoring, review, publication, retirement, and feedback review.
8. Add content tests for unsafe questions, discriminatory content, prohibited personal/sensitive questions, hallucinated company information, and duplicate questions.

### Acceptance criteria

- The candidate can practice without an AI provider through curated questions.
- Every global question is traceable to a reviewed content version.
- Job-specific variants remain faithful to available job data.

## 4.3 AI Voice Interview

### Description

An AI voice interview simulates spoken interview practice. The interviewer asks a question, the candidate responds aloud, speech is transcribed, and the candidate receives coaching on the response.

### Product decision

Start with **record-and-submit voice answers**, not a full duplex real-time voice agent. This is more reliable on mobile networks, easier to moderate and retry, cheaper to operate, and allows candidates to review the transcript before feedback. Live back-and-forth voice can follow after the core question/feedback model is proven.

### Voice-beta user flow

1. Candidate chooses a prepared question or mock session and sees microphone consent/explanation.
2. Candidate records a response with visible timer, pause/resume, and maximum length.
3. The app uploads encrypted/private audio directly to a candidate-owned practice-audio location using a short-lived signed upload authorization.
4. A background job transcribes the recording.
5. Candidate sees and may correct the transcript before requesting/receiving AI feedback.
6. The system evaluates the transcript against the question rubric and provides coaching.
7. Candidate can delete the recording/transcript or retain it privately for comparison.

### Implementation plan

1. Choose speech-to-text and text-to-speech providers after evaluating India language support, latency, cost, data processing, retention, regional availability, and fallback behavior.
2. Introduce a private audio storage bucket/prefix distinct from candidate documents and real interview recordings. Never reuse employer interview/Zoom storage or access rules.
3. Restrict audio formats, duration, sample rate, and bytes. Perform MIME/signature validation and malware scanning before processing.
4. Create an asynchronous `practice_answer_media`/transcription job state: uploaded, scanning, queued, transcribing, transcript_ready, feedback_ready, failed, deleted.
5. Request clear opt-in before microphone use and state exactly what is stored, how it is used, retention period, deletion action, and that it is not shared with an employer.
6. Offer typed practice and transcript editing as a complete alternative. Never penalize candidates who cannot or do not want to use voice.
7. Enforce session/answer duration caps, file-size caps, quota limits, and automatic cleanup of abandoned uploads.
8. For conversational voice later, use a turn state machine, interruption/retry controls, visible transcript, end-session confirmation, and server-side controls for provider tokens; do not expose speech/AI keys to the browser.

### Acceptance criteria

- The candidate can complete a useful practice session without microphone permission.
- Practice audio is inaccessible to employers and other candidates.
- The candidate can view/correct the transcript and delete practice data.

## 4.4 AI Communication Analysis

### Description

Communication analysis gives feedback on how understandable, structured, relevant, and concise an answer is, based on the candidate’s response and a declared question rubric.

### What to analyse

Use observable, coachable criteria:

- answer relevance to the question;
- structure and completeness (for example STAR for behavioural answers);
- concrete evidence/examples;
- clarity and concision;
- role/skill alignment;
- actionable next improvement;
- for voluntary voice mode only: response duration, long pauses, excessive filler words, and transcript completeness.

### What not to analyse

Do not score accent, vocal pitch, facial expressions, emotion, eye contact, “professional appearance,” gendered communication norms, disability-related speech patterns, personality, honesty, or cultural style. Do not present analysis as an assessment of hiring suitability.

### Implementation plan

1. Create a rubric per question type with criteria, descriptions, weights, and examples of constructive feedback.
2. Use schema-constrained AI output with per-criterion evidence quoted/paraphrased from the candidate’s own response, a bounded score/band, and next-step suggestions.
3. Do not allow the model to infer missing facts. Feedback should say “consider adding an example” rather than claiming the candidate lacks the underlying skill.
4. Add deterministic checks before/alongside AI: response too short, silence/no transcript, answer length, missing STAR components where applicable, and question mismatch.
5. Give the candidate an answer-level result: strengths, one or two priority improvements, suggested outline, and retry action.
6. Store rubric version, model/provider version, prompt version, and confidence/validation state to enable audit/reproducibility.
7. Add report/feedback controls so candidates can flag harmful, inaccurate, or irrelevant coaching. Route reports to a moderated review queue.

### Acceptance criteria

- Feedback is specific enough to improve the next attempt.
- No feedback claims to diagnose a person’s emotions, personality, or employability.
- Candidate feedback/report signals are available for quality monitoring.

## 4.5 AI Confidence Score

### Description

The requested “confidence score” should be reframed as a **Practice Readiness** indicator. A single number that claims to measure psychological confidence from voice/video is not reliable or appropriate for this product.

### Recommended design

Show two separate indicators:

1. **Practice readiness band** — Needs practice / Building / Ready to rehearse, based on transparent answer-quality and completion criteria.
2. **Candidate self-check** — Optional 1–5 question after a session: “How prepared did you feel?” This belongs to the candidate and is never used for employer-facing ranking.

The readiness band may summarize consistency across attempts, coverage of role question categories, answer structure, and completed drills. It should always include “what will improve this” and never promise an interview outcome.

### Implementation plan

1. Define the readiness formula in product/rubric configuration, not in an opaque AI prompt.
2. Start with bands rather than a precise 0–100 score. A band reduces false precision and is easier to explain.
3. Require minimum evidence before showing a band: for example, at least three answered questions across two categories.
4. Weight recent reviewed attempts more than old attempts, but do not erase candidate history.
5. Display the contributing factors: question coverage, answer structure, examples/evidence, role-skill coverage, and planned practice completion.
6. Add a clear disclaimer: “This is coaching feedback for practice; it does not predict whether an employer will hire you.”
7. Exclude readiness from employer-facing data, candidate search, trust scores, job recommendations, and applications.
8. Evaluate whether readiness improvements correlate with candidate-reported usefulness and voluntary completion—not hiring outcomes alone.

## 4.6 Skill Gap Analysis

### Description

Skill gap analysis compares the skills/responsibilities required by a selected role/job with candidate-approved profile evidence and practice performance. It recommends what to practise or learn next.

### Product design

Use three separate labels:

- **Already evidenced:** skills present in the candidate profile/resume or demonstrated in their answer.
- **Practise explaining:** skills likely present but poorly explained in mock answers.
- **Explore/learn:** job-relevant skills with no candidate evidence, presented as learning opportunities—not proof that a candidate is unqualified.

### Implementation plan

1. Reuse canonical skills from the planned JobsKart skills-normalization layer; do not compare raw string lists only.
2. Build a role/job requirement profile from job skills, responsibilities, category, experience, education/licensing, and curated role templates.
3. Build a candidate evidence profile only from candidate-approved fields: skills, experience, education, resume parse results they retained, and practice answer evidence.
4. Match using canonical skill IDs/aliases and confidence thresholds. Keep source links for every displayed gap/evidence item.
5. Generate recommendations from curated learning resources and drills first; use AI only to personalize explanation, not to invent courses or certifications.
6. Let the candidate mark a gap “not relevant,” “I have this skill,” or “learn later,” and use that feedback to improve future plans.
7. Never expose the gap analysis to employers without a new, explicit product/consent/legal design.

### Acceptance criteria

- A displayed gap can be traced to a job/role requirement and an absence of candidate-approved evidence.
- The feature offers a specific drill, question, or learning resource for each priority gap.

---

# 5. User experience specification

## 5.1 Entry points

1. **Scheduled interview card:** “Prepare for this interview” appears only to the candidate who owns the interview.
2. **Application page:** Show “Practice before your interview” once application status is shortlisted/interview.
3. **Job detail/application confirmation:** “Prepare for this role” with generic or job-specific preparation.
4. **Candidate navigation:** Add “Interview prep” in the candidate shell after MVP is enabled.
5. **Dashboard:** Display one compact CTA only when it is relevant; do not overload the dashboard.

## 5.2 Primary screens

| Screen | Purpose | Key controls |
|---|---|---|
| Prep home | Resume past sessions or begin role/job prep | select context, quick practice, full mock, question bank |
| Preparation brief | Explain role/job focus and practice plan | edit focus, remove profile context, choose duration/mode |
| Question bank | Explore/learn questions without scoring pressure | category, difficulty, save, answer framework, practise |
| Mock setup | Confirm privacy and choose text/voice/language | question count, time limit, microphone consent |
| Mock interview | Ask one question at a time | answer, pause, skip, repeat, finish early, report issue |
| Transcript review | Correct speech recognition before feedback | edit transcript, delete recording, request feedback |
| Results | Give answer feedback and readiness | retry question, save plan, open learning resource |
| Progress | Show private practice history | trends, completed drills, weak categories, delete history |

## 5.3 Accessibility and inclusion requirements

- Full text-only route with identical question/feedback quality.
- Keyboard navigation, focus management, screen-reader labels, captions/transcripts, and color-independent feedback.
- No requirement to enable camera, microphone, or audio playback.
- Adjustable timers and “extra time” mode.
- Plain-language feedback, avoiding grammar shaming and accent bias.
- English MVP; Hindi and mixed Hindi-English must be separately validated before rollout rather than assumed to work.

---

# 6. Technical architecture

## 6.1 Recommended high-level architecture

```text
Candidate UI
  ├─ Candidate-owned prep routes / React Query state
  ├─ Text response or opt-in audio capture
  └─ Shows structured feedback and learning links
             |
TanStack server functions / secure API boundary
  ├─ Resolve candidate-owned role/job/interview context
  ├─ Enforce quota, consent and authorization
  ├─ Create session and answer jobs
  └─ Request structured AI feedback through existing provider adapter
             |
Supabase Postgres + RLS
  ├─ Question bank, templates, sessions, answers, feedback, progress
  ├─ Outbox/job states and audit records
  └─ Candidate-only policies; admin content-management policies
             |
Private Storage + asynchronous workers
  ├─ Optional practice audio quarantine / clean storage
  ├─ Speech-to-text job
  └─ AI feedback job / retry / cleanup
```

## 6.2 Data model proposal

Names are illustrative; final schema should be designed in migrations after reviewing actual workflow and data retention requirements.

| Entity | Purpose | Essential fields |
|---|---|---|
| `interview_prep_question_templates` | Curated, reusable questions | id, role/category/skills, question text, type, difficulty, answer framework, rubric version, language, status, created/reviewed by |
| `interview_prep_question_variants` | Optional job-specific generated variants | template ID, job ID/context hash, text, grounding/source, generation version, review state, expires at |
| `interview_prep_sessions` | One candidate’s private practice run | id, candidate user ID, context type/id, mode, language, status, started/finished, context snapshot/version, consent snapshot |
| `interview_prep_session_questions` | Ordered questions in a session | session ID, template/variant ID, position, question snapshot, rubric snapshot, skipped/retried state |
| `interview_prep_answers` | Typed response or transcript metadata | session question ID, answer text, source type, duration, submitted at, feedback status, deleted at |
| `interview_prep_media` | Optional private voice media record | answer ID, private object path, MIME/bytes/duration, scan/transcription state, retention/delete timestamps |
| `interview_prep_feedback` | Structured answer/session feedback | answer/session ID, rubric/model/prompt versions, criteria JSON, strengths, improvements, outline, readiness evidence, moderation/report state |
| `interview_prep_learning_links` | Curated gap → learning/drill mapping | role/skill/question category to `learning_resources`/drill, rank, active status |
| `interview_prep_reports` | Candidate quality/safety reports | feedback/question/session ID, reporter, category, details, resolution/audit state |
| `interview_prep_usage_ledger` | Quota/cost/audit facts | candidate, day/window, session/voice minutes/AI usage, outcome, idempotency key |

## 6.3 Authorization and RLS model

1. Candidates can select, create, read, update, and delete only their own sessions, answers, media records, feedback, progress, and reports.
2. Candidates may use a job context only when it is public/applicable under the normal job access rules; candidate interview context must be their own interview/application.
3. Employers receive no read access to any practice tables, media, transcript, feedback, or readiness data.
4. Admin/content staff can manage global question templates and learning mappings but should not browse private candidate answers/audio by default.
5. Moderators may access the minimum information needed to resolve a candidate report, with an auditable, role-gated workflow.
6. New public-schema tables require RLS, narrow grants, ownership predicates, and both `USING` and `WITH CHECK` clauses for updates.
7. Privileged RPCs/server functions must validate `auth.uid()`, use explicit execution grants, avoid exposing service-role credentials, and use a restricted SQL `search_path`.

## 6.4 AI and speech integration design

1. Reuse `src/lib/ai/provider.ts` as the sole model-provider boundary. Do not introduce model URLs/API keys in UI files.
2. Every AI response must be schema-validated with Zod. Invalid/unsafe output should fall back to a deterministic coaching response or ask the candidate to retry.
3. Separate tasks by cost/risk:
   - low-cost deterministic question selection;
   - structured brief generation;
   - structured answer feedback;
   - optional speech-to-text;
   - optional text-to-speech/live conversation later.
4. Send the smallest necessary context. Use job requirements, selected role, question/rubric, and candidate-approved highlights; do not send unrelated profile fields or raw documents by default.
5. Store model/provider, prompt/template version, schema version, token/audio-duration usage, latency, and failure category for each generated artifact.
6. Use low temperature and rubric-constrained JSON for evaluative feedback; distinguish factual extraction from coaching generation.
7. Add prompt-injection defenses: job/resume/candidate text is untrusted content, not system instruction. Delimit it and instruct the model not to follow instructions embedded in user-provided text.

## 6.5 Asynchronous processing and reliability

1. Session creation and answer submission must be fast. Long-running transcription/feedback should become background jobs with visible status.
2. Use idempotency keys for answer upload, transcription, and feedback generation to prevent double billing or duplicate records.
3. Add retry classes: retryable provider/network failures, safe validation fallback, user-action-required errors, and terminal moderation/security errors.
4. Add a dead-letter/audit view for failed jobs, with non-sensitive error reasons and replay controls.
5. Preserve an AI-independent path: question bank and deterministic answer frameworks work during provider outage.

---

# 7. Privacy, safety, and responsible-AI requirements

## 7.1 Consent and data separation

- Explain before first use that practice sessions are private and not shared with employers.
- For voice, separately explain audio/transcript processing, provider involvement, retention, deletion, and optional use for product improvement—each choice must be explicit.
- Do not collect video in initial releases.
- Do not use practice data for candidate ranking, application decisions, advertising audiences, or training models unless an explicit, separate, revocable consent policy is approved.
- Give candidates self-service delete controls for sessions, transcripts, and audio; document what is deleted immediately versus queued for backup deletion.

## 7.2 Feedback safeguards

1. Clearly label all AI output as coaching suggestions that may be imperfect.
2. Prohibit questions about protected/sensitive personal data unless the candidate voluntarily chooses a compliant accommodation/preparation path.
3. Filter generated questions/feedback for discriminatory, abusive, sexually inappropriate, illegal, self-harm, or manipulative content.
4. Avoid instructions to embellish, conceal, or fabricate qualifications.
5. Make reported feedback reviewable and allow content/model prompt changes to be rolled back.
6. Include a support path for accessibility accommodations and transcription issues.

## 7.3 Confidence/readiness safeguards

- No face, tone, emotion, eye contact, accent, personality, or honesty score.
- No employer visibility or use in candidate recommendation/trust/ranking.
- Use transparent evidence-based readiness bands and optional self-reflection only.
- Do not market the tool as guaranteeing a job or predicting selection.

---

# 8. Delivery plan

## Phase 0 — Product, safety, and content foundation

1. Approve scope, non-goals, privacy language, retention rules, and employer-data separation.
2. Define role taxonomy, question categories, question rubrics, readiness bands, and prohibited content.
3. Prepare an initial reviewed question bank for JobsKart’s highest-volume role categories.
4. Decide English MVP and define Hindi/code-switching research/testing plan.
5. Define quotas, cost ceiling, provider fallback, success metrics, and moderation/support operating model.

**Exit criteria:** Approved product requirements, question rubric, privacy/consent copy, data retention policy, and initial content inventory.

## Phase 1 — Text-based MVP

1. Add candidate Interview Prep route/navigation and entry from a candidate-owned scheduled interview/application.
2. Implement role/job context resolver and candidate-owned prep brief.
3. Implement curated question-bank browse/select experience.
4. Implement short typed mock sessions with session state, skip/retry, and saved progress.
5. Implement structured answer feedback through existing server-only AI adapter, Zod schema validation, quota ledger, and deterministic fallback.
6. Implement readiness bands and skill-gap links to existing learning resources.
7. Add candidate deletion, reporting, basic admin question management, and instrumentation.

**Exit criteria:** A candidate can privately complete a typed, role-specific mock, receive transparent feedback, retry weak answers, and open a related learning resource.

## Phase 2 — Quality, learning, and interview linkage

1. Add scheduled-interview prep plan based on days remaining and actual interview mode.
2. Add practice reminders through the notification preference/orchestration system, with strict frequency caps.
3. Add curated drills for STAR answers, introductions, role-specific examples, and candidate questions to ask.
4. Add practice-history/progress screen and candidate feedback/report workflow.
5. Build admin content review/versioning and analytics dashboard for question quality, completion, safety reports, and usefulness.

**Exit criteria:** The feature produces a repeatable preparation loop, not a one-off AI chat.

## Phase 3 — Opt-in voice beta

1. Build private audio capture/upload, file validation/quarantine, asynchronous transcription, transcript review/editing, and deletion lifecycle.
2. Add voluntary voice metrics limited to duration, transcript completeness, pause/filler-word patterns, and answer pacing; never infer emotion/personality.
3. Add speech-provider monitoring, quotas, failed-job replay, and consent/retention controls.
4. Run a limited beta with explicit feedback collection and accessibility testing.

**Exit criteria:** Voice practice is reliable, private, cost-controlled, and not required for access to feedback.

## Phase 4 — Conversational voice and personalisation

1. Add turn-by-turn AI interviewer with explicit state machine and visible transcript.
2. Add follow-up questions only when grounded in the candidate’s answer/job context and within rubric boundaries.
3. Add Hindi/English language support after separate quality evaluation.
4. Add spaced repetition and personalised drills based on candidate-approved practice history.
5. Evaluate model/rubric quality continuously with human-reviewed, privacy-safe samples where consent permits.

---

# 9. Metrics and evaluation

## 9.1 Product metrics

- Prep entry rate from scheduled interviews/applications.
- Brief generation success/latency.
- Question-bank start/completion/retry rate.
- Mock session completion and median duration.
- Feedback usefulness rating and safety-report rate.
- Learning-resource click/completion after identified gap.
- Voluntary voice adoption, transcription accuracy correction rate, and deletion rate.
- Repeat practice before actual interview.

## 9.2 Quality metrics

- Invalid AI JSON/schema failure rate.
- Hallucinated job/company/candidate fact report rate.
- Duplicate/irrelevant question rate.
- Feedback agreement with rubric reviewers.
- Disparity checks across language, role category, candidate experience level, and typed versus voice mode.
- Provider latency, error rate, cost per completed session, and quota-block rate.

## 9.3 Outcome measurement

Use candidate-reported usefulness and practice completion as primary early success measures. Later, analyze voluntary correlations with interview attendance or progression cautiously; do not claim causation or use outcomes to punish/score candidates.

---

# 10. Testing strategy

## Unit tests

- Context resolution and ownership checks.
- Question selection balance/no duplicate rules.
- Readiness formula and minimum-evidence rules.
- Skill-gap canonical mapping and learning-resource selection.
- Zod schemas for prep brief, question variants, answer feedback, and reports.
- Quota/idempotency logic and deletion state transitions.

## Integration tests

- Candidate can access only their own sessions/answers/feedback/media.
- Employer cannot query or access any practice object, even for their applicant.
- Candidate cannot use another candidate’s interview/application ID as prep context.
- AI/provider failure returns a safe actionable response and leaves the session usable.
- Audio upload/transcription lifecycle enforces file/ownership validation.
- Deleted data becomes unavailable through UI and signed URLs.

## Content and safety evaluation

- Curated test set across high-volume JobsKart roles and experience levels.
- Test for fabricated achievements, discriminatory prompts, unsafe questions, irrelevant feedback, poor Hindi/code-switching handling, and prompt injection attempts.
- Human rubric review before public launch and after material prompt/model changes.

## End-to-end tests

1. Candidate opens their upcoming interview and starts text prep.
2. Candidate completes mock answers, sees validated feedback, retries a weak question, and reaches a learning resource.
3. Candidate deletes session history.
4. Employer is unable to access that candidate’s prep artifacts.
5. Voice-beta candidate records, reviews transcript, receives feedback, and deletes audio.

---

# 11. Priority backlog

| Priority | Item | Why it comes first |
|---|---|---|
| P0 | Approve privacy/non-sharing policy and ban biometric confidence scoring | Prevents the feature becoming an employer surveillance or biased assessment tool. |
| P0 | Curated role question bank and rubrics | Gives a useful AI-independent foundation and controls content quality. |
| P0 | Candidate-owned text mock sessions and structured feedback | Delivers the core value at lowest reliability/cost/accessibility risk. |
| P0 | RLS/data separation, quotas, audit and deletion controls | Practice content is sensitive candidate data. |
| P1 | Interview/job-linked prep briefs and learning-resource mapping | Makes the feature distinctly valuable inside JobsKart. |
| P1 | Admin content review/versioning and quality reporting | Required to scale question and feedback quality. |
| P2 | Opt-in record-and-submit voice practice | Adds spoken rehearsal while retaining a safe fallback. |
| P2 | Reminder/progress loop and spaced repetition | Improves repeat use after core experience is proven. |
| P3 | Real-time conversational voice and multilingual expansion | Higher cost/complexity; should follow validated voice beta. |

# 12. Final launch checklist

- Candidate practice is clearly private and employer-inaccessible by design and test.
- Text practice works completely without microphone/camera.
- Voice use has clear opt-in, transcript review, retention, and deletion controls.
- No facial/emotion/personality/accent/hiring-prediction score exists.
- All feedback is structured, rubric-grounded, versioned, and reportable.
- Question-bank content is reviewed and has an AI-independent fallback.
- AI and speech provider keys are server-only; no secret appears in client code.
- New database tables have RLS, least-privilege grants, ownership tests, and explicit policies.
- Quotas, idempotency, monitoring, failure handling, and cost dashboard are active.
- Accessibility, English quality, and planned Hindi/code-switching support have been tested before the relevant rollout.
- Practice feedback is never included in candidate search, job matching, trust scoring, employer review, or hiring decisions.


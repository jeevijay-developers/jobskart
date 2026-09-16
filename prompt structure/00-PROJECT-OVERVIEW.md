# JobsKart — Project Overview & Scope

**Repo:** `github.com/jeevijay-developers/jobskart`
**Stage:** Pre-launch. No production users. Test data only.
**Stack:** TanStack Start + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase (currently on Lovable Cloud).
**Build strategy:** Continue building on Lovable through P0. Migrate to Jeevijay's own Supabase before real data enters.

---

## 1. What JobsKart is

A blue/grey-collar job marketplace positioned against Apna. Three actors:

| Actor | Portal | Core loop |
|---|---|---|
| Candidate | `/candidate/*` | Onboard → build profile → discover jobs → apply → track |
| Employer | `/employer/*` | Verify company → post job → receive responses → search DB → unlock → hire |
| Platform Admin | `/admin/*` | Masters, plans, credits, verifications, banners, moderation |

Revenue: employer-side. Plans + credit packs (Razorpay), consumed by job tiers, boosts, and candidate DB unlocks.

---

## 2. What already exists

Built and working (do not rebuild):

- 47 tables, 28 versioned migrations, RLS on all user-facing tables
- Employer org model: `companies`, `employer_members`, `employer_invites`, `employer_role` enum (`super_admin` / `hr_admin` / `recruiter`)
- Security-definer helpers: `has_company_membership()`, `has_company_role()`, `has_platform_role()`, `unlock_candidate()`, `accept_invite()`, `remove_member()`, `log_employer_activity()`
- Credits: `employer_credit_wallets`, `credit_transactions`, `credit_packs`, `apply_credit_delta()`
- Billing: `plans`, `plan_settings`, `razorpay_orders`, `invoices`, `invoice_counters`, `issue_credit_pack_invoice()`
- Candidate: 5-step onboarding wizard, resume parsing, profile strength, applications, saved jobs, alerts, interviews, documents
- Employer: 4-step posting wizard, jobs list, applicants, responses, database search, team, activity, reports, verification
- Admin: dashboard, users, companies, jobs, plans, credits, masters, verifications, resumes, banners, learning
- An MCP server exposing 7 tools (`search-jobs`, `get-job`, `my-profile`, `my-applications`, `my-saved-jobs`, `my-company-jobs`, `job-applicants`)

---

## 3. What is missing (drives P0)

| Gap | Evidence |
|---|---|
| Job tiers Classic / Classic+ / Trending | No tier column. `job_type` is employment type (full_time etc.), not tier |
| Boost engine | Only a bare `jobs.boosted_until` timestamp. No credit consumption, no same-day rule, no multi-boost, no decay |
| Job-scoped unlock inventory | `candidate_unlocks` is company-wide credit-priced; deck specifies 25 per job |
| DB search gating | Deck: search only with a live job selected; no search on expired/paused |
| 60-day response purge | Not implemented |
| JD auto-generation | Template docs exist; no engine |
| Employer verification APIs | `company_verifications` + `kyc_status` exist; GST/CIN/Aadhaar providers not wired |
| Ranking / feed ordering | `matching.ts` scores client-side in the browser — wrong side of the trust boundary for recruiter-facing ranking |
| Candidate onboarding bugs | 24-June client list, all open |

---

## 4. Scope tiers

### P0 — build now, before migration
1. Candidate onboarding bug fixes (24-June list)
2. Job posting flow restructure (page reorder, industry, gender, monthly-salary→CTC, pay types, interview block, manual perks, joining fee)
3. JD auto-generation engine (deterministic, not LLM)
4. Job tiers + plan entitlements
5. Boost engine
6. Server-side ranking & feed ordering
7. DB access model (job-gated search, unlock inventory, server-only unlock)
8. 60-day response purge + advance notice
9. Employer verification (GST / CIN / Aadhaar)
10. RBAC enforcement gaps + activity tracker completion
11. Recommended profiles: broadening ladder + candidate tags
12. Admin controls for all of the above

### P1 — post-launch conversion work (no schema risk)
Smart skill chips, city+role salary suggestions, conditional forms, job quality score, WhatsApp opt-in defaults, multilingual UI (Hindi + regional), drop-off analytics, AI resume builder.

### P2 — deferred, seams designed now
AI voice interview + confidence scoring, certification marketplace, employer CRM, LinkedIn import, Elasticsearch/Algolia (Postgres FTS + pgvector carries well past launch), referral & rewards.

---

## 5. Two client requests we are deliberately reshaping

**Slide 18 — "Recruiter Psychology Strategy."** The deck asks to make recruiters *feel* AI is working, with recommendations that shuffle to create curiosity. Shuffling results that have not actually changed, next to a paid unlock button, is a dark pattern and a refund risk. We implement **genuine** freshness: recency-weighted scoring, new-candidate injection, real "N new candidates matched since your last visit" counts. It feels active because it is active.

**Slide 20 — "Never show No Candidates Found."** Implemented as a **staged broadening ladder with the stage labelled** (see `matching.md`). Recruiters are never shown a dead end, and never shown a padded result pretending to be a match.

---

## 6. Document map

| File | Purpose |
|---|---|
| `architecture.md` | System structure, layers, portability rules, security boundaries |
| `schema.md` | Current schema inventory + all P0 DDL |
| `design.md` | Design system, screen inventory, UX rules per flow |
| `monetization.md` | Tiers, boosts, credits, unlock economics |
| `rbac.md` | Roles, action matrix, edge cases, activity tracking |
| `jd-engine.md` | Deterministic JD auto-generation spec |
| `matching.md` | Relevancy scoring, ranking, broadening ladder, tags |
| `migration.md` | Lovable exit + move to own Supabase |
| `prompts/` | Sliced, copy-paste-ready Lovable prompts (P0-00 … P0-12) |

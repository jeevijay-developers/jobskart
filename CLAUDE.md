# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

JobsKart — a blue/grey-collar job marketplace (Apna-style) with three portals: Candidate, Employer, Platform Admin. Revenue is employer-side: plans + Razorpay credit packs consumed by job tiers, boosts, and candidate DB unlocks. Currently built on **Lovable** (Lovable Cloud Supabase + Lovable AI gateway); the codebase is written to be portable off Lovable before real user data enters (see `prompt structure/migration.md`).

Stack: TanStack Start + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase.

## Commands

```
bun install        # package manager is bun (bun.lock is authoritative; ignore package-lock.json)
bun run dev        # vite dev server
bun run build      # vite build (Nitro server output)
bun run build:dev  # vite build --mode development
bun run preview    # preview a production build
bun run lint       # eslint .
bun run format     # prettier --write .
```

There is no test script/runner configured in this repo (no `test` entry in `package.json`, no vitest/jest config). Don't assume one exists.

Supabase CLI is linked (`supabase/config.toml`, `supabase/.temp/`) — use `supabase migration new <name>` to scaffold a new migration file rather than hand-naming one, but see the schema rule below before writing DDL.

## Architecture

```
Browser (React 19 + TanStack Router)
        │
        ├── TanStack Start server functions  ← src/lib/*.functions.ts
        │        ├── Supabase JS (user JWT)      → RLS-enforced reads/writes
        │        ├── Supabase JS (service role)  → privileged ops
        │        └── ai.gateway.lovable.dev → Gemini  ⚠ Lovable-coupled, must go through src/lib/ai/provider.ts
        │
        ├── Supabase JS direct from browser (user JWT) → RLS-enforced
        └── Lovable Cloud Auth shim  ⚠ Lovable-coupled (src/integrations/lovable/)
                 └── Supabase Auth (Lovable's project)
```

| Layer | Location | Notes |
|---|---|---|
| Routes | `src/routes/**` (file-based, TanStack Router) | `_authenticated/{admin,employer,candidate,onboarding}` gate each portal |
| Server functions | `src/lib/*.functions.ts` | `createServerFn` — portable, NOT Supabase Edge Functions |
| Pure logic (no I/O, unit-testable) | `src/lib/{matching,jd-template,jd-library,profileStrength,validators,options}.ts` | |
| DB access | `src/integrations/supabase/{client,client.server}.ts` | Generated — do not hand-edit |
| Auth shim | `src/integrations/lovable/index.ts` | Generated; deleted at migration off Lovable |
| Database | `supabase/migrations/*.sql` | RLS + `SECURITY DEFINER` RPCs on every user-facing table |
| MCP server | `src/lib/mcp/**`, `src/routes/[.mcp]/**` | Exposes 7 tools: `search-jobs`, `get-job`, `my-profile`, `my-applications`, `my-saved-jobs`, `my-company-jobs`, `job-applicants` |
| Webhooks | `src/routes/api/public/webhooks/razorpay.ts` | HMAC signature-verified |

`supabase/functions/` is intentionally empty — all server logic lives in TanStack server functions, not Edge Functions. Keep it that way; it's what keeps the backend portable.

## Standing rules (from `prompt structure/architecture.md` and `P0-00-ground-rules.md`)

These are load-bearing, not stylistic — enforce them on every change that touches money, auth, or AI:

1. **All AI calls go through `src/lib/ai/provider.ts`.** No other file may contain a provider URL or model name. `PROVIDER`/`MODEL` are read from `AI_PROVIDER`/`AI_MODEL` env vars (`lovable | gemini | openai`). Files that call AI today: `resume.functions.ts`, `ai-shortlist.functions.ts`, `matching.functions.ts`.
2. **Money and access logic lives in Postgres, never in server functions or React.** Credit deduction, unlock grants, boost consumption, plan-entitlement checks: all inside `SECURITY DEFINER` functions with `SET search_path = public` and row locks (`SELECT ... FOR UPDATE`). Reason: two browser tabs can double-spend a credit; only a DB-level row lock prevents it.
3. **Locked candidate data (phone, email, resume URL) must never reach the frontend** until an unlock row exists. Enforce by excluding the columns in SQL (a masked-column RPC), never by hiding fields in React — assume every network response is inspected.
4. **Recruiter-facing ranking is server-side.** `src/lib/matching.ts` client-side scoring exists **only** for the candidate's own "match %" badge (harmless, instant, uses only their own data). Any ranking of *other people's* data (candidate DB search, feed ordering) must be a DB function so scoring weights aren't shippable to a paying user.
5. **Schema changes land only as new files in `supabase/migrations/`.** Never modify an existing migration file; never change schema through the Lovable UI without a migration file capturing it. Use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / guarded `DO $$ ... END $$` so migrations are re-runnable.
6. **Every privileged action writes to `employer_activity`** (job created, candidate unlocked, boost applied, candidate contacted, DB search run) — inside the same transaction as the action, via trigger where possible.
7. **No third-party failure blocks a core flow.** Resume parse fails → manual form. Verification API down → queue for admin review. AI down → deterministic JD template still works.
8. **Before building anything, check it doesn't already exist.** Reusable helpers: `has_company_membership()`, `has_company_role()`, `has_platform_role()`, `user_companies()`, `apply_credit_delta()`, `unlock_candidate()`, `log_employer_activity()`, `accept_invite()`, `remove_member()`, `slugify()`, `tg_set_updated_at()`.

## Roles & access control

Two independent, non-overlapping role systems (`prompt structure/rbac.md`):
- **Platform roles** — `platform_roles` table, `app_platform_role` enum (`super_admin`). JobsKart staff, admin portal.
- **Company roles** — `employer_members` table, `employer_role` enum (`super_admin`, `hr_admin`, `recruiter`). A user can hold different roles across different companies; role is a property of the membership row, not the user.

Every privileged RPC checks role in Postgres (`has_company_role(auth.uid(), _company_id, ARRAY[...])`), never trusting role held in React state or a client-sent `company_id`. Use stable error-code strings (`insufficient_permissions`, `no_credits`, `job_not_active`, `allowance_exhausted`, `boost_same_day`) so the UI maps them to messages instead of showing raw Postgres errors.

## Monetization model (see `prompt structure/monetization.md`, `schema.md`)

- **Job tiers**: `classic` / `classic_plus` / `trending` (`jobs.tier`, `job_tier` enum) — this is distinct from `job_type` (employment type: full_time/part_time/etc.). Classic+ is a *reusability* product (repost allowance), not a visibility product — it does not rank higher than Classic. Trending is the visibility product.
- **Boost engine**: `job_boosts` table, one boost per job per calendar day (IST), decays linearly over its window rather than a flat bonus — a boosted job can't sit stale at the top. `jobs.boosted_until` is a denormalized cache of `max(ends_at)`, maintained by trigger; never write it directly.
- **Candidate DB unlocks**: hybrid model — job-scoped allowance (`job_unlock_allowance`, 25 per job per the client deck) checked first, company-wide credit wallet (`employer_credit_wallets`) as fallback. Repeat unlocks of the same candidate by the same company are free (prevents double-charging across recruiters on the same account).
- **Response retention**: 60-day purge of candidate responses, with advance notice to the employer (not yet implemented — P0 item).
- Ranking formula (feed and recruiter-candidate search) lives in `match_scoring_config`, admin-editable — weights: skills overlap 60, location 20, experience fit 15, salary overlap 5, plus tier/boost/freshness bonuses for feed ranking. See `prompt structure/matching.md` for the full formula; don't re-derive it from `matching.ts` alone, that file is the client-side subset only.

## Two deliberate reshapes of client asks

These came out of the client's requirement decks but are implemented differently on purpose — don't "fix" them back to the literal deck wording:
- **"Make recruiters feel AI is working" / shuffle results for curiosity"** → implemented as *genuine* freshness (recency-weighted scoring, new-candidate injection, real "N new candidates since your last visit" counts), not randomized reordering of unchanged results. Shuffling static results next to a paid unlock button is a dark pattern / refund risk.
- **"Never show No Candidates Found"** → implemented as a staged broadening ladder with the current stage labelled to the recruiter, never a padded result pretending to be a match.

## Data flow: the three P0 flows that matter

**Post a job**: `jobs.new.tsx` wizard (autosaved as `status='draft'`) → `create_job_with_tier()` RPC validates plan entitlement + live-job cap, deducts tier cost, inserts job, seeds `job_unlock_allowance`, trigger writes `employer_activity`.

**Search + unlock a candidate**: `database.tsx` requires an active job selected → `search_candidates(job_id, filters)` RPC verifies job is `active` + caller membership, returns masked rows ranked by relevancy → Unlock click → `unlock_candidate(job_id, candidate_user_id)` RPC row-locks allowance, falls back to wallet, inserts idempotent `candidate_unlocks` row, returns full contact row.

**Boost a job**: `jobs.tsx` → `apply_boost(job_id)` RPC checks job wasn't created today, checks boost credits, inserts `job_boosts` row with window, deducts credits, logs activity.

## Third-party surface

| Service | Used for | Failure mode |
|---|---|---|
| Razorpay | Credit packs, plans | Webhook retries; `razorpay_orders` table is source of truth |
| WhatsApp Business API | Alerts, notifications | `whatsapp_send_ledger` caps sends per post |
| GST / MCA / Aadhaar APIs | Employer verification | Falls back to manual admin review |
| AI provider (via `src/lib/ai/provider.ts`) | Resume parsing, shortlist, JD assist | Must degrade to manual entry, never block onboarding |

## `prompt structure/` — how to use it

This folder holds the system design docs and a set of 13 sliced Lovable prompts (`P0-00` through `P0-12`) used to drive Lovable chat sessions. Read `00-PROJECT-OVERVIEW.md` first for scope; consult the topic doc when touching that area:

| Doc | Read it when |
|---|---|
| `architecture.md` | Making any structural or security decision |
| `schema.md` | Writing a migration — current table inventory + all P0 DDL |
| `design.md` | Building any screen — design tokens, screen inventory, UX rules per flow |
| `monetization.md` | Touching tiers, boosts, credits, or unlocks |
| `rbac.md` | Touching permissions or membership |
| `jd-engine.md` | Building/touching JD auto-generation (deterministic, not LLM — AI polish is P1 and may not alter figures or add responsibilities) |
| `matching.md` | Touching scoring, ranking, or recommendations |
| `migration.md` | Moving off Lovable to Jeevijay's own Supabase project |
| `P0-00-ground-rules.md` … `P0-12-*.md` | The actual Lovable prompts, one feature slice each, meant to be sent one at a time and verified against their acceptance checklist before advancing |

`Jobskart docs/` (note: separate from `prompt structure/`) holds the original client requirement documents as Office files (candidate bug list, JD templates, posting-flow deck, product-flow decks) that `prompt structure/` was derived from — Office binaries, not directly readable as text; treat `prompt structure/` as the authoritative distillation of them.

## Repo-specific gotchas

- `README.md` is not developer setup docs — it's the full historical Lovable prompt script (Phase 1 onward) used to originally build the UI. Don't confuse it with `prompt structure/00-HOW-TO-USE.md`, which governs the *current* P0 prompts.
- `vite.config.ts` is intentionally minimal: `@lovable.dev/vite-tanstack-config` already bundles TanStack Start, React, Tailwind, path aliases, and dedupe config. Do not re-add any of those plugins manually — the comment in the file lists exactly what's already included.
- `bun.lock` is authoritative; `package-lock.json` also exists but bun is the actual package manager (`bunfig.toml` enforces a 24h supply-chain release-age guard on installs).
- `AGENTS.md` at the repo root is a Lovable sync notice, not a Claude Code agents file — it warns against rewriting published git history because Lovable syncs from the connected branch. Per `migration.md`, delete it once disconnected from Lovable.
- `.env` is correctly gitignored (verified via `git ls-files`) — `.env.example` documents the required keys (`SUPABASE_*`, `VITE_SUPABASE_*`, `AI_PROVIDER`, `AI_MODEL`, `LOVABLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`).

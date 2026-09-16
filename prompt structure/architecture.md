# JobsKart — Architecture

## 1. Current state (as built on Lovable)

```
Browser (React 19 + TanStack Router)
        │
        ├── TanStack Start server functions  ← src/lib/*.functions.ts
        │        │
        │        ├── Supabase JS (user JWT)      → RLS-enforced reads/writes
        │        ├── Supabase JS (service role)  → privileged ops
        │        └── ai.gateway.lovable.dev      → Gemini 2.5 Flash  ⚠ Lovable-coupled
        │
        ├── Supabase JS direct from browser (user JWT)  → RLS-enforced
        └── Lovable Cloud Auth shim  ⚠ Lovable-coupled
                 │
                 └── Supabase Auth (Lovable's project)
```

**Layer inventory**

| Layer | Location | Notes |
|---|---|---|
| Routes | `src/routes/**` | File-based. `_authenticated/` guards admin/employer/candidate |
| Server functions | `src/lib/*.functions.ts` | `createServerFn` — portable, not Edge Functions |
| Pure logic | `src/lib/{matching,jd-template,jd-library,profileStrength,validators,options}.ts` | No I/O — unit-testable |
| DB access | `src/integrations/supabase/{client,client.server}.ts` | Generated; do not hand-edit |
| Auth shim | `src/integrations/lovable/index.ts` | Generated. Replaced at migration |
| Database | `supabase/migrations/*.sql` | 28 migrations, RLS + security-definer RPCs |
| MCP | `src/lib/mcp/**`, `src/routes/[.mcp]/**` | 7 tools |
| Webhooks | `src/routes/api/public/webhooks/razorpay.ts` | Signature-verified |

`supabase/functions/` is **empty** — there are no Edge Functions. All server logic is TanStack server functions. This is good for portability and should stay that way.

---

## 2. Target state (after migration)

Identical, minus two boxes:

- `ai.gateway.lovable.dev` → direct provider (Gemini or OpenAI), behind an adapter
- Lovable Cloud Auth → native Supabase Auth (phone OTP + Google OAuth)
- Lovable's Supabase project → Jeevijay's Supabase project
- Hosting: Lovable preview → Vercel / Netlify / self-hosted Node (TanStack Start builds to a Nitro server)

Nothing else changes. That is the point of the rules below.

---

## 3. Standing rules (enforce from today)

### R1 — All AI calls go through one adapter
Create `src/lib/ai/provider.ts`. Every AI call imports from it. No file other than this one may contain a provider URL or model name.

```ts
// src/lib/ai/provider.ts
type ChatArgs = { system?: string; user: string; images?: {mime:string;b64:string}[]; json?: boolean };

const PROVIDER = process.env.AI_PROVIDER ?? "lovable";       // lovable | gemini | openai
const MODEL    = process.env.AI_MODEL    ?? "google/gemini-2.5-flash";

export async function chat(args: ChatArgs): Promise<string> { /* switch(PROVIDER) */ }
export async function chatJSON<T>(args: ChatArgs, schema: ZodType<T>): Promise<T> { /* parse + validate */ }
```

Refactor targets today: `resume.functions.ts`, `ai-shortlist.functions.ts`, `matching.functions.ts`.
**Migration cost of this rule: one file. Without it: every AI file, forever.**

### R2 — Money and access logic lives in the database
Credit deduction, unlock grants, boost consumption, tier entitlement checks: all inside `SECURITY DEFINER` Postgres functions with row locks. Never in server functions, never in the client.

Reason: server functions can be called concurrently. Two tabs clicking Unlock at once must not spend one credit twice. `SELECT ... FOR UPDATE` inside a DB function is the only place that is safe.

### R3 — Locked data never reaches the frontend
A candidate's phone, email, and resume URL must not appear in any API response until an unlock row exists. Enforce at the **query** level (a `get_public_candidate()`-style RPC returning masked columns), not by hiding fields in React. Assume every network response is inspected.

### R4 — Ranking is server-side
`src/lib/matching.ts` scores in the browser. Keep it **only** for the candidate's own "match %" badge on job cards (harmless, and instant). All recruiter-facing candidate ranking moves to a DB function so scoring weights and candidate attributes are never shipped to a paying user who could reverse-engineer or scrape them.

### R5 — Schema changes are migration files only
Never change schema through the Lovable UI without the migration landing in `supabase/migrations/`. The migration folder is the *only* artifact that survives the move to your own Supabase.

### R6 — No secrets in the repo
`.env` is currently committed and absent from `.gitignore`. Today: add `.env` to `.gitignore`, `git rm --cached .env`, commit `.env.example` with keys only. Only publishable keys are exposed right now, but a service-role key will exist soon and the habit must be fixed before then.

### R7 — Every privileged action writes to `employer_activity`
Job created, candidate unlocked, boost applied, candidate contacted, DB search run. Write inside the same transaction as the action, via trigger where possible.

---

## 4. Trust boundaries

| Boundary | Enforced by | Never trust |
|---|---|---|
| Candidate ↔ own profile | RLS on `candidate_*` tables keyed to `auth.uid()` | Client-sent user id |
| Recruiter ↔ company data | `has_company_membership()` in RLS `USING` clauses | Client-sent `company_id` |
| Role permissions | `has_company_role()` inside RPCs | Role held in React state |
| Locked candidate PII | Masked-column RPC + unlock row check | Frontend conditional rendering |
| Credit balance | `apply_credit_delta()` with row lock | Client-computed balances |
| Platform admin | `has_platform_role()` + `platform_roles` table | Route path alone |
| Razorpay | HMAC signature verification | Webhook payload contents |

---

## 5. Data flow: the three P0 flows that matter

**Post a job**
`jobs.new.tsx` → wizard state (autosaved as `status='draft'`) → `create_job_with_tier()` RPC → validates plan entitlement + live-job cap → deducts tier cost → inserts job → seeds `job_unlock_allowance` → trigger writes `employer_activity` → returns job id.

**Search + unlock a candidate**
`database.tsx` requires an active job selected → `search_candidates(job_id, filters)` RPC → verifies job is `active` and caller has membership → returns **masked** rows ranked by relevancy → recruiter clicks Unlock → `unlock_candidate(job_id, candidate_user_id)` RPC → row-locks allowance, falls back to wallet, inserts `candidate_unlocks` (idempotent on the UNIQUE constraint) → returns full contact row.

**Boost a job**
`jobs.tsx` → `apply_boost(job_id)` RPC → checks job not created today, checks boost credits, inserts `job_boosts` row with window, deducts credits, logs activity → ranking function picks up the active boost.

---

## 6. Third-party surface

| Service | Used for | Failure mode |
|---|---|---|
| Razorpay | Credit packs, plans | Webhook retries; orders table is source of truth |
| WhatsApp Business API | Alerts, notifications | `whatsapp_send_ledger` caps per post |
| GST / MCA / Aadhaar APIs | Employer verification | Falls back to manual admin review |
| AI provider | Resume parsing, shortlist, JD assist | Must degrade to manual entry, never block onboarding |

**Rule:** no third-party failure may block a core flow. Resume parse fails → manual form. Verification API down → queue for admin. AI down → deterministic JD template still works.

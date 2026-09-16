# P0-00 — Ground Rules (send first, re-send after any session restart)

You are working on JobsKart, a job marketplace built with TanStack Start + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Supabase. The repo already has 47 tables, 28 migrations, RLS on all user-facing tables, and three working portals (candidate, employer, admin). We are extending it, not rebuilding it.

Apply these rules to every task from now on. Do not implement any feature in this message — only make the changes in section 6.

## 1. Never rebuild what exists
Before creating anything, check whether it already exists. These already exist and must be reused, not duplicated:
- Helpers: `has_company_membership()`, `has_company_role()`, `has_platform_role()`, `user_companies()`, `apply_credit_delta()`, `unlock_candidate()`, `log_employer_activity()`, `accept_invite()`, `remove_member()`, `slugify()`, `tg_set_updated_at()`
- Tables: `companies`, `employer_members`, `employer_invites`, `employer_credit_wallets`, `credit_transactions`, `credit_packs`, `plans`, `plan_settings`, `candidate_unlocks`, `employer_activity`, `match_scoring_config`, `skills_master`, `job_titles_master`, `cities`, `industries`

## 2. All money and access logic lives in Postgres
Credit deduction, unlock grants, boost consumption, plan entitlement checks, and permission checks go inside `SECURITY DEFINER` functions with `SET search_path = public` and row locks (`SELECT ... FOR UPDATE`). Never in server functions. Never in React.

Reason: two browser tabs can fire the same action concurrently. Only a row lock inside a database function prevents double-spending a credit.

## 3. Locked data must never reach the frontend
A candidate's phone, email, and resume URL must not appear in any API response until an unlock row exists for that company. Enforce this by excluding the columns in SQL, not by hiding them in React. Assume every network response is inspected by the user.

## 4. All AI calls go through one adapter
Create `src/lib/ai/provider.ts`. Every AI call imports `chat()` or `chatJSON()` from it. No other file may contain a provider URL or a model name.

```ts
// src/lib/ai/provider.ts
import { z, type ZodType } from "zod";

type ChatArgs = {
  system?: string;
  user: string;
  images?: { mime: string; b64: string }[];
  temperature?: number;
};

const PROVIDER = process.env.AI_PROVIDER ?? "lovable";
const MODEL = process.env.AI_MODEL ?? "google/gemini-2.5-flash";

export async function chat(args: ChatArgs): Promise<string> {
  // switch on PROVIDER: "lovable" -> ai.gateway.lovable.dev
  //                     "gemini"  -> generativelanguage.googleapis.com
  //                     "openai"  -> api.openai.com
  // all three return a plain string
}

export async function chatJSON<T>(args: ChatArgs, schema: ZodType<T>): Promise<T> {
  const raw = await chat({ ...args, system: (args.system ?? "") + "\nRespond with JSON only. No markdown fences, no preamble." });
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return schema.parse(JSON.parse(cleaned));
}
```

Then refactor these three files to use it, changing no behaviour:
- `src/lib/resume.functions.ts`
- `src/lib/ai-shortlist.functions.ts`
- `src/lib/matching.functions.ts`

## 5. Schema changes are migration files only
Every schema change lands as a new file in `supabase/migrations/`. Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and guarded `DO $$ ... END $$` blocks for constraints so migrations are re-runnable. Never modify an existing migration file.

## 6. Do these two things now
1. Create `src/lib/ai/provider.ts` as above and refactor the three files to use it. No behaviour change.
2. Add `.env` to `.gitignore`, remove it from git tracking, and create `.env.example` containing only the variable names with empty values.

## Acceptance
- [ ] `src/lib/ai/provider.ts` exists and exports `chat` and `chatJSON`
- [ ] `grep -r "ai.gateway.lovable.dev" src/` returns only `provider.ts`
- [ ] Resume parsing, AI shortlist, and match scoring still work exactly as before
- [ ] `.env` is in `.gitignore` and untracked; `.env.example` exists

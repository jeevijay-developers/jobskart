# Employer Monetization — Detailed Implementation Plan

Companion to `employer-monetization-and-credit-strategy-plan.md` (business strategy) and `employer-monetization-implementation-plan.md` (the phased review that this document turns into bite-sized, file-precise engineering tasks). No code is written here — every task names exact tables, columns, function signatures and call sites so an engineer (or an agent) can implement it without re-deriving the design.

## 0. Global constraints (apply to every task below, not repeated per task)

Copied from `CLAUDE.md`'s standing rules — every task must satisfy these:

1. All money/access mutations happen in Postgres `SECURITY DEFINER` functions with `SET search_path = public`, using row locks (`FOR UPDATE`) where a race is possible. Never in a TanStack server function or React.
2. Schema changes land only as **new files** in `supabase/migrations/`. Never edit an existing migration file. Use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / guarded `DO $$ ... END $$` so every migration is re-runnable.
3. Reuse existing helpers (`has_company_membership`, `apply_credit_delta`, `log_employer_activity`, `tg_set_updated_at`) — do not re-implement them.
4. Every privileged action writes to `employer_activity` in the same transaction (already true for the functions this plan touches; preserve it).
5. Locked candidate data must never reach the frontend outside the existing unlock RPC path — this plan does not change that boundary, only which balance pays for it.
6. There is no automated test runner in this repo (`bun run lint` and manual QA are the only gates). Every task below ends with a **manual verification** step (SQL to run in the Supabase SQL editor / UI click-path to exercise), not a `pytest`/`vitest` step.
7. Use stable error-code strings (already the pattern: `insufficient_permissions`, `no_credits`, `job_not_active`, `boost_same_day`, …) so the UI's existing error-mapping functions (`mapTierError`, `mapBoostError`, `paymentErrorMessage`) keep working — new error codes must be added to those maps in the same task that introduces them.

## 1. Master file/module index

Every file this plan creates or touches, so nothing is missed.

| File | Kind | Touched in |
|---|---|---|
| `supabase/migrations/<ts>_fix_unlock_allowance_plan_source.sql` | new migration | Phase 0, Task 0.1 |
| `supabase/migrations/<ts>_retire_companies_plan_id.sql` | new migration | Phase 0, Task 0.2 |
| `supabase/migrations/<ts>_trending_ranking_bonus.sql` | new migration | Phase 0, Task 0.3 |
| `src/lib/invoice-pdf.ts` | modify (constant only) | Phase 0, Task 0.4 |
| `supabase/migrations/<ts>_benefit_type_split.sql` | new migration | Phase 1, Task 1.1–1.6 |
| `src/lib/credits.functions.ts` | modify | Phase 1, Task 1.7 |
| `src/routes/_authenticated/employer/credits.tsx` | modify (UI split into 3 balance cards) | Phase 1, Task 1.8 |
| `supabase/migrations/<ts>_job_post_refund_admin.sql` | new migration | Phase 1, Task 1.9 |
| `supabase/migrations/<ts>_phase2_catalogue.sql` | new migration | Phase 2, Task 2.1–2.3 |
| `src/routes/_authenticated/admin/**` (plan/pack editor, wherever it lives) | modify | Phase 2, Task 2.4 |
| `prompt structure/monetization.md` | modify (reconciliation note) | Phase 0, Task 0.5 |

No file outside this table should need to change for Phases 0–1. Phase 2+ files are named where known and flagged "TBD — confirm path" where the plan can't be more precise without a design decision (see each task).

---

## 2. Phase 0 — Fix + reconcile (no pricing change, ship before anything is sold)

### Task 0.1 — Fix `job_unlock_allowance` seeding to read the company's actual plan

**Problem:** `tg_seed_job_unlock_allowance()` (defined in `20260924103235_db_access_model.sql:59`) reads the flat global singleton `plan_settings.unlocks_per_job` (default 25) instead of the company's resolved `plans.limits->>'unlocks_per_job'` (Basic: `0`, Regular: `50`, Unlimited: `-1`). Every job on every plan gets 25 free unlocks today, including Basic (which should get 0).

**Files:** new migration `supabase/migrations/<ts>_fix_unlock_allowance_plan_source.sql`.

**Do NOT call `get_company_entitlements(_company_id)` from inside this trigger.** That function starts with `IF NOT (has_company_membership(auth.uid(), _company_id) OR has_platform_role(auth.uid(), 'super_admin')) THEN RAISE EXCEPTION 'Forbidden'`. The trigger fires on `jobs` INSERT/UPDATE, which can happen with `auth.uid()` populated (normal employer session) but must also keep working if a service-role/admin process ever inserts or flips a job's status without a user JWT in context (e.g. a future admin bulk-reactivation tool, or a migration backfill) — in that case `auth.uid()` is `NULL`, `has_company_membership(NULL, …)` is `false`, and the whole job insert/update would fail with `Forbidden` inside a trigger, which is a much worse failure mode (breaks job posting entirely) than a stale allowance number. Instead, inline the same active-plan lookup `get_company_entitlements()` uses, with no auth gate:

```
resolved_total :=
  COALESCE(
    (SELECT (p.limits->>'unlocks_per_job')::int
       FROM company_plans cp JOIN plans p ON p.id = cp.plan_id
       WHERE cp.company_id = NEW.company_id AND cp.status = 'active'
         AND (cp.ends_at IS NULL OR cp.ends_at > now())
       LIMIT 1),
    (SELECT (p.limits->>'unlocks_per_job')::int
       FROM plans p WHERE p.name = 'Basic' AND p.is_custom = false
       ORDER BY p.created_at LIMIT 1),
    25  -- last-resort default, same as today, only reached if the Basic row itself is missing
  )
```

- [ ] **Step 1.** In the new migration, `CREATE OR REPLACE FUNCTION public.tg_seed_job_unlock_allowance()` with the resolution above. Map `-1` (unlimited) to a large sentinel integer (e.g. `1000000`) for the `total` column — do **not** add a schema change for "unlimited" (no new boolean column, no relaxed CHECK). The existing `job_unlock_allowance_bounds CHECK (used >= 0 AND used <= total)` and `unlock_candidate()`'s `WHERE used < total` guard both work unmodified against a large sentinel, so this is a pure function-body change.
- [ ] **Step 2.** In the same migration, backfill every **currently-active** job's `job_unlock_allowance.total` to the resolved-per-plan value, but never shrink below what's already been used:
  `UPDATE job_unlock_allowance a SET total = GREATEST(<resolved value for a.company_id>, a.used) WHERE ...` for every row where the resolved value differs from the current `total`. State explicitly in a migration comment: a company that already consumed more than their plan's correct allowance keeps what they used (no clawback); only the *remaining* headroom going forward is corrected.
- [ ] **Step 3.** Manual verification (SQL editor, against a test company on each plan): create one draft job per plan tier (Basic/Regular/Unlimited test companies), activate each via the existing UI flow, then `SELECT total FROM job_unlock_allowance WHERE job_id = '<id>'` — expect `0`, `50`, `1000000` respectively, not `25`.
- [ ] **Step 4.** Re-run the backfill query as a dry-run `SELECT` (not `UPDATE`) first against production data and eyeball the diff count before applying, since this changes real companies' numbers — this is a data-correcting migration, not a pure structural one.

### Task 0.2 — Retire `companies.plan_id`, repoint `company_auto_renew()` at `company_plans`

**Problem:** `companies.plan_id` (added `20260924113852_job_expiry_renewal.sql:22`) is never written by any INSERT/UPDATE anywhere in the codebase (confirmed by grep across all migrations and `src/`). `company_auto_renew(_company_id)` (`job_expiry_renewal.sql:30`) is its only reader, via `LEFT JOIN plans p ON p.id = c.plan_id` — always `NULL`, so per-plan auto-renew override never fires for any company.

**Files:** new migration `supabase/migrations/<ts>_retire_companies_plan_id.sql`.

- [ ] **Step 1.** Pre-flight safety check inside the migration itself (not just a manual step someone might skip): `DO $$ BEGIN IF EXISTS (SELECT 1 FROM companies WHERE plan_id IS NOT NULL) THEN RAISE EXCEPTION 'companies.plan_id has non-null data — do not drop, investigate first'; END IF; END $$;` — this makes the migration self-verifying instead of trusting a one-time grep.
- [ ] **Step 2.** `CREATE OR REPLACE FUNCTION public.company_auto_renew(_company_id uuid)` — same return shape (`TABLE(enabled boolean, max_times int)`), but resolve the plan via `company_plans cp JOIN plans p ON p.id = cp.plan_id WHERE cp.company_id = _company_id AND cp.status = 'active' AND (cp.ends_at IS NULL OR cp.ends_at > now())` instead of `LEFT JOIN companies c ... LEFT JOIN plans p ON p.id = c.plan_id`. Keep the `COALESCE((p.limits->>'auto_renew')::boolean, ps.auto_renew_enabled)` fallback logic unchanged — only the join path changes.
- [ ] **Step 3.** `ALTER TABLE public.companies DROP COLUMN IF EXISTS plan_id;` — after Step 1's guard passes.
- [ ] **Step 4.** Manual verification: put a test company's plan's `limits` jsonb with an explicit `"auto_renew": true, "auto_renew_max": 5` (a plan doesn't have this key today — see edge case below), call `SELECT * FROM company_auto_renew('<company_id>')`, confirm it reflects the plan override, not just the global `plan_settings` default.

**Edge case to flag, not silently fix:** none of the seeded plans (Basic/Regular/Unlimited) currently set an `auto_renew` key in their `limits` jsonb at all — so even after this fix, every company still falls through to the global `plan_settings.auto_renew_enabled/auto_renew_max_times` default in practice, because the per-plan override key was never populated. This task fixes the *plumbing* (a real plan override would now work); whether any plan should actually grant a different auto-renew allowance is a product decision, not an engineering one — flag to the business owner, don't invent numbers.

### Task 0.3 — Trending tier ranking bonus

**Problem:** `feed_jobs()` / `feed_jobs_for_candidate()` compute `score = boost_bonus + freshness_bonus + quality_bonus`. `jobs.tier = 'trending'` has no effect on either function's score — confirmed absent from both, including the newest `20260926071831_feed_jobs_for_candidate.sql`. Trending is purchasable today but delivers nothing.

**Decision needed before this task can ship (flagging, not deciding for the business):**
- **Option A (recommended default for this plan):** implement `trending_bonus` now.
- **Option B:** pull Trending from `activate_job_with_tier`'s allowed tiers (or from the UI tier picker) until Option A ships, so nothing sellable is silently inert.

This plan proceeds with **Option A**.

**Files:** new migration `supabase/migrations/<ts>_trending_ranking_bonus.sql`.

- [ ] **Step 1.** `ALTER TABLE public.boost_settings ADD COLUMN IF NOT EXISTS trending_weight numeric NOT NULL DEFAULT 30;` — reuse the existing `boost_settings` singleton (it already holds `boost_weight`/`freshness_weight`/`quality_weight`, i.e. it's already the general ranking-tunables table despite its name) rather than creating a new settings table.
- [ ] **Step 2.** `CREATE OR REPLACE FUNCTION public.feed_jobs(...)` (same signature, copy-paste the existing body from `20260924113852_job_expiry_renewal.sql`) adding one term to the `score` computation inside the `scored` CTE: `+ s.trending_weight * (CASE WHEN j.tier = 'trending' THEN 1 ELSE 0 END)`. Trending does not decay like a boost (it's a purchased tier for the job's whole 30-day life, not a day-scoped add-on) — flat bonus for the tier's duration, no time-based falloff.
- [ ] **Step 3.** `CREATE OR REPLACE FUNCTION public.feed_jobs_for_candidate(...)` — identical change, same term, in the copy of the `scored` CTE inside that function (defined `20260926071831_feed_jobs_for_candidate.sql`). **These two functions currently duplicate the entire scoring formula** — note as tech debt, not a blocker: a future migration could extract a shared `SQL` helper `public.job_rank_score(job_row, boost_row, settings_row) RETURNS numeric` both call, but that's a separate refactor from this fix and out of scope here.
- [ ] **Step 4.** Manual verification: create two otherwise-identical active Classic jobs in the same city/category, upgrade one to `trending` via `activate_job_with_tier`, call `SELECT id, score FROM feed_jobs(_limit:=10)` (or the candidate RPC) and confirm the trending job's `score` is higher by approximately `trending_weight` (30, before rounding from the other terms).

### Task 0.4 — Invoice GSTIN

**Not an engineering task — a data input.** `src/lib/invoice-pdf.ts`'s `SELLER.gstin` is the literal string `"GSTIN APPLIED FOR"`. The only code change is swapping that constant (and re-confirming `SELLER.stateCode` still matches the real GSTIN's state prefix) once the real GSTIN exists.

- [ ] **Step 1.** Get the real GSTIN (or an explicit legal sign-off that pre-registration invoicing is acceptable for the pilot) from finance/legal — **this blocks Phase 2 go-live, not Phase 0/1 engineering work**, since no real charges should go out with a placeholder tax ID.
- [ ] **Step 2.** Once received, update `SELLER.gstin` in `src/lib/invoice-pdf.ts:26`. No migration needed — this constant isn't stored in the database.

### Task 0.5 — Reconcile `prompt structure/monetization.md` with the new strategy doc

**Files:** `prompt structure/monetization.md` (add a short note, don't rewrite it — it remains the authoritative P0 spec per `CLAUDE.md`).

- [ ] **Step 1.** Add a dated changelog note at the top of `monetization.md` stating: the single-wallet, typed-consumption-order model it describes is being extended (not replaced) with named balances per `employer-monetization-implementation-plan.md` §4; Classic+ stays plan-only (never purchasable, confirmed unchanged); 60-day response retention is unaffected and unchanged; consumption order (plan quota → allowance/wallet → block) is unchanged, only *which named wallet* pays at the fallback step is new.

**Phase 0 gate:** Tasks 0.1–0.3 shipped and verified per their manual steps; Task 0.4's real GSTIN obtained (may slip past Phase 0's calendar slot without blocking Phase 1 engineering, but must land before Phase 2 sells anything); Task 0.5's note added.

---

## 3. Phase 1 — Named balances (the core "benefit_type" split)

This phase changes `employer_credit_wallets` from one balance to three, and threads a new `benefit_type` through every function and UI surface that touches it. Read task 1.1–1.6 in order — later tasks depend on earlier ones' exact column/type names.

**Interfaces this phase produces** (for reference by every task below):
- New enum `public.benefit_type` with exactly three values: `'job_post'`, `'contact'`, `'boost'`.
- `employer_credit_wallets` columns: `job_post_balance int` (renamed from `balance`), `contact_balance int NOT NULL DEFAULT 0`, `boost_balance int NOT NULL DEFAULT 0`.
- `apply_credit_delta(_company_id uuid, _delta int, _kind public.credit_txn_kind, _reference jsonb DEFAULT NULL, _actor uuid DEFAULT NULL, _benefit_type public.benefit_type DEFAULT 'job_post')` — **`_benefit_type` is appended as the LAST parameter**, not inserted earlier in the list (see Task 1.2's edge-case note for why).

### Task 1.1 — `benefit_type` enum + wallet column split

**Files:** new migration `supabase/migrations/<ts>_benefit_type_split.sql` (all of Phase 1's schema work lands in this one migration file — it's one coherent structural change, matching how `20260924095332_job_tiers_schema.sql` bundled its enum+table+seed together).

- [ ] **Step 1.** `DO $$ BEGIN CREATE TYPE public.benefit_type AS ENUM ('job_post','contact','boost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- [ ] **Step 2.** `ALTER TABLE public.employer_credit_wallets RENAME COLUMN balance TO job_post_balance;` — this is a metadata-only rename, no data movement, no downtime risk, and (important) **no backfill needed**: every company's existing purchased-credit balance becomes their job-post balance automatically, which is the documented, deliberate migration decision (job posts were the dominant historical use of the single wallet).
- [ ] **Step 3.** `ALTER TABLE public.employer_credit_wallets ADD COLUMN IF NOT EXISTS contact_balance int NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS boost_balance int NOT NULL DEFAULT 0;` — `DEFAULT 0` means every existing row gets `0` in both new columns with no separate `UPDATE` needed.
- [ ] **Step 4.** Do **not** add a `CHECK (job_post_balance >= 0)` (or on the other two columns). Non-negativity is enforced today by `apply_credit_delta()` raising `'Insufficient credits'` *after* the UPDATE, which callers pattern-match on (`SQLERRM LIKE 'Insufficient credits%'` in `activate_job_with_tier`, `apply_boost`) to map to the `no_credits` error code. A DB-level `CHECK` violation raises a different SQLSTATE/message and would silently break that mapping — every "insufficient balance" error would suddenly surface as a raw, unmapped Postgres constraint error in the UI instead of the friendly `no_credits` toast.
- [ ] **Step 5.** `ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type;` (nullable for now, made `NOT NULL` in Step 7 after backfill — a `NOT NULL` column with no default would fail on the `ALTER` itself since existing rows have no value yet).
- [ ] **Step 6.** Backfill: `UPDATE public.credit_transactions SET benefit_type = 'job_post' WHERE benefit_type IS NULL;` — **document this explicitly as a best-effort backfill, not a historically accurate one.** A pre-split `credit_transactions` row's `kind` column (`purchase`/`unlock`/`boost`/`job_post`/…) already records *what the money was spent on*; `benefit_type` records *which named pool it came from*, a question that didn't exist before the split. Backfilling every historical row to `'job_post'` is correct for `kind='purchase'` and `kind='job_post'` rows (that's where the single balance became `job_post_balance`), but a historical `kind='unlock'` or `kind='boost'` row will now *also* show `benefit_type='job_post'`, which looks contradictory if a support agent reads it literally ("spent on a boost, from the job-post pool?"). That's an accepted, documented artifact of splitting a single pool after the fact — the `kind` column remains the source of truth for "why", `benefit_type` is only fully accurate from this migration forward.
- [ ] **Step 7.** `ALTER TABLE public.credit_transactions ALTER COLUMN benefit_type SET NOT NULL;`
- [ ] **Step 8.** `ALTER TABLE public.credit_packs ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type NOT NULL DEFAULT 'job_post';` — a `DEFAULT` is safe here (unlike `credit_transactions`) because every currently-seeded pack (Starter/Growth/Pro/Enterprise) genuinely did only ever grant the generic (now job-post) balance, so the default is both a safe backfill *and* correct for any new pack row that forgets to specify it — though every Phase 2 pack insert should specify it explicitly regardless.
- [ ] **Step 9.** Manual verification: `SELECT job_post_balance, contact_balance, boost_balance FROM employer_credit_wallets WHERE company_id = '<a test company with existing credits>'` — confirm `job_post_balance` equals what `balance` was before the migration, and the two new columns are `0`. `SELECT DISTINCT kind, benefit_type FROM credit_transactions` — confirm every row has a non-null `benefit_type`.

### Task 1.2 — `apply_credit_delta()`: add `_benefit_type`, write to the right column

**Files:** same migration as Task 1.1.

**Critical edge case — parameter position.** Every existing internal caller (`activate_job_with_tier`, `apply_boost`, `unlock_candidate`, `fulfill_razorpay_order`) invokes `apply_credit_delta(...)` **positionally** inside PL/pgSQL (e.g. `apply_credit_delta(_company_id, -_price, 'job_post', jsonb_build_object(...), auth.uid())`), not with named arguments. If `_benefit_type` were inserted anywhere before the existing last parameter (`_actor`), every one of those un-updated positional calls would silently bind the wrong value to the wrong parameter — e.g. `_actor`'s `uuid` value landing in a `_benefit_type` slot, or `_reference`'s `jsonb` landing where `_actor` used to be — with no compile-time error, only a runtime type-mismatch or, worse, a *silent* wrong assignment if types happened to coincide. **`_benefit_type` must be appended as the new last parameter, after `_actor`, with `DEFAULT 'job_post'`.** This makes every un-migrated positional call keep working exactly as before (defaulting to `job_post`) until Task 1.3–1.6 explicitly update each call site to pass it.

- [ ] **Step 1.** `CREATE OR REPLACE FUNCTION public.apply_credit_delta(_company_id uuid, _delta int, _kind public.credit_txn_kind, _reference jsonb DEFAULT NULL, _actor uuid DEFAULT NULL, _benefit_type public.benefit_type DEFAULT 'job_post') RETURNS int`.
- [ ] **Step 2.** Inside the body, resolve which column to touch via a **fixed, hardcoded** mapping — never interpolate `_benefit_type` (even though it's now a strongly-typed enum, not free text) directly into dynamic SQL without going through this mapping, to keep the column-selection logic auditable in one place:
  `_col := CASE _benefit_type WHEN 'job_post' THEN 'job_post_balance' WHEN 'contact' THEN 'contact_balance' WHEN 'boost' THEN 'boost_balance' END;`
  Then use `EXECUTE format('UPDATE public.employer_credit_wallets SET %I = %I + $1, updated_at = now() WHERE company_id = $2 RETURNING %I', _col, _col, _col) INTO _new_balance USING _delta, _company_id;` — `format('%I', _col)` safely quotes the identifier; since `_col` can only ever be one of three hardcoded literal strings (never derived from unvalidated input), there is no injection surface here even though the update statement is built dynamically.
  The initial `INSERT ... ON CONFLICT (company_id) DO NOTHING` upsert-row step stays unchanged (a wallet row still has one row per company; the insert just needs all three balance columns defaulting to `0`, which they already do via their column defaults).
- [ ] **Step 3.** Insert into `credit_transactions` with `benefit_type` now populated from `_benefit_type` explicitly (not defaulted): `INSERT INTO credit_transactions (company_id, kind, delta, balance_after, reference, created_by, benefit_type) VALUES (_company_id, _kind, _delta, _new_balance, _reference, _actor, _benefit_type);`
- [ ] **Step 4.** Manual verification: call `SELECT apply_credit_delta('<test company>', 100, 'purchase', NULL, NULL, 'contact')` in the SQL editor; confirm `contact_balance` increased by 100 and `job_post_balance`/`boost_balance` are untouched, and the new `credit_transactions` row has `benefit_type = 'contact'`.

### Task 1.3 — Update `activate_job_with_tier()` to use `job_post_balance` explicitly

**Files:** same migration.

- [ ] **Step 1.** `CREATE OR REPLACE FUNCTION public.activate_job_with_tier(...)` (copy body from `20260924100423_job_tiers_posting.sql`), changing both `apply_credit_delta(_company_id, -_price, 'job_post'::credit_txn_kind, jsonb_build_object(...), auth.uid())` calls (one in the `classic` branch, one in `trending`) to add `, 'job_post'::public.benefit_type` as the sixth argument. (This is a no-op behaviorally since `'job_post'` is already the default — do it anyway for explicitness/auditability, matching this plan's "every call site specifies its type" principle rather than relying on the default silently.)
- [ ] **Step 2.** Change the function's final balance lookup from `SELECT COALESCE(balance, 0) INTO _balance FROM employer_credit_wallets WHERE company_id = _company_id` to `SELECT COALESCE(job_post_balance, 0) INTO _balance ...` (the column no longer exists under the old name).
- [ ] **Step 3.** Manual verification: post a Classic job on a company whose plan quota is exhausted (so it falls into the `credits` branch), confirm `job_post_balance` decrements and the RPC's returned `balance_after` matches.

### Task 1.4 — Update `apply_boost()` to use `boost_balance`

**Files:** same migration.

- [ ] **Step 1.** `CREATE OR REPLACE FUNCTION public.apply_boost(_job_id uuid)` (copy body from `20260924053542_job_boost_engine_ddl.sql`), changing the charge line `apply_credit_delta(_company_id, -_settings.cost_credits, 'boost'::credit_txn_kind, jsonb_build_object('job_id', _job_id), auth.uid())` to add `, 'boost'::public.benefit_type` as the sixth argument.
- [ ] **Step 2.** No other change needed — `apply_boost()` never reads the wallet balance directly outside `apply_credit_delta`'s own return value (`_balance := public.apply_credit_delta(...)`), which will now correctly be the post-boost `boost_balance`.
- [ ] **Step 3.** Manual verification: boost a job on a company with `boost_balance > 0` and `job_post_balance = 0`; confirm the boost succeeds (proving it drew from `boost_balance`, not the now-empty `job_post_balance`) and `job_post_balance` is unchanged.

### Task 1.5 — Update `unlock_candidate()`'s wallet-fallback branch to use `contact_balance`

**Files:** same migration.

- [ ] **Step 1.** `CREATE OR REPLACE FUNCTION public.unlock_candidate(...)` (copy body from `20260924103235_db_access_model.sql:103`), two changes:
  - The "already unlocked" branch's `SELECT balance INTO _bal FROM employer_credit_wallets WHERE company_id = _company_id` → `SELECT contact_balance INTO _bal ...` (this branch's returned `balance_after` should reflect the contact pool, since that's the balance this whole RPC is about).
  - The wallet-fallback branch's `apply_credit_delta(_company_id, -_per_unlock, 'unlock'::credit_txn_kind, jsonb_build_object(...), _actor)` → add `, 'contact'::public.benefit_type` as the sixth argument.
- [ ] **Step 2.** Manual verification: exhaust a job's `job_unlock_allowance`, then unlock one more candidate on that job; confirm `contact_balance` decrements by `plan_settings.credits_per_unlock` and `job_post_balance`/`boost_balance` are untouched.

### Task 1.6 — Snapshot `benefit_type` on the order at creation, credit it at fulfilment

**Files:** same migration. **This is the task that actually makes buying a "Boost Pack" or "Sourcing" pack land in the right balance — without it, every purchase still credits `job_post_balance` regardless of what was bought, defeating the whole point of Phase 1.**

**Design note (why this snapshots instead of re-querying `credit_packs` at fulfilment time):** `create_credit_pack_order()` already snapshots `credits` and `price_inr` onto the `razorpay_orders` row at quote time, specifically so a later catalogue edit can never retroactively change an already-quoted order — the same reasoning applies to `benefit_type`. If `fulfill_razorpay_order` instead re-queried `credit_packs.benefit_type` at fulfilment time (which can be minutes or hours after quote time, since a webhook delivery isn't instant), an admin editing or deactivating that pack in between would cause the employer to be credited a *different* balance than the one they saw and paid for at checkout. Snapshotting at order-creation time closes that race entirely.

- [ ] **Step 1.** `ALTER TABLE public.razorpay_orders ADD COLUMN IF NOT EXISTS benefit_type public.benefit_type;` — nullable (plan orders have no `benefit_type`, only credit-pack orders do; the existing `razorpay_orders_kind_xor` CHECK already enforces exactly one of `pack_id`/`plan_id`, this column needs no CHECK of its own).
- [ ] **Step 2.** `CREATE OR REPLACE FUNCTION public.create_credit_pack_order(...)` (copy from `20260923064309_razorpay_hardening_gst.sql:110`) — change `SELECT id, name, credits, price_inr INTO _pack FROM credit_packs WHERE id = _pack_id AND active = true` to also select `benefit_type`, and add `benefit_type` to the `INSERT INTO razorpay_orders (...)` column list and values.
- [ ] **Step 3.** `CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order(...)` (copy body from `20260926065745_plan_subscription_purchase.sql:219`) — in the `ELSE` (credit-pack) branch, change the `apply_credit_delta(_o.company_id, _o.credits, 'purchase'::credit_txn_kind, jsonb_build_object(...), _actor)` call to add `, COALESCE(_o.benefit_type, 'job_post'::public.benefit_type)` as the sixth argument, reading directly from `_o` (already loaded via `SELECT * INTO _o FROM razorpay_orders ... FOR UPDATE`) — no re-query of `credit_packs` needed. The `COALESCE` fallback to `'job_post'` covers only orders created *before* this migration that are still sitting in `'created'` status with no `benefit_type` set; every order created after Step 2 always has one.
- [ ] **Step 4.** Manual verification: create a credit-pack order (any `benefit_type`), then in the SQL editor change that pack's `benefit_type` (simulating an admin edit landing between checkout and webhook delivery), then fulfil the order — confirm the balance credited matches the `benefit_type` captured on the order row at creation, not the pack's now-changed value.

### Task 1.7 — Update TypeScript: `credits.functions.ts`

**Files:** `src/lib/credits.functions.ts`.

- [ ] **Step 1.** `getCompanyWallet` (line 30): change `.select("balance, updated_at")` to `.select("job_post_balance, contact_balance, boost_balance, updated_at")`; change the transactions query's `.select("id, kind, delta, balance_after, reference, created_at")` to also select `benefit_type`; change the return shape from `{ balance, transactions }` to `{ jobPostBalance, contactBalance, boostBalance, transactions }` (each transaction row now carries `benefit_type` for client-side filtering into the three balance cards).
- [ ] **Step 2.** `unlockCandidateContact` (line 246): the `balance: result?.balance_after ?? 0` in the return object now specifically means the contact balance after unlock (already true given Task 1.5's change) — rename the returned field to `contactBalance` for clarity at call sites (grep `credits.tsx`/wherever this is consumed and update the destructure).
- [ ] **Step 3.** `getUnlockState` (line 323): change `.from("employer_credit_wallets").select("balance")` to `.select("contact_balance")` (this function is specifically about the candidate-database unlock flow, so it only ever needed the contact pool — the old generic `balance` field it returned was already conceptually "the balance that pays for unlocks," now correctly named); rename the returned `balance` field to `contactBalance`.
- [ ] **Step 4.** No change needed to `listCreditPacks`, `createRazorpayOrder`, `verifyRazorpayPayment`, `reportRazorpayPaymentFailure`, `listCompanyInvoices`, `listUnlockedCandidateIds` — none of them read/return a wallet balance column directly. (`listCreditPacks` should additionally select `benefit_type` so the UI can group packs by type — add it to Task 1.8 instead, since it's a UI-driven need, not a Phase-1-schema-driven one.)
- [ ] **Step 5.** Add `benefit_type` to `listCreditPacks`'s `.select(...)` (line 22): `.select("id, name, credits, price_inr, badge, sort, benefit_type")`.

### Task 1.8 — UI: split the Credits page into three balance cards

**Files:** `src/routes/_authenticated/employer/credits.tsx`.

- [ ] **Step 1.** Replace the single wallet-balance hero card with three cards: "Job Post Credits" (`jobPostBalance`), "Contact Credits" (`contactBalance`), "Boost Credits" (`boostBalance`), each showing its own balance number.
- [ ] **Step 2.** Filter the recent-transactions table into three tabs (or three inline lists under each card) keyed on each transaction's `benefit_type`, instead of one combined table.
- [ ] **Step 3.** Group the credit-packs purchase grid by `benefit_type` (three sub-sections: Job Post Packs, Contact Packs, Boost Packs) instead of one flat grid — this only changes rendering grouping; the purchase flow (`createRazorpayOrder` → Razorpay Checkout → `verifyRazorpayPayment`) is unchanged.
- [ ] **Step 4.** Manual verification: as a test employer with all three balances non-zero, load `/employer/credits`, confirm three distinct numbers render (not the same number three times — a real risk if the query/mapping is copy-pasted carelessly), buy one pack of each type, confirm each purchase lands in the correct card.

### Task 1.9 — Admin-initiated job-post-credit refund (new capability, not a rename)

**Problem surfaced by this plan, not previously flagged:** the strategy doc's packs policy says *"Refund a credit automatically if JobsKart rejects the job before it becomes active."* No such refund path exists today, and **it cannot exist as described**, because there is no pre-activation review/moderation step in the current system — `activate_job_with_tier()` charges the credit and flips the job to `active` in the same atomic call. A job is never in a "charged but pending review" state; it's either an uncharged `draft` or a charged, live `active` job. Building a real pre-activation review queue is a separate, larger feature (job moderation), out of scope for this monetization plan.

**Minimal viable fix for this plan:** an admin-triggered refund for a job already-charged-and-active that Platform Admin later closes for a policy violation.

**Files:** new migration `supabase/migrations/<ts>_job_post_refund_admin.sql`.

- [ ] **Step 1.** `CREATE OR REPLACE FUNCTION public.admin_refund_job_post_credit(_job_id uuid, _reason text) RETURNS jsonb` — `SECURITY DEFINER`, `SET search_path = public`. Guard: `IF NOT has_platform_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'insufficient_permissions'; END IF;`. Look up the job's `tier`, `tier_source`, `company_id`; if `tier_source <> 'credits'` (i.e. it was covered by plan quota, not a paid credit), `RAISE EXCEPTION 'no_credit_charge_to_refund'` — refunding a plan-quota-sourced post makes no sense (nothing was charged). Otherwise look up the exact debited amount from the matching `credit_transactions` row (`WHERE reference->>'job_id' = _job_id::text AND kind = 'job_post'`) and call `apply_credit_delta(_company_id, <that amount, positive>, 'refund'::credit_txn_kind, jsonb_build_object('job_id', _job_id, 'reason', _reason, 'refund_of_job_post', true), auth.uid(), 'job_post'::benefit_type)`. Idempotency guard: if a `kind='refund'` row already exists with `reference->>'job_id' = _job_id::text`, return early without double-crediting.
- [ ] **Step 2.** `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` and expose it via a new admin-only server function (name TBD — wherever `admin_set_verification` lives today is the right pattern to mirror) rather than calling it directly from the client.
- [ ] **Step 3.** Manual verification: charge a job-post credit (force it into the `credits` tier_source branch), call the refund RPC as a super_admin test account, confirm `job_post_balance` goes back up by exactly the debited amount and a second call is a no-op (idempotency).

**Phase 1 gate:** every existing purchase/consumption flow (job post, boost, unlock, credit-pack purchase, webhook fulfilment) still works end-to-end against the split balances; a manual ledger-reconciliation query (`SELECT company_id, benefit_type, sum(delta) FROM credit_transactions GROUP BY 1, 2` compared against each company's current three balances) matches for every test company with zero discrepancy.

---

## 4. Phase 2 — New catalogue + subscription allowances

Lower granularity than Phase 0/1 by design — per the phased-gating principle in the strategy doc, exact catalogue rows and prices are hypotheses to validate, not to hard-code speculatively. Tasks below are concrete where the *mechanism* is known; flagged as an open design question where a business decision is the actual blocker.

### Task 2.1 — Seed the test catalogue as real, `benefit_type`-tagged `credit_packs` rows

**Files:** new migration `supabase/migrations/<ts>_phase2_catalogue.sql`.

- [ ] Insert Starter Job Pack / Growth Job Pack (`benefit_type='job_post'`), Sourcing 25 / Sourcing 100 (`benefit_type='contact'`), Boost Pack (`benefit_type='boost'`) as rows in `credit_packs`, using the strategy doc's §4.3 prices as the **initial test values**, `active = true`, `sort` values chosen so job-post packs render before contact/boost packs in Task 1.8's grouped UI. Idempotent insert pattern (`WHERE NOT EXISTS (SELECT 1 FROM credit_packs WHERE name = '...')`), matching how `plans` rows are seeded.

### Task 2.2 — Subscription monthly allowances for contact/boost (open design question — do not implement until resolved)

**The blocker:** `plans.limits` today has `unlocks_per_job` (a **per-job** allowance, distributed at job-activation time via `job_unlock_allowance`) — not a **per-month, pooled-across-all-jobs** contact allowance. The strategy doc's Growth/Pro subscription rows (§4.3) describe *"25 contact credits/month"* / *"100 contact credits/month"* as a monthly pool, which is a materially different mechanism from what `unlocks_per_job` already does. Implementing both side-by-side without resolving how they interact risks silently doubling the free-tier giveaway (exactly the class of bug fixed in Phase 0, Task 0.1) — e.g. a Growth-plan company could get 50 free unlocks per job (from `job_unlock_allowance`, if `unlocks_per_job` isn't set to 0 for subscription plans) *plus* 25 more per month from a new pooled allowance, none of which was the intent.

**This plan does not pick an answer — it names the two options for the business/product owner to choose between before this task is implemented:**
- **Option A:** `unlocks_per_job` becomes `0` for all subscription plans going forward, and the *only* free contact mechanism for subscribers is the new monthly pooled allowance (`plans.limits.contact_credits_per_month`), consumed via a new `company_subscription_usage` counter analogous to `get_company_entitlements()`'s existing monthly tier-post counters, checked *before* falling to `contact_balance` in `unlock_candidate()`'s consumption order.
- **Option B:** keep `unlocks_per_job` as the only free mechanism (already job-scoped, arguably a reasonable proxy for "monthly" since jobs are typically posted repeatedly), and drop the "N contact credits/month" language from the subscription catalogue entirely — the subscription's real included benefit becomes "N contact credits from a top-up pack bundled free with signup" (a one-time grant via `apply_credit_delta(..., 'contact')` at `activate_company_plan()` time) rather than a recurring monthly allowance.

Once decided, this task becomes: (if A) add the new monthly-pool table/counter and consumption-order change; (if B) a one-line addition to `activate_company_plan()` granting a signup bonus via `apply_credit_delta`.

### Task 2.3 — Boost monthly subscription allowance

Same shape of decision as Task 2.2, one level simpler since there's no existing job-scoped boost allowance to collide with (boosts already only ever draw from the wallet). Recommend Option-A-equivalent here without the same conflict risk: add `plans.limits.boost_credits_per_month`, track consumption via a new monthly counter in `get_company_entitlements()`'s `usage` object (mirroring the existing `classic_posts_this_month` pattern), and have `apply_boost()` check that counter before falling to `boost_balance`.

### Task 2.4 — Admin catalogue editor UI

**Files: TBD — confirm path.** Grep for wherever `plan_settings`/`boost_settings`/`tier_prices` are currently edited from `/admin` (CLAUDE.md references `/admin/plans`); extend that surface to manage `credit_packs.benefit_type` and the new per-plan monthly allowance keys once Task 2.2/2.3's design question is resolved. Not further specified here — this is UI work whose exact shape depends on what admin tooling already exists, which needs its own short discovery pass before tasking.

**Phase 2 gate:** unchanged from the strategy review doc — ≥95% automatic purchase reconciliation, zero double-debit incidents, subscription buyers demonstrably use ≥2 benefit types.

---

## 5. Phase 3 / Phase 4

Unchanged from `employer-monetization-implementation-plan.md` §5 — deliberately not broken into bite-sized tasks yet, since they're gated on real Phase 1/2 usage data and, for Phase 3, on the `candidate_contact_access` design question (does contact access expire?) and legal review (export credits). Revisit this document's Phase 3/4 sections once that data exists rather than speculatively detailing them now.

---

## 6. Cross-cutting edge cases (apply across every phase, not phase-specific)

| Edge case | Where it's already handled | Where it's new / needs attention in this plan |
|---|---|---|
| Two browser tabs double-spending the last credit | `apply_credit_delta`'s row-locked `UPDATE ... RETURNING` already serializes concurrent writes to the same wallet row (Postgres row lock), regardless of which balance column is touched. | No new risk from the 3-way split — concurrent debits to *different* balance columns on the same company now also serialize through the same row lock (minor throughput cost, not a correctness issue; not worth optimizing pre-launch). |
| Webhook fires twice for the same payment (Razorpay retries) | `fulfill_razorpay_order`'s `FOR UPDATE` row lock + `IF _o.status = 'paid' THEN RETURN ... already_applied: true` short-circuit already makes this a no-op on retry. | Unaffected by Phase 1 — `_benefit_type`/`_pack_benefit_type` resolution happens after the already-paid short-circuit, so a duplicate webhook never re-resolves or re-credits anything. |
| Client-verify and webhook race for the same order | Same row lock as above; whichever acquires the lock first wins, the other sees `status='paid'` and returns `already_applied: true`. | Unaffected. |
| Pack/plan deleted or price-changed between quote and payment | `create_credit_pack_order`/`create_plan_order` snapshot price/credits/GST onto the order row at quote time — a later catalogue edit can't retroactively change an already-quoted order. | Task 1.6b extends this snapshot discipline to `benefit_type`, closing the one field that wasn't already snapshotted. |
| Admin edits `boost_settings`/`plan_settings` prices mid-transaction | Every charging RPC reads `boost_settings`/`plan_settings`/`plans.limits` fresh inside its own transaction, so an admin price edit only affects requests that start after the edit commits — no mid-flight order changes value. | Unaffected by this plan; already correct. |
| Refund policy for a rejected-before-activation job post | N/A — this state doesn't exist in the current system. | Task 1.9 provides the only refund path that *can* exist today (post-activation, admin-initiated); the strategy doc's literal "reject before activation" policy needs either a future moderation feature or a revised policy statement — flagged, not silently implemented as described. |
| Subscription upgrade proration | Not implemented — `activate_company_plan()` always starts a fresh 30-day term at full new-plan price, with no credit for unused days on the old plan. | Out of scope for Phase 0/1 of this plan. Recommend shipping the pilot with the current no-proration behavior (simpler, still honest per principle #4 as long as the UI clearly discloses "upgrading starts a new 30-day term at full price" before checkout) rather than building proration math pre-launch; revisit only if pilot users explicitly complain. |
| Timezone edges (IST month boundaries, boost day boundaries) | Already correctly handled throughout (`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')`, `boost_day` stored column) — no changes needed by this plan. | N/A |
| GST intra vs inter-state | Already correctly handled via `buyer_gst_state_code()`/`gst_state_name()`, unaffected by the benefit-type split (GST is computed on the order's total INR amount, not per-balance-type). | N/A |
| `credit_transactions.balance_after` becomes ambiguous without `benefit_type` alongside it | N/A (new consideration from the split) | Document as a read-contract: any code/report reading `balance_after` must also read `benefit_type` from the same row to know which pool it refers to. No schema change — just don't let a future report silently sum `balance_after` across rows of different `benefit_type` as if they were the same currency. |
| `tg_credits_activity()` trigger's activity-feed message text says generic "balance N" | Pre-existing, harmless today (one balance, no ambiguity) | Cosmetic follow-up once Phase 1 ships: prefix the message with the pool name (e.g. "Job Post balance 12") using `NEW.benefit_type`, so `/employer/activity` reads unambiguously. Not blocking — file as a small polish task after Phase 1's functional work lands. |

## 7. Manual verification checklist per phase (no automated test runner exists — see Global Constraint 6)

Run against a set of test companies covering: Basic plan (no active `company_plans` row), Regular plan, Unlimited plan, and one company mid-way through a credit-pack purchase flow.

**Phase 0:** allowance seeded correctly per plan (Task 0.1 Step 3); `company_auto_renew` reflects a plan override when one is set (Task 0.2 Step 4); Trending job outranks an identical Classic job by ~`trending_weight` (Task 0.3 Step 4); invoice PDF shows the real GSTIN once available.

**Phase 1:** for each of job-post / contact / boost: exhaust one balance while the other two remain untouched, confirm consumption only ever moves the intended balance (Tasks 1.3–1.5's verification steps); buy one pack of each `benefit_type` and confirm it lands in the matching balance, including via the actual Razorpay test-mode checkout (not just direct RPC calls) so `createRazorpayOrder`→Checkout→`verifyRazorpayPayment` is exercised end to end; simulate the webhook path too (Razorpay test webhook or a manual `fulfill_razorpay_order(... via:'webhook' ...)` call) and confirm it doesn't double-credit against a client-verify that already fulfilled the same order; run the ledger-reconciliation query from Phase 1's gate for every test company.

**Phase 2:** once catalogue rows are live, repeat the pack-purchase verification for every new pack; if Task 2.2/2.3 ship, verify the chosen option's consumption order end-to-end (allowance-or-pool-first, wallet-fallback-second) for a subscription-plan company.

## 8. Self-review — coverage check against the strategy doc's §11 acceptance checklist

| §11 item | Covered by |
|---|---|
| Every catalogue item has exact inclusion/expiry/tax/cancellation language | Task 2.1 (packs), existing plan cards (unchanged); no per-purchase expiry exists yet for any benefit type — same as today, unchanged scope of this plan. |
| UI exposes separate Job/Contact/Boost balances, no generic "credits" | Task 1.8 |
| Ledger reconciliation across paid/duplicate-webhook/failed/refund/expiry/admin-adjustment | Phase 1 gate + §7 checklist; refund specifically via Task 1.9 |
| A job credit is not consumed by a draft/rejected job/payment retry | Already true today (`activate_job_with_tier` only charges at the draft→active transition, never on save; `fulfill_razorpay_order` is idempotent on retry) — unaffected, verified not broken by Task 1.3 |
| Candidate contact access is idempotent and consent-protected | Already true (`UNIQUE(company_id, candidate_user_id)` on `candidate_unlocks`); unaffected by Task 1.5 beyond which balance pays |
| Subscription slot cap cannot be exceeded via concurrent tabs | Already true (`activate_job_with_tier`'s advisory lock + row lock); unaffected by this plan |
| Admin price edits cannot change an existing order | Already true (order-time snapshot); Task 1.6b extends the same guarantee to `benefit_type` |
| GST invoice + consumption-event inspection | Existing invoice pipeline unaffected; Task 0.4 closes the GSTIN placeholder gap |
| RLS and function permissions tested for company isolation | Every new/changed function in this plan keeps the existing `has_company_membership`/`REVOKE ... GRANT` pattern — no new RLS surface introduced (all mutation stays inside existing `SECURITY DEFINER` functions) |
| Support has a transaction-explanation/refund playbook | Task 1.9 gives support/admin a concrete refund RPC to point to; a written playbook itself is a non-engineering deliverable, out of scope for this document |

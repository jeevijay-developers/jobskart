# Employer Monetization Strategy — Review & Implementation Plan

Companion to `employer-monetization-and-credit-strategy-plan.md` (the "strategy doc"). That doc sets the *business* direction. This doc (a) checks it against what is actually in the codebase today, since some of that context changed in the same commit the strategy doc was written in, and (b) turns the surviving direction into a sequenced, engineering-actionable plan. No code here — schema/RPC/UI changes are named, not written.

## 0. Bottom line

**The business strategy (Part 1 of the strategy doc — segments, catalogue, principles, phased gating, guardrails) is sound and should be adopted essentially as written.** The benchmarking, the "one benefit, one name, one price unit" principle, and the phase-gated rollout (don't sell contact credits before consent/density, don't sell performance campaigns before attribution) are all correct calls for where JobsKart is right now.

**The technical target model (§7 of the strategy doc — eight new tables, a from-scratch ledger, "retire the wallet") is over-scoped relative to what's already built and shipped.** In the exact same commit that added the strategy doc, a working `company_plans` subscription-purchase pipeline (Razorpay checkout → plan activation → GST invoice → entitlement resolution) landed. It already implements most of what the strategy doc calls "Phase 2 — recurring active-slot subscription" and describes as something to build later. Treating §8 of the strategy doc ("what to replace") literally would mean tearing out code that is newer than the doc itself.

The plan below keeps the strategy doc's business direction, replaces its technical §7/§8 with an evolutionary path that reuses the working wallet/plan/invoice/ledger pipeline, and front-loads two confirmed live bugs plus one integrity gap that must be fixed before any of this is sold as real money.

## 1. What's already built (verified against the current schema, not the strategy doc's assumptions)

| Concept the strategy doc treats as future work | Actual current state |
|---|---|
| "Active Job Slot subscriptions" (§4.1, §9 Phase 2) | **Already implemented.** `plans.limits.live_jobs_max` + `activate_job_with_tier()`'s live-job-count check against it *is* the LinkedIn-style active-slot model the doc recommends adding later. Basic/Regular/Unlimited plans already exist with real `live_jobs_max` values, sold today via `company_plans` + Razorpay. |
| "Replace `company_plans`... evolve to subscription periods with plan-version snapshot and renewal intent" (§8) | `company_plans` **is** the subscription-period table (`status`, `starts_at`, `ends_at`, one-active-row-per-company constraint), and it was written *after* the strategy doc's own reference point — it's the newest money-moving code in the repo, not legacy. |
| "Separate the unit of value... Job credits are prepaid and expiring" (§2.1 lesson) | Job-post cost is already resolved per tier (`plan_settings.tier_prices` / plan quota) and charged via `credit_transactions.kind='job_post'`, distinct in the ledger from `unlock`/`boost`/`repost`. The ledger already distinguishes *why* a debit happened — it just doesn't yet distinguish *which named currency* was spent, because there is only one wallet balance. |
| "Candidate contact credits... database sourcing" as a separate currency (§4.2) | Partially real: `job_unlock_allowance` is already a **separate, job-scoped, non-wallet pool** (25 free unlocks per job by default) that is tried before the wallet. Only the *fallback* draws from the same generic `employer_credit_wallets.balance` as job posts and boosts — so contacts aren't fully fungible with job posts today, but the paid fallback still is. |

**Implication:** the real gap is narrower than "replace the wallet with a grant/ledger system." It is: (a) give boost and the wallet-fallback-unlock path their own named, purchasable balances instead of drawing from the same generic `balance`, and (b) fix two bugs where "plan-specific" entitlements silently fall back to a global default. That is a materially smaller, safer piece of engineering than eight new tables, and it ships inside a pipeline (Razorpay, invoices, RLS, activity log) that already works.

## 2. Confirmed defects to fix regardless of which monetization strategy is chosen

These are correctness bugs today, independent of the business-model decision. Fix them in Phase 0.

1. **`tg_seed_job_unlock_allowance()` ignores the company's actual plan.** It reads the flat global singleton `plan_settings.unlocks_per_job` (default 25) to seed every job's allowance, but the Credits UI shows a *per-plan* figure from `plans.limits.unlocks_per_job` (Basic/Regular/Unlimited differ). A company on Basic — which per `monetization.md`'s own recommendation should get `unlocks_per_job: 0` — is currently still seeded with 25 free unlocks per job. This is a revenue-leak bug, not a style issue.
2. **`companies.plan_id` is dead.** It was added as "foundation for per-plan entitlements" but nothing ever writes it — company plan state lives in `company_plans` instead. The only reader, `company_auto_renew()`, always falls through to the global default, so no company's plan can ever grant a different auto-renew allowance than the platform default. Either wire it (populate on every `activate_company_plan()`/`switch_company_plan_to_basic()` call) or delete the column and make `company_auto_renew()` read `company_plans` directly. Prefer deletion — a second source of truth for "what plan is this company on" is exactly the fragmentation the strategy doc warns against.
3. **Trending has no ranking effect.** `feed_jobs()`/`feed_jobs_for_candidate()` compute `boost_bonus + freshness_bonus + quality_bonus`; a `trending_bonus` term was deferred when the boost engine shipped and was never added, including in today's newest ranking migration. Right now "Trending" is sellable (it's in `job_tier`, priced in `tier_prices`, gated in `activate_job_with_tier`) but delivers no measurable visibility difference from Classic. Selling a named visibility product that has no effect is worse than the strategy doc's own guardrail #8 ("do not sell expensive visibility until job quality and candidate supply can support it") anticipates — it isn't underpowered promotion, it's a product that doesn't do anything yet. This must be fixed or Trending must be pulled from sale before it's marketed as a paid tier.
4. **Invoice GSTIN is a placeholder** (`"GSTIN APPLIED FOR"` in `src/lib/invoice-pdf.ts`). The strategy doc's own §11 acceptance checklist requires "Employer can download a GST invoice" before charging real money — that box cannot be checked honestly until the real GSTIN (or confirmation that pre-registration invoicing is legally acceptable) is in from finance/legal.

## 3. Reconciling the strategy doc with `prompt structure/monetization.md`

`prompt structure/monetization.md` is the CLAUDE.md-designated authoritative distillation of the client's actual requirements, and it already describes (and the schema already implements) a **single-wallet, typed-consumption-order** model: resolve entitlement in order (plan quota → wallet credits → block), not a multi-ledger multi-grant system. The new strategy doc proposes a different architecture without referencing or reconciling with that doc.

Before implementation starts, these two documents need an explicit reconciliation, not silent divergence:

- Decide whether `unlocks_per_job` / `credits_per_unlock` / `tier_prices` stay as `plan_settings`/`plans.limits` admin-editable JSON (monetization.md's model, already built and working) or move into the strategy doc's `billing_products` / `billing_product_entitlements` tables. Recommendation below: keep the existing JSON-config model for entitlements that are plan-wide toggles, and only add new dedicated tables for things that need per-purchase lifecycle (expiry, remaining count) — which is a smaller set than the strategy doc assumes.
- Decide whether Classic+ stays a plan-only perk (monetization.md, already implemented — never purchasable with credits) — the strategy doc doesn't mention Classic+ at all in its catalogue (§4.2), which is a gap the doc should close rather than the codebase silently diverging from it.
- Response retention (60-day purge, `employer_visible` flag per monetization.md) isn't mentioned in the strategy doc at all — confirm it's still in scope and unaffected by this work; it's an existing P0 item, not superseded by this strategy.

## 4. Revised technical target model

Instead of the strategy doc's §7.1 (`billing_products`, `billing_product_entitlements`, `company_subscriptions`, `company_benefit_grants`, `company_benefit_ledger`, `billing_orders`, `promotion_campaigns`, `candidate_contact_access` — eight new tables replacing the working pipeline), evolve the existing five money tables in place:

| Existing table | Change | Why |
|---|---|---|
| `employer_credit_wallets` | Split the single `balance` into named balances — either separate columns (`job_post_balance`, `contact_balance`, `boost_balance`) or a new narrow `company_benefit_balances(company_id, benefit_type, balance)` table if a third named currency is likely later. Keep `apply_credit_delta()` as the single mutation choke point, parameterized by `benefit_type`. | Delivers the strategy doc's core principle ("one benefit, one name, one price unit") without discarding the row-locked, already-correct mutation function. |
| `credit_transactions` | Add a `benefit_type` column (mirrors the new balance split) alongside the existing `kind` enum (`purchase/unlock/boost/job_post/repost/refund/bonus/adjustment`, which already answers "why", not "which currency"). No new ledger table needed — this one is already append-only, RLS'd, and mirrored into `employer_activity`. | The strategy doc's `company_benefit_ledger` is this table with one more column, not a new table. |
| `credit_packs` | Add a `benefit_type` column so a pack is explicitly "10 job-post credits" or "25 contact credits" or "10 boost credits" rather than generic credits; keep price/badge/sort/active as-is. | Matches the strategy doc's §4.2/§4.3 catalogue directly; `billing_products`/`billing_product_entitlements` would duplicate this. |
| `plans` / `plan_settings` / `company_plans` | Keep as the subscription/entitlement model (already working). Fix the two bugs in §2. Add monthly-allowance columns to `plans.limits` for contact/boost credits if Growth/Pro subscriptions should include them (per strategy doc §4.3's Growth/Pro rows) — these are JSON keys, not new tables. | This already *is* the strategy doc's "Phase 2" — no replacement needed, only extension. |
| `job_unlock_allowance` | No structural change. Continue to be tried before `contact_balance`. Fix bug #1 (seed from the company's resolved plan limit, not the global singleton). | Already matches the strategy doc's job-scoped-allowance concept. |
| `job_boosts` / `boost_settings` | Change `apply_boost()` to debit the new `boost_balance` (via `apply_credit_delta(..., benefit_type='boost')`) instead of the generic balance. | Makes boost genuinely a separate currency, closing the gap identified in §1. |
| `razorpay_orders` / `invoices` | No structural change — `pack_id`/`plan_id` XOR check, GST computation, and idempotent fulfilment already satisfy the strategy doc's §7.3 accounting rules. Fix bug #4 (real GSTIN) before go-live. | Already production-grade; don't touch what isn't broken. |
| *(new, small)* `candidate_contact_access` | Worth adding as the strategy doc suggests **only if** contact access needs a visible expiry/renewal window distinct from the unlock event itself (`candidate_unlocks` currently has no expiry — access is permanent once unlocked). Decide in Phase 2 based on whether "90-day validity, optional rollover" for contacts (§4.2) is a real product requirement or can wait. | The one piece of the strategy doc's §7.1 table that isn't already covered by an existing table, *if* time-limited contact access is adopted. |
| *(not needed yet)* `promotion_campaigns` | Correctly deferred by the strategy doc itself to Phase 4 (CPC/PPSA). No schema work now. | — |

This keeps every already-working RPC (`activate_job_with_tier`, `get_company_entitlements`, `apply_boost`, `unlock_candidate`, `fulfill_razorpay_order`, `issue_credit_pack_invoice`/`issue_plan_invoice`) intact, changing their internals rather than replacing their tables — much lower risk for a pipeline that's already moving real Razorpay orders.

## 5. Phased implementation plan

### Phase 0 — Fix + reconcile (no new product, no pricing change)
**Duration:** ~1 week. **Owner gate:** ship before anything below is sold as chargeable.

- Fix bug #1: `tg_seed_job_unlock_allowance()` resolves the company's active plan (`get_company_entitlements()` or a direct `company_plans`/`plans.limits` lookup) instead of `plan_settings.unlocks_per_job`.
- Fix bug #2: delete `companies.plan_id`, repoint `company_auto_renew()` at `company_plans` directly (or, if removal is judged too invasive this close to other work, wire it as a strict mirror written inside `activate_company_plan()`/`switch_company_plan_to_basic()` — but prefer deletion to avoid a second source of truth).
- Fix bug #3: either implement `trending_bonus` in `feed_jobs()`/`feed_jobs_for_candidate()`'s scoring, or temporarily disable Trending as a purchasable tier until it does something. Do not leave it on sale silently inert.
- Fix bug #4: get the real GSTIN (or a documented legal sign-off on pre-GSTIN invoicing) into `src/lib/invoice-pdf.ts`'s `SELLER` constant.
- Write a short reconciliation note (in `prompt structure/monetization.md` or a changelog entry) confirming Classic+/response-retention/consumption-order rules from that doc are unchanged by this strategy — so the two docs don't silently drift.
- **Gate:** all four bugs closed; `prompt structure/monetization.md` and the strategy doc agree on Classic+, retention, and consumption order.

### Phase 1 — Named balances (the "one benefit, one name, one price unit" fix)
**Duration:** ~2 weeks.

- Add `benefit_type` to `employer_credit_wallets` (split into per-type balances) and to `credit_transactions` and `credit_packs`, per §4 above.
- Update `apply_credit_delta()` to take `benefit_type` and operate on the matching balance.
- Update `activate_job_with_tier()` to debit `job_post` balance, `apply_boost()` to debit `boost` balance, `unlock_candidate()`'s wallet-fallback branch to debit `contact` balance.
- Update `credits.tsx` to show three separate balance cards (Job Posts / Contacts / Boosts) instead of one wallet number, each with its own transaction history filter and its own pack-purchase CTA — this is the UI-level fix for the actual problem users see today (one undifferentiated "credits" screen).
- Backfill: convert existing `employer_credit_wallets.balance` into `job_post` balance for every company (documented, no silent value loss — matches strategy doc §8's migration-safety instinct), since job posts were the dominant historical use.
- **Gate:** every existing purchase/consumption flow still works against the split balances; ledger reconciles (sum of grants − consumption − refunds = balance) for every company in a test pass.

### Phase 2 — New named packs + subscription inclusions
**Duration:** ~2–3 weeks.

- Ship the strategy doc's test catalogue (§4.3) as real `credit_packs` rows with `benefit_type` set: Starter/Growth Job Pack, Sourcing 25/100 (contact), Boost Pack — priced as hypotheses to validate, not final.
- Extend `plans.limits` with monthly contact/boost allowances for Growth/Pro subscription tiers (JSON keys, no new table), and extend `get_company_entitlements()`'s usage-tracking to report consumption against those monthly allowances so "subscription inclusions spend first" (principle #3) is enforceable and visible.
- Decide on `candidate_contact_access` (time-limited contact validity) per §4's open question — build only if confirmed as a real requirement.
- **Gate:** matches strategy doc's Phase 1/Phase 2 gates — ≥95% automatic purchase reconciliation, zero double-debit incidents, subscription buyers demonstrably use ≥2 benefit types before declaring this phase done.

### Phase 3 — Controlled sourcing monetization + promotion integrity
**Duration:** ~3–4 weeks, gated on real usage data from Phase 2.

- Keep contact credits gated to verified beta employers per strategy doc §4/Phase 3, using the now-separate `contact` balance.
- Only proceed with export credits after legal review, per strategy doc — no schema work until then.
- Re-validate the Trending fix from Phase 0 with real boost-take-rate / qualified-application-lift data before expanding promotion pricing.
- **Gate:** strategy doc's Phase 3 gate (low fraud/complaint rate, measurable contact-to-interview value).

### Phase 4 — Performance campaigns & enterprise
Unchanged from the strategy doc's §9 Phase 4 and §6 Phase B — correctly the furthest out, correctly gated on attribution/fraud infrastructure that doesn't exist yet. No schema work now; revisit once Phase 3's data exists.

## 6. Decisions to get from the user/business before Phase 1 starts

1. **Architecture approval**: adopt the evolutionary path in §4 instead of the strategy doc's §7.1 eight-table rewrite? (This plan assumes yes — flag if a full rearchitecture was actually intended for other reasons, e.g. a planned migration off the current Supabase project where a clean-slate schema is cheaper than an in-place evolution.)
2. **Trending**: fix the ranking bonus now (Phase 0) or pull Trending from sale until it's fixed? Either is defensible; leaving it on sale unfixed is not.
3. **`companies.plan_id`**: confirm no other in-flight work depends on it before deleting it.
4. **Contact access expiry**: is "90-day validity, optional rollover" for `contact_credit` (strategy doc §4.2) a hard requirement, or is permanent access (today's actual behavior) acceptable for the beta? Determines whether `candidate_contact_access` gets built in Phase 2.
5. **Pricing numbers**: everything in the strategy doc's §4.3 catalogue is explicitly marked as hypotheses to test, not final — Phase 0/1 engineering work does not depend on final prices, but Phase 2's real pack rows do; get at least directional sign-off before Phase 2 starts.

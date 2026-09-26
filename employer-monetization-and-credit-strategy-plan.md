# JobsKart Employer Monetization & Credit Strategy

## Status and decision

**Status:** proposed replacement for the current test-only pricing model. No production price or entitlement in this document is final until it passes the experiments in Phase 0.

**Decision:** JobsKart should use a **hybrid employer monetization model**:

1. a small free entry tier to preserve marketplace liquidity;
2. prepaid **Job Posting Credits** for occasional employers;
3. monthly **Active Job Slot subscriptions** for repeat employers;
4. separate **Candidate Contact Credits** for database sourcing; and
5. a distinct, budget-capped **Promotion product** for extra visibility.

Do not use one generic wallet for all five types of value. The employer must always understand what they are buying, what it unlocks, when it expires, and what happens when it is consumed.

## 1. Problem to solve

JobsKart currently has useful building blocks—credit packs, employer wallet, candidate unlocking, job tiers, boosts, plans, Razorpay order verification, invoices, and an audit ledger. However, the current test model mixes several unrelated value units into one balance:

- a candidate contact unlock;
- a job post once a plan quota is exhausted;
- a job boost;
- potential reposts.

This makes price communication difficult and causes weak plan differentiation. A credit that can mean “one candidate contact,” “part of a job post,” or “one boost” has no intuitive value to an employer.

The objective is not simply to charge more. The objective is a system that creates a clear exchange:

| Employer need | What JobsKart sells | Employer sees as success |
|---|---|---|
| “I need one person now” | One-off job posting | Qualified applications |
| “I hire every month” | Active job slots / subscription | Predictable monthly cost |
| “Applicants are not enough” | Candidate contact credits | Relevant people to contact |
| “This role is urgent” | Promotion budget | More relevant application starts |
| “My team hires at scale” | Seats, workflow, custom contract | Faster recruiter productivity |

## 2. Benchmark: how established portals package value

### 2.1 Apna — prepaid job packs + database credits + subscription

Apna separates the employer journey into job credits, database credits, AI job credits, subscription, and enterprise plans.

- Job credits are prepaid and expiring. Its published conversion is 1 credit for a Classic job, 2 for Premium, and 4 for Super Premium.
- Database consumption is distinct: 1 database credit unlocks one profile/contact, while unlock plus Excel download costs 2; a later export of an already unlocked profile costs 1.
- It also offers bundle, job-only, and database-only purchases.
- Its Unlimited product permits unlimited posts over the term but limits concurrent active jobs; it adds database credits, city/cluster scope, dashboard management, renewals, upgrades, and sales-led enterprise plans.

**Lesson for JobsKart:** Separate the unit of value. Prepaid credits work well for occasional hiring; active slots work well for frequent hiring; contact access should be priced separately from application receipt.

Sources: [Apna credit types](https://employer-help-centre.apna.co/support/solutions/articles/1060000124751-what-are-the-credits-), [job-credit conversion](https://employer-help-centre.apna.co/support/solutions/articles/1060000124770-how-many-jobs-can-be-posted-under-1-credit-), [database-credit consumption](https://employer-help-centre.apna.co/support/solutions/articles/1060000120759-what-is-apnadatabase-how-can-i-access-it-with-credits-), [Unlimited plan](https://employer-help-centre.apna.co/support/solutions/articles/1060000153943-what-are-the-features-of-the-apna-unlimited-plan-).

### 2.2 Indeed — free supply + performance-priced promotion

Indeed combines limited free posting with Sponsored Jobs. Sponsored jobs use a budget and are charged on candidate engagement—pay-per-click in some arrangements or pay-per-started-application in others. Its Standard, Premium, and Premium Plus levels add visibility, targeting, matching, and automation. Employers can pause/close promotion and cap budget.

**Lesson for JobsKart:** Visibility should eventually be sold as a capped campaign with measurable outcomes, not as an unbounded promise of “top position.” Performance pricing only works after JobsKart has sufficient search/apply volume, anti-fraud controls, and dependable attribution.

Sources: [Indeed pricing model](https://www.indeed.com/hire/resources/howtohub/how-pricing-works-on-indeed), [PPSA explanation](https://www.indeed.com/help/employers/articles/pay-per-started-application-ppsa-overview), [sponsored-job levels](https://www.indeed.com/hire/cs/pricing).

### 2.3 LinkedIn — occasional self-serve, annual slots, recruiter seats

LinkedIn differentiates hiring frequency:

- occasional employers can post free or use a capped, cost-per-click promotion budget;
- employers hiring year-round buy Job Slots, prepaying a contract that lets them rotate roles into active promoted slots;
- recruiting teams buy Recruiter seats with advanced search, outreach and collaboration; enterprise pricing is negotiated.

**Lesson for JobsKart:** active slots are the right subscription primitive. The employer pays for simultaneous hiring capacity, not an arbitrary number of drafts. Seat-based pricing should wait until team collaboration and sourcing workflow have real value.

Sources: [LinkedIn Job Slots](https://business.linkedin.com/hire/post-jobs/job-slots), [Jobs vs. Job Slots](https://business.linkedin.com/hire/product-comparison/jobposts-vs-jobslots), [India Hiring Pro pricing](https://business.linkedin.com/in/en/hire/hiring-pro/pricing), [Recruiter pricing approach](https://business.linkedin.com/hire/recruiter/pricing).

### 2.4 Market-model conclusion

| Model | Best for | Do now? | Reason |
|---|---|---|---|
| Free basic posting | Candidate and employer supply growth | Yes, with abuse controls | A new marketplace needs listings and applicants |
| Prepaid job packs | Occasional/seasonal employers | Yes | Simple, predictable, no recurring commitment |
| Active-slot subscription | Frequent hiring | Yes | Clear recurring value and stable revenue |
| Candidate contact credits | Database sourcing | Later/controlled | Valuable only once database density and consent are strong |
| Fixed boost tokens | Early-stage promotion experiment | Yes, limited | Easy to explain before performance attribution exists |
| CPC/PPSA campaign auction | Mature promotion marketplace | Later | Needs volume, fraud prevention, pacing and billing accuracy |
| Recruiter seats / ATS / enterprise | Larger teams | Later | Requires collaboration, roles, auditability and support |

## 3. JobsKart product principles

1. **One benefit, one name, one price unit.** “Job Posting Credit” must never be spent on a database contact.
2. **Charge for high-intent employer value, not candidate access by default.** Applying remains free for candidates.
3. **Subscription inclusions spend first; paid top-ups spend second.** The billing explanation must say this clearly.
4. **Show a maximum price before any charge.** No surprise debits, especially for promotion.
5. **Use active slots, not unlimited active jobs.** “Unlimited” can mean unlimited replacement posts during a term, subject to an explicit simultaneous-job cap.
6. **Make expiry visible at purchase and in the balance UI.** Oldest-expiring entitlement is consumed first.
7. **Never charge twice for the same candidate contact under the same employer, unless the product explicitly sells renewed access after a defined period.**
8. **Do not sell expensive visibility until job quality and candidate supply can support it.** Promotion with no candidate traffic damages trust.
9. **Keep the ledger append-only, server-authoritative, idempotent, and auditable.** A client must never mutate a balance.
10. **Use plans to simplify, not to trap.** Upgrade immediately only if new benefits are clear; downgrades take effect at renewal; cancellation stops renewal but preserves paid period access.

## 4. Recommended JobsKart catalogue

### 4.1 Employer segments

| Segment | Typical behaviour | Product path |
|---|---|---|
| First-time micro employer | 1–2 roles, uncertain volume | Free trial → Starter job pack |
| Occasional SME | Seasonal / a few roles per quarter | Job-credit packs + optional promotion |
| Regular local employer | Several open roles monthly | Growth subscription with slots + inclusions |
| Recruitment agency / multi-location business | Ongoing high volume | Pro/Business subscription, multiple users, custom terms |

### 4.2 Benefits and their consumption rules

| Benefit type | Used for | Unit | Recommended validity | Key rule |
|---|---|---:|---:|---|
| `job_post_credit` | Publish an eligible Classic role | 1 per post | 90–180 days | Post stays live for stated duration; close/repost policy explicit |
| `premium_post_credit` | Publish a higher-distribution role | 1 per post | 90–180 days | Do not call it Premium until placement/benefit is measurable |
| `contact_credit` | Reveal candidate contact/resume | 1 per candidate | 90 days; optional rollover | Idempotent per company/candidate/access window |
| `export_credit` | Permanent CSV/Excel export | 1 per candidate | 90 days | Separate from contact credit because permanent data has higher value/risk |
| `boost_credit` | Fixed-time promotional placement | 1 per boost | 90 days | One boost per job/day; duration and expected exposure disclosed |
| `subscription_allowance` | Included plan benefit | monthly allocation | Billing-cycle bound | Spends before top-ups; does not transfer to cash |

The first production release should offer only `job_post_credit`, `contact_credit`, and `boost_credit`. Do not introduce AI credits or export credits until their respective product has reliable usage, value, consent, and support processes.

### 4.3 Test catalogue — not final public pricing

These are **price hypotheses to test**, not a commitment. Prices exclude GST; finance/legal review is required before sale.

| Offer | Suggested test price | Includes | Purpose |
|---|---:|---|---|
| Free | ₹0 | 3 active slots, 30-day Classic posts, 0–5 one-time contact trial credits | Build supply; show core value |
| Starter Job Pack | ₹1,499 | 3 job-post credits, 90-day validity | Occasional employer entry point |
| Growth Job Pack | ₹3,999 | 10 job-post credits, 120-day validity | Pack-discount anchor |
| Sourcing 25 | ₹999 | 25 contact credits, 90-day validity | Test database willingness-to-pay |
| Sourcing 100 | ₹3,299 | 100 contact credits, 120-day validity | Volume discount without over-discounting data |
| Boost Pack | ₹799 | 10 boost credits, 90-day validity | Test urgency/visibility demand |
| Growth subscription | ₹2,499/month | 5 active slots, 10 post credits/month, 25 contact credits/month, 2 boosts/month | Convert repeat local employers |
| Pro subscription | ₹5,999/month | 15 slots, 30 post credits/month, 100 contact credits/month, 8 boosts/month, 3 recruiter seats | Higher-frequency teams |
| Business / Enterprise | Quote | custom slots, credits, seats, onboarding, integrations, SLA | Sales-led only |

Pricing guardrails:

- Keep subscription unit economics attractive only for a true repeat buyer; otherwise packs should be cheaper for low usage.
- Do not offer a plan with unlimited candidate contact access.
- Do not use a single “Unlimited” label without displaying the active-slot cap, fair-use limits, and included contact credits.
- Test 2–3 price points by employer cohort; do not A/B test different prices for an employer who can see the alternatives in the same account.
- Use introductory beta discounts as explicit time-limited promotions, never as hidden permanent pricing.

## 5. Recommended package behaviour

### Free

- Max 3 concurrent active jobs.
- 30-day job life, basic placement and applicants.
- No database contact purchase until employer verifies business and job quality is approved.
- One small, clearly labelled trial only after trust checks.
- Strict anti-spam limits, approval rules and candidate-report handling.

### Packs

- Purchase job, contact, and boost packs separately; bundles can be offered as a named “Hiring Kit” but must show the component balances.
- A job-post credit is consumed only when the job passes review and becomes active, not on saving a draft or a rejected post.
- Refund a credit automatically if JobsKart rejects the job before it becomes active. Do not refund for a role closed by the employer after publication except under a stated policy.
- Contact credits are consumed at contact reveal, not on search-result view.
- Show expiry date and remaining amount for every purchased grant.

### Subscriptions

- Start as a 30-day paid period with manual renewal during beta; add Razorpay autopay only after cancellation, failed-payment and invoice workflows are tested.
- Slots are reusable: closing/expiring a job frees a slot immediately, enabling a replacement job.
- Included monthly credits expire at cycle end by default; allow a modest contact-credit rollover (for example one following cycle) only after confirming it does not create a large liability.
- Purchased top-up credits remain separate from subscription allowance and use their own expiry date.
- Upgrade: activate new higher capacity immediately; calculate a transparent prorated charge/credit.
- Downgrade/cancel: take effect at the next renewal; never abruptly close existing valid jobs.

## 6. Promotion strategy: fixed boost first, performance campaign later

### Phase A — fixed boost credit

Use the existing boost concept while supply is growing:

- One credit gives a documented time window, e.g. 24 hours.
- Restrict it to quality-approved, active jobs; one boost per job per day; cap company daily boosts.
- Label the job `Boosted` for candidate transparency.
- Explain that boosted means greater eligible-feed weighting, not a guaranteed number of applications.
- Exclude jobs already applied to by a candidate from candidate discovery before ranking, so paid exposure is not wasted.

### Phase B — cost-per-started-application campaign

Only consider after all gates are met:

- reliable event attribution for job impression, job detail view, apply start, submitted application and invalid/fraud event;
- enough traffic to provide consistent delivery;
- a minimum quality threshold for sponsored jobs;
- a budget cap, pause, refund/credit policy, pacing system and dispute process;
- bot/fraud detection and duplicate-application controls.

The campaign should use a prepaid budget reservation. Charge only for an eligible, deduplicated apply-start or submitted application according to the announced contract; never charge twice for retries from the same event ID.

## 7. Technical target model

### 7.1 Replace the single generic wallet with benefit grants and an immutable ledger

The current `employer_credit_wallets.balance` model is suitable for a simple single currency but becomes ambiguous once different credits have different values and expiration. Use a grant-based model.

```text
catalogue offer purchased
        │
        ▼
benefit_grant (type, quantity, remaining, expires_at, source)
        │ oldest-expiring eligible grant first
        ▼
consume_benefit() transaction
        ├─ resource-level idempotency check
        ├─ lock grant rows
        ├─ decrement grant(s)
        ├─ create benefit_ledger rows
        └─ perform action / create entitlement atomically
```

Recommended tables:

| Table | Responsibility |
|---|---|
| `billing_products` | Versioned purchasable items: one-time packs, subscriptions, add-ons |
| `billing_product_entitlements` | Product → benefit type, quantity, validity, renewal allocation rule |
| `company_subscriptions` | Company plan, period, status, renewal/cancellation details |
| `company_benefit_grants` | Actual issued balance by company/type/source/expiry/remaining amount |
| `company_benefit_ledger` | Immutable every grant, consume, refund, expire, adjustment event |
| `billing_orders` | Frozen quote, payment reference, fulfilment status, invoice relation |
| `promotion_campaigns` | Budget, status, pacing, spend, target, event reconciliation |
| `candidate_contact_access` | Company + candidate + access type + access expiry + source job |

Suggested benefit type enum:

```text
job_post_credit | premium_post_credit | contact_credit |
export_credit | boost_credit | active_job_slot | recruiter_seat
```

`active_job_slot` should normally be represented by a plan limit, not a decrementing credit, but it remains an entitlement category in reporting.

### 7.2 Essential billing operations

Each must be a server-side RPC/service using the authenticated company membership, row locks and idempotency keys:

1. `quote_order(product_id, company_id)` — freezes tax, item, price, entitlement, currency and expiry rule.
2. `fulfill_paid_order(payment_id)` — idempotently marks paid, issues benefits, invoice, and ledger entries.
3. `consume_job_post_credit(job_id)` — locks draft, validates employer/job approval, consumes one eligible post credit, activates role.
4. `claim_active_slot(job_id)` — checks current live jobs against plan cap in the same transaction.
5. `consume_contact_credit(job_id, candidate_id)` — validates job is active, checks existing contact access, then consumes contact credit only once.
6. `consume_boost_credit(job_id)` — validates time/cap/quality rules, consumes boost benefit and creates boost record atomically.
7. `expire_benefit_grants()` — scheduled expiry job, ledgered and notified.
8. `cancel_subscription()` / `change_subscription()` — state change with explicit effective date, no implicit clawback.

### 7.3 Security, consistency and accounting rules

- All money/benefit mutations occur only in server-side functions. Browser code may request an action but never submits an amount/price to trust.
- Use `auth.uid()` plus company membership. Do not authorize from `user_metadata`.
- Every paid order has a unique payment reference; fulfilment must be idempotent across client confirmation and webhook delivery.
- Snapshot product price, tax, entitlement quantity, validity and description in the order. Editing catalogue prices later must not alter a completed purchase.
- Use integer counts for credits and paise for money; never floating point money.
- RLS: a company member reads only their company’s orders, grants, ledger and invoices. The service role performs fulfilment. Admin adjustments require separate audit reason.
- Create a unique resource-consumption guard: for example `(company_id, candidate_id, access_type, access_expires_at)` logic for contact access, and `(job_id, boost_day)` for daily boosts.
- Use transaction-level locks when a limit is counted (active slots, monthly allocation) to prevent two browser tabs consuming the final entitlement.
- Expiration must produce an immutable ledger event. Never silently reduce a displayed balance.

## 8. Migration from current JobsKart test model

### What to preserve

- Razorpay signature verification, webhook fulfilment and invoice generation.
- Company-scoped membership checks and RLS patterns.
- Job draft → server-authoritative publish flow.
- Existing candidate unlock idempotency concept.
- Existing boost caps and audit activity.

### What to replace

| Current object | Migration direction |
|---|---|
| `employer_credit_wallets` | Retire after migration; derive balances from active grants or maintain a non-authoritative read model |
| `credit_packs` | Convert to versioned products with explicit benefit types |
| `credit_transactions` | Migrate to typed immutable benefit ledger; preserve legacy rows as history |
| `company_plans` | Evolve to subscription periods with plan-version snapshot and renewal intent |
| global `plan_settings.unlocks_per_job` | Move allowance to the purchased plan/product entitlement; eliminate global/plan mismatch |
| generic job tier prices | Make each post type an explicit entitlement or price rule |

### Safe sequence

1. Audit current live/test payment and wallet data; do not change prices or tables yet.
2. Add new catalogue/grant/ledger tables alongside current tables, all with RLS.
3. Implement read-only entitlement resolver that compares old wallet result with new grants for test companies.
4. Backfill every existing positive wallet balance into an `legacy_credit` grant with a documented conversion rule and no silent value loss.
5. Route internal/test companies through new fulfilment and consumption functions behind a feature flag.
6. Validate ledger reconciliation: grants − consumption − expiry + refunds equals remaining balance for every company.
7. Migrate UI to show separate balances and usage history.
8. After a defined reconciliation period, disable old wallet mutation paths; retain legacy records read-only for audit.

## 9. Phased product rollout

### Phase 0 — measurement and willingness-to-pay research

Duration: 2–3 weeks.

- Interview 10–15 employers across local services, retail, logistics and agencies.
- Ask which outcome they pay for: post, slot, contact, response, shortlist or hire.
- Run a fake-door / interest test for packs, subscriptions, sourcing and boost—not a real charge until the backend is ready.
- Measure job fill rate, application quality, candidate database coverage, and employer repeat-post rate by role/city.
- Select only two primary buyer personas for beta; avoid an eight-plan catalogue.

**Gate:** Do not sell contact credits where candidate contact coverage or candidate consent is too low to deliver value.

### Phase 1 — clear beta catalogue

Duration: 2–4 weeks.

- Ship Free, Starter Job Pack, Growth Job Pack, and fixed Boost Pack.
- Keep database sourcing gated to verified beta employers.
- Implement grant/ledger model and entitlement UI.
- Display validity, remaining amount, exact consumption rule, tax and invoice before checkout.

**Gate:** ≥95% of successful purchases reconcile automatically; zero double-debit incidents; support can explain each transaction from ledger data.

### Phase 2 — recurring active-slot subscription

Duration: 3–5 weeks.

- Introduce Growth subscription only after repeated employer usage is demonstrated.
- Include slots, job posting credits, small contact allocation and boosts.
- Manual renewal initially; support renewal reminders and plan-end grace messaging.
- Implement plan upgrade/downgrade rules before enabling self-serve changes.

**Gate:** subscription buyers use at least two included benefit types and renewal intent exceeds a pre-agreed target; otherwise simplify rather than adding plans.

### Phase 3 — controlled sourcing monetization

Duration: 3–6 weeks.

- Add separate contact-credit packs; show search for free, charge at contact reveal.
- Add candidate consent/visibility controls, rate limits, audit logs, one-company-one-contact guard, and contact-access expiry.
- Add export credits only after data export legal review and anti-scraping controls.

**Gate:** low fraud/complaint rate and measurable contact-to-conversation or contact-to-interview value.

### Phase 4 — performance promotion and enterprise

- Pilot prepaid campaign budgets on a small set of verified employers.
- Add business teams/seats, multi-location controls, approval workflows, ATS export/integration, and custom contracts only where sales demand exists.
- Add autopay only after billing operations, refunds, cancellations and failed-payment recovery are proven.

## 10. Experiments and metrics

### Core marketplace health metrics

- Active jobs, qualified applications/job, candidate response rate, time to first qualified application, time to fill.
- Candidate complaint/report rate and employer rejection rate.
- Jobs per candidate discovery session; applied-job impressions must remain zero after the discovery-feed fix.

### Monetization metrics

- Employer activation: verified employer → first published job.
- Pack conversion and revenue per active employer.
- Subscription conversion, renewal/cancellation, allowance utilisation, unused-benefit expiry.
- Contact-credit consumption, contact-to-reply, contact-to-interview and duplicate-contact rate.
- Boost take rate, incremental qualified-application lift versus matched unboosted control jobs.
- Payment failure, refund, dispute and ledger-reconciliation rate.

### Guardrails

- Never optimise revenue by reducing candidate quality or hiding free jobs unfairly.
- Do not claim a boost caused a hire without causal evidence.
- A campaign should stop at its declared budget, even when events arrive late; reconcile delayed events under a published policy.
- Monitor pricing by role/city to avoid systematic exclusion of small/local employers.

## 11. Acceptance checklist before charging real money

- [ ] Every catalogue item has exact inclusion, expiry, tax and cancellation language.
- [ ] UI exposes separate Job, Contact and Boost balances—no generic “credits.”
- [ ] Ledger reconciliation works across successful payment, duplicate webhook, failed payment, refund, expiration and admin adjustment.
- [ ] A job credit is not consumed by a draft, rejected job or payment retry.
- [ ] Candidate contact access is idempotent and consent-protected.
- [ ] Subscription slot cap cannot be exceeded through concurrent browser sessions.
- [ ] Admin price edits cannot change an existing order or benefit grant.
- [ ] Employer can download a GST invoice and inspect every consumption event.
- [ ] RLS and function permissions are tested for company isolation.
- [ ] Customer support has a transaction explanation and refund playbook.

## 12. Final recommendation

Adopt **Apna’s separation of job and database value**, **LinkedIn’s active-slot subscription model**, and **Indeed’s budget-capped, outcome-aware promotion model**—but introduce them in that order and only when JobsKart’s marketplace maturity supports them.

For the immediate beta, launch a simple Free + Job Pack + Boost Pack model. Add separate candidate-contact credits only after verified employer demand and sufficient candidate inventory. Add subscriptions when employers are returning every month. Delay CPC/PPSA and enterprise complexity until JobsKart has reliable traffic, event attribution, anti-fraud controls and a support operation.

That sequence is clearer for employers, safer for candidates, easier to implement correctly, and more likely to create sustainable recurring revenue than a single interchangeable credit balance.

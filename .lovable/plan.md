# JobsKart: Apna-style Mobile-First Flow + Resume AI + Employer Credits

## 1. Unified mobile-first auth (no separate signup forms)

New flow on `/auth?role=candidate|employer`:

1. **Role chip** (Candidate / Employer) — picked first, stored in URL.
2. **Mobile entry** → `+91 XXXXXXXXXX` → "Send OTP".
3. **OTP screen** → any 6-digit code accepted (demo).
4. After verify, server fn `resolveMobileAccount` decides:
   - If a `profiles` row exists for that mobile AND its `user_type` matches selected role → sign in → go to that role's `/dashboard`.
   - If profile exists but role differs → error "This number is registered as <other role>".
   - If no profile → auto-create `auth.users` + `profiles` row with `user_type = role`, sign in, redirect to onboarding.
5. Delete the legacy `/signup.candidate` and `/signup.employer` routes; redirect both to `/auth`.

Implementation: extend `auth-mobile.functions.ts` with `loginOrCreateWithMobile({ mobile, role })` using `supabaseAdmin.auth.admin.createUser` when missing, then mint magic link as today.

## 2. Candidate onboarding — Resume-first

New first step in `/onboarding/candidate`: **"Upload resume, we'll fill the rest"**.

- Drag/drop PDF or DOCX → uploads to `candidate-docs` bucket (already exists).
- New server fn `parseResume` (`src/lib/resume.functions.ts`):
  - Loads the file, sends to Lovable AI Gateway (`google/gemini-3-flash-preview`) as multimodal `file` part with structured-output schema (Zod): `full_name, email, headline, years_experience, skills[], experiences[], education[], city`.
  - Returns parsed JSON; client pre-fills the 6-step Questionnaire.
- "Skip & fill manually" link preserves current flow.
- Show parsing progress (Lucide `Loader2`, `FileText`, `Wand2`).

## 3. Employer side: Apna-style portal

Redesign `/employer/*` to match the reference shot's information density and clarity (left rail + main panel), but using our JobsKart blue brand:

- **Left rail** (sticky, collapsible on mobile): company switcher, nav (Jobs, Database, Reports, Credits & Usage, Billing, Help), credit status card with "Buy credits" CTA.
- **Jobs page** (`/employer/jobs`): list with `Applied to job` and `Database Matches` counters per row, Expired/Active chips, "Repost now" action, three-dot menu (Edit, Pause, Close, Share).
- **Database** (new route `/employer/database`): searchable candidate list (filter by city, skills, experience, work mode). Each candidate row shows masked contact + "Unlock" button that deducts 1 credit.
- **Reports** (stub charts: applications/day, sources, funnel).
- **Credits & usage** (`/employer/credits`): balance card, packs grid (e.g. 100/500/2000 credits), recent transactions table.
- **Post a job** wizard: cleaner 3-step (Basics → Requirements → Preview & Publish).

## 4. Database credits + Razorpay full integration

### Schema (migration)
```
credit_packs(id, name, credits, price_inr, badge, sort, active)
employer_credit_wallets(company_id PK, balance int, updated_at)
credit_transactions(id, company_id, kind enum[purchase,unlock,refund,bonus],
  delta int, balance_after int, reference jsonb, created_at)
candidate_unlocks(id, company_id, candidate_user_id, unlocked_by, credits_spent,
  created_at, UNIQUE(company_id, candidate_user_id))
razorpay_orders(id, company_id, pack_id, amount_inr, razorpay_order_id,
  razorpay_payment_id, status, created_at)
```
All with GRANTs + RLS scoped via `has_company_membership(auth.uid(), company_id)`.

Seed 4 packs (Starter 100 / Growth 500 / Pro 2000 / Enterprise 10000).

### Server functions (`src/lib/credits.functions.ts`)
- `getWallet(companyId)`
- `listPacks()`
- `createRazorpayOrder({ companyId, packId })` → calls Razorpay Orders API with `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`, persists pending row, returns `{ orderId, amount, keyId }`.
- `verifyRazorpayPayment({ orderId, paymentId, signature })` → HMAC-SHA256 verify with secret, on success: credit wallet, insert `credit_transactions`, mark order paid. Atomic via `plpgsql` function.
- `unlockCandidate({ companyId, candidateUserId })` → check balance ≥ 1, decrement, insert unlock row, return contact (mobile/email).

### Webhook
`/api/public/webhooks/razorpay.ts` server route: verify `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET`, idempotent credit on `payment.captured`.

### Client checkout
- Load Razorpay checkout script via `<script>` tag in `__root.tsx` head.
- Buy button → `createRazorpayOrder` → open `Razorpay({ key, order_id, … handler })` → on success call `verifyRazorpayPayment` → toast + refresh wallet.

### Secrets needed
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (will request via add_secret after plan approval).

## 5. Candidate dashboard

- Hero card: profile strength, resume status, "Edit profile" + "Upload new resume".
- **Recommended jobs** grid: pulled from `jobs` filtered by candidate skills/city.
- Saved jobs row, recent applications timeline with status pills.
- Browse jobs (`/jobs`) gets filter chips: role, city, work mode, salary, freshness.

## 6. Design polish (all screens, mobile-first)

- Stick to JobsKart blue `#1A55BD` primary + emerald success accent, neutrals from existing tokens.
- Lucide-only icons; remove any remaining sparkle/star UI.
- Responsive grid: `grid-cols-[minmax(0,1fr)_auto]` headers per the responsive-layout rule.
- Reuse `Questionnaire` primitives, `BigInput`, `OtpInput`, `card`/`badge`/`tabs` from shadcn.
- Empty states with illustration + concrete next action.

## 7. Routes touched / added

```
Added:
  src/routes/_authenticated/employer/database.tsx
  src/routes/_authenticated/employer/credits.tsx
  src/routes/_authenticated/employer/reports.tsx
  src/routes/api/public/webhooks/razorpay.ts
  src/lib/resume.functions.ts
  src/lib/credits.functions.ts
  src/components/employer/SideRail.tsx
  src/components/employer/CreditWidget.tsx
  src/components/candidate/ResumeUpload.tsx

Rewritten:
  src/routes/auth.tsx                 (mobile-first, auto signup)
  src/lib/auth-mobile.functions.ts    (loginOrCreateWithMobile)
  src/routes/_authenticated/onboarding/candidate.tsx (resume-first)
  src/routes/_authenticated/employer/dashboard.tsx
  src/routes/_authenticated/employer/jobs.tsx
  src/routes/_authenticated/employer/jobs.new.tsx
  src/routes/_authenticated/candidate/dashboard.tsx

Removed (redirect to /auth):
  src/routes/signup.candidate.tsx
  src/routes/signup.employer.tsx
```

## Acceptance

- One mobile number → one role → no signup form anywhere.
- Resume upload pre-fills onboarding via Gemini.
- Employer can buy credits via real Razorpay test-mode checkout and unlock candidate contacts; balance + transactions visible.
- All dashboards & onboarding usable on 360px width with Lucide icons and brand palette.

## Technical notes

- Resume parsing uses `google/gemini-3-flash-preview` with `Output.object` Zod schema; PDFs sent as `{type:"file", file:{filename, file_data:"data:application/pdf;base64,..."}}`.
- Razorpay verify uses `crypto.createHmac('sha256', secret).update(orderId+'|'+paymentId).digest('hex')` with `timingSafeEqual`.
- Wallet updates wrapped in a `security definer` SQL function `apply_credit_delta(company_id, delta, kind, reference)` to avoid races.
- All new tables receive `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated` + `service_role`; RLS uses `has_company_membership`.

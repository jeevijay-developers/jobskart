## Scope
Apply every item in Vikas' 18/07/26 doc across employer, admin, candidate, and public surfaces. Grouped by system, each item ties to a concrete change.

## 1. Consultant accounts
- Add `is_consultant` flag on `companies` (asked during employer onboarding: "Are you a hiring consultant?").
- On job-post wizard (`employer/jobs.new.tsx`, `jobs.bulk.tsx`): if consultant, show **optional** "Company you're hiring for" field → stored on `jobs.hiring_for_company`.
- T&C toggle: consultant may show their own brand/logo on job cards "at their own risk" (checkbox on company profile). Show a disclaimer chip on public JD when consultant.

## 2. Job-post lifecycle & database access
- New column `jobs.responses_locked_after` (= `expires_at + 7 days`). After that date:
  - Employer cannot open responses or database rows tied to that job.
  - Show a red banner on `/employer/responses` and `/employer/database`: "Access to responses & database ended 7 days after job expiry. Renew the post to unlock."
- Database tab (`employer/database.tsx`) is **only** reachable if the employer has ≥1 live (active + non-expired) job. Otherwise show empty-state CTA "Post a job to search the database". Remove any standalone entry point.

## 3. Excel downloads + audit
- Add "Download Excel" on responses and unlocked-profiles views. Per-account cap **300 rows/day** enforced in a server fn (`downloads.functions.ts`) reading a new `download_ledger` table (user_id, kind, count, day).
- Every download inserts into `download_events` (user_id, company_id, kind, count, ip). Super admin dashboard gets a live feed (`admin/downloads.tsx`) + realtime toast via Supabase channel.

## 4. Notifications (web + WhatsApp) with image
- Extend `notifications` schema with `image_url`. NotificationBell renders thumbnail.
- WhatsApp send helper (`lib/whatsapp.functions.ts`) accepts `mediaUrl`; used by job-alert + response alerts.
- Social sharing: add OpenGraph tags on `/jobs/$jobId` head() (title, description, `og:image` from company logo or generated card) so shared links auto-format on WhatsApp/LinkedIn. Add "Share" menu with pre-filled text.

## 5. Chrome-extension T&C
- Static `/legal/whatsapp-extension` page with T&C; the extension itself is out of scope but the app enforces the 50 msg/day/user cap via `whatsapp_send_ledger` and returns 429 when exceeded.

## 6. KYC / verification
- New `/employer/verification` route with three tabs:
  - **A. GST/PAN/CIN** — instant form (GST number lookup stub → auto-fills company name/address; writes to `company_verifications`).
  - **B. Business email OTP** — send OTP to work email via existing OTP infra.
  - **C. Manual KYC** — upload LLP/license/address proof/Aadhaar; goes to admin queue (`admin/verifications.tsx`) for approve/reject.
- Company profile shows verification badge state (Pending / Verified / Rejected).

## 7. Plans, top-ups & credit rules
- `plans` table (name, price, includes: job_slots, db_unlocks, whatsapp_alerts, downloads_per_day, custom flag).
- Purchases ≥ ₹10,000 unlock a **Custom Plan Builder** (`employer/plans/custom.tsx`) — admin-set sliders for each limit.
- Coin exhaustion: unlocking a candidate profile deducts **5 credits** (constant in `lib/credits.functions.ts`, enforced server-side).
- Free-plan matrix in DB (`plan_settings` singleton row, editable in `admin/plans.tsx`):
  - Free job-post ON/OFF, response cap (variable), WhatsApp cap 500/post over 30 days, RM support = true, validity 30 days.
  - Free plan: responses free, DB unlocks disabled (button shows upsell).
  - Free WhatsApp alerts 1000 for **Rajasthan only** (not PAN India). Enforced by candidate-city check in the alert dispatcher.

## 8. Anti-spam / unauthorised access
- Cron server-fn `detectSpamPosting` runs hourly: if a client posts > N jobs/hour (admin-set threshold), auto-suspend WhatsApp alerts for that client and flag `companies.spam_suspected=true`. Admin sees them under `admin/spam-review.tsx`.
- If client has not opened responses within 7 days of posting, dispatcher stops candidate WhatsApp alerts for that job and sends the employer a reminder ("Check your responses first"). Admin can override.

## 9. Invoicing
- Placeholder module `employer/invoices.tsx` showing existing Razorpay invoices with download PDF. **In-app vs Zoho decision noted as pending on Vikas** — leave interface stubbed with a TODO note (no fake integration).

## 10. Cities & serviceability
- Master data: mark all Rajasthan cities `launched=true` in one migration (single "Launch Rajasthan" toggle in `admin/masters.tsx`).
- PAN India job posting stays open and free: no credit deduction for jobs posted in un-launched cities on any paid plan (skip in `credits.functions.ts`).
- Onboarding city picker (`employer/company.tsx`, `jobs.new.tsx`): if city not launched, show serviceability warning + "Receive applications from anywhere in India" checkbox that widens matching.

## 11. Relevance scoring
- Add stub score column + weight config placeholder (`match_scoring_config`) — leaves room for Vikas's team without shipping the algorithm.

## Schema changes (single migration)
```
companies: is_consultant bool, allow_brand_display bool, spam_suspected bool
jobs: hiring_for_company text, responses_locked_after timestamptz
company_verifications (id, company_id, method enum, status enum, docs jsonb, notes, created_at)
download_ledger (user_id, kind, day, count)  -- PK (user_id,kind,day)
download_events (id, user_id, company_id, kind, count, created_at, ip)
whatsapp_send_ledger (user_id, day, count)   -- PK (user_id,day)
plans (id, name, price, limits jsonb, is_custom)
plan_settings (id=1, free_post_enabled bool, free_response_cap int, ...)
match_scoring_config (id=1, weights jsonb)
notifications: add image_url text
```
All tables get GRANTs + RLS + policies per project rules.

## Server functions
`downloads.functions.ts`, `whatsapp.functions.ts`, `verification.functions.ts`, `spamDetect.functions.ts`, `customPlan.functions.ts`, `consultantJob.functions.ts`.

## UI additions
- Employer: `/employer/verification`, `/employer/invoices`, `/employer/plans/custom`, banners on responses/database, consultant fields on job wizard, share menu on JD.
- Admin: `/admin/verifications`, `/admin/downloads`, `/admin/spam-review`, plan-settings panel on `/admin/plans`, "Launch Rajasthan" toggle on masters.
- Candidate: unchanged UI (backend gating only for WhatsApp alerts).

## Out of scope (called out to user)
- Actual Chrome extension build.
- Zoho vs custom invoice decision (Vikas pending).
- Final relevance-scoring algorithm (Vikas team).

## Verification
- Typecheck; migration lint.
- Playwright smoke: consultant post → hiring-for field visible; expiry-plus-7 gating; free-plan Rajasthan alert allowed vs Delhi blocked; 300/day download cap; GST verify flow submits; custom-plan builder shows only for ₹10k+ purchases.

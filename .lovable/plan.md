## What's already done
- Schema: `is_consultant`, `hiring_for_company`, `responses_locked_after`, `allow_brand_display`, `spam_suspected`, `plan_settings`, `company_verifications`, `download_ledger/events`, `whatsapp_send_ledger`, Rajasthan `is_launched`, 5-credits unlock.
- Employer verification page (GST / email / manual upload).
- Employer responses: 7-day lock banner + Excel download (300/day server cap).
- WhatsApp extension T&C page.
- Consultant checkbox in employer onboarding + "hiring for company" field in job wizard.

## Still pending from the doc

### 1. Database tab gating & lock
- `employer/database.tsx`: only reachable when the company has ≥1 live (active + non-expired) job — otherwise empty state with "Post a job to search the database".
- Same red 7-day-after-expiry banner as responses; hide rows whose source job is past `responses_locked_after`.
- Add "Download Excel" button (uses `unlocked_profiles` kind already wired in `downloads.functions.ts`).

### 2. Admin surfaces (all missing)
- `admin/verifications.tsx` — queue of `company_verifications` rows with approve/reject; on approve set `companies.verification_status = 'verified'`.
- `admin/downloads.tsx` — live feed of `download_events` with realtime subscribe + toast; filter by company/day.
- `admin/spam-review.tsx` — list companies with `spam_suspected = true`, un-flag / confirm-suspend actions.
- `admin/plans.tsx` — edit `plan_settings` singleton (free-post on/off, response cap, WA cap, Rajasthan-only toggle, spam threshold, credits/unlock).
- `admin/masters.tsx` — add a "Launch all Rajasthan cities" button (bulk `is_launched=true` where state = Rajasthan) plus per-city toggle.

### 3. Notifications with image
- Extend `NotificationBell.tsx` to render `notifications.image_url` thumbnail.
- `lib/whatsapp.functions.ts` (new): send helper that accepts `mediaUrl`, enforces per-user 50/day via `whatsapp_send_ledger` (429 on exceed), and skips PAN-India numbers when `plan_settings.free_whatsapp_rajasthan_only` and account is on free plan.

### 4. Public JD social + consultant disclaimer
- `jobs.$jobId.tsx`: add `og:title` / `og:description` / `og:image` (company logo or generated card) in `head()`, Twitter card tags, and a Share menu (WhatsApp / LinkedIn / copy link) with pre-filled text.
- If job's company `is_consultant = true` and `allow_brand_display = false`, mask brand ("Confidential client — via {consultant}"); if `allow_brand_display = true`, show a small "Posted by consultant" chip.
- Company profile: consent checkbox for `allow_brand_display` with "at your own risk" copy.

### 5. Custom plan builder (≥ ₹10,000)
- New `plans` table (name, price, limits jsonb, is_custom).
- `employer/plans/custom.tsx` — sliders for job slots, DB unlocks, WA alerts, downloads/day, validity; visible only when the buyer's cart/subscription total ≥ ₹10,000. Admin can also seed named packs.
- Server fn `customPlan.functions.ts` creates a `plans` row + Razorpay order.

### 6. Anti-spam + inactivity gating
- Server fn `spamDetect.functions.ts` (invoked hourly via `pg_cron` → `api/public/cron/spam-detect`): if `> plan_settings.spam_jobs_per_hour` posts in the last hour by a company, set `spam_suspected = true` and stop WA dispatch for its jobs.
- Inactivity check: if employer hasn't opened responses within 7 days of posting, dispatcher stops candidate WA alerts for that job and inserts a "Check your responses first" notification for the employer.

### 7. Serviceability + PAN-India free posting
- `jobs.new.tsx` city step: if selected city has `is_launched = false`, show serviceability warning + "Receive applications from anywhere in India" checkbox (persists to `jobs.pan_india_ok`).
- `credits.functions.ts`: skip credit deduction when every posting city is un-launched (per doc: "no deduction on unlaunched cities on any paid plan").

### 8. Invoices stub
- `employer/invoices.tsx` — list existing `razorpay_orders` with amount / status / download-PDF link. TODO banner: "Zoho vs in-app decision pending."

### 9. Relevance scoring placeholder
- New `match_scoring_config` (id=1, weights jsonb). Admin panel stub only — no algorithm yet (owner: Vikas team).

### 10. Small alignment items
- Add `pan_india_ok bool` on `jobs` (for #7).
- Add `plans` + `match_scoring_config` tables (with GRANT + RLS).
- Extend `plan_settings` if missing: `free_post_enabled`, `free_response_cap`, `free_whatsapp_per_post`, `free_plan_validity_days`.

## Migration (single)
```
ALTER TABLE jobs ADD COLUMN pan_india_ok boolean NOT NULL DEFAULT false;
CREATE TABLE plans (id uuid pk, name text, price_inr int, limits jsonb, is_custom bool, created_at, updated_at);
CREATE TABLE match_scoring_config (id int pk default 1, weights jsonb, updated_at);
ALTER TABLE plan_settings ADD COLUMN IF NOT EXISTS free_post_enabled bool DEFAULT true,
  ADD COLUMN IF NOT EXISTS free_response_cap int DEFAULT 50,
  ADD COLUMN IF NOT EXISTS free_whatsapp_per_post int DEFAULT 500,
  ADD COLUMN IF NOT EXISTS free_plan_validity_days int DEFAULT 30;
-- GRANTs + RLS for each new table per project rules.
```

## Out of scope (per doc)
- Actual Chrome extension build.
- Zoho vs custom invoice engine choice (Vikas pending).
- Real relevance-scoring algorithm.

## Verification
- Typecheck.
- Playwright smoke: consultant post → hiring-for visible, disclaimer on JD; expired-job responses/database locked; 300/day cap; free-plan WA blocked for non-Rajasthan; custom-plan builder appears at ≥ ₹10k; Rajasthan-launch toggle enables all state cities.

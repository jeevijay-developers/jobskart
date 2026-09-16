# P0-09 — Employer Verification (GST / CIN / Aadhaar)

Wire real verification into the existing `company_verifications` table and `kyc_status` / `kyc_method` enums. Independent of other P0 prompts.

## Types

| Type | Verifies | Applies to |
|---|---|---|
| GST | Business legality, GST status, legal name, registered address | Company |
| CIN | Registered company via MCA records | Company (Pvt Ltd, LLP, Public Ltd) |
| Aadhaar | Recruiter personal identity, OTP or DigiLocker | Individual recruiter |

## Migration
```sql
ALTER TABLE public.company_verifications
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_ref text,
  ADD COLUMN IF NOT EXISTS raw_response jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
```
`raw_response` retains the provider payload for dispute resolution. RLS: readable only by that company's `super_admin` and platform admin. Recruiters and HR Admins must not read it — it contains personal identity data.

## Flow
1. Super Admin only (per the role matrix) opens `/employer/verification`
2. Enters GSTIN / CIN, or starts Aadhaar OTP
3. Server function calls the provider through a single adapter, `src/lib/verification/provider.ts` — same pattern as the AI adapter, so providers can be swapped without touching call sites
4. On success: store `provider_ref`, `raw_response`, `verified_at`; set `kyc_status='verified'`; **auto-fill** legal name, registered address, and incorporation date onto `companies` for the Super Admin to confirm
5. On failure: increment `attempts`, show the provider's reason, offer manual document upload
6. Manual fallback queues to `/admin/verifications` for human review

## Rules
- **Rate limit: 5 attempts per company per day.** Verification APIs are billed per call and are a straightforward abuse vector
- **Never block posting on verification.** An unverified company can post; its jobs carry no "Verified" badge and are queued for admin moderation. Blocking posting at signup kills activation
- Verified companies get a badge on public job cards — this is the actual incentive to verify
- Aadhaar: store **only** the verification result and a masked reference. Never store the full Aadhaar number, ever, in any column or log
- Any verification failure must degrade to the manual queue, never to a dead end

## UI
- Verification card on the employer dashboard with a clear status: Not started / Pending / Verified / Rejected
- Show what verification unlocks: verified badge, higher candidate trust, higher application rates
- Admin queue at `/admin/verifications`: filter by status, view submitted documents, approve or reject with a reason (the reason is shown to the employer)

## Acceptance
- [ ] A valid GSTIN verifies and auto-fills company details
- [ ] An invalid GSTIN shows the provider's reason and offers manual upload
- [ ] The 6th attempt in a day is rate-limited
- [ ] An unverified company can still post jobs
- [ ] Verified companies show a badge on public job cards
- [ ] No full Aadhaar number exists anywhere in the database or logs
- [ ] `raw_response` is unreadable by recruiters and HR Admins

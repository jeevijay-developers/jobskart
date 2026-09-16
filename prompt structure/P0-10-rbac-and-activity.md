# P0-10 — RBAC Enforcement & Activity Tracker

The org model exists (`employer_members`, `employer_role`, `has_company_role()`). This prompt closes the enforcement gaps and completes the audit trail. Requires P0-05 and P0-07.

## Action matrix

| Action | Super Admin | HR Admin | Recruiter |
|---|---|---|---|
| Create recruiters | Yes | Yes | No |
| Create HR Admin | Yes | No | No |
| Manage billing / plans | Yes | Configurable | No |
| Company verification | Yes | No | No |
| Change ownership / delete company | Yes | No | No |
| Company settings | Yes | No | No |
| Post / edit / close jobs | Yes | Yes | Yes |
| Search candidate DB | Yes | Yes | Yes |
| Unlock candidates | Yes | Yes | Yes |
| Apply boosts | Yes | Yes | Own jobs only, capped |
| Shortlist / manage applications | Yes | Yes | Yes |
| View analytics | Yes | Yes | Own jobs only |

Three underspecified entries, resolved:
- **HR Admin billing** → new column `companies.hr_admin_can_spend boolean NOT NULL DEFAULT false`. HR Admin can always *view* balances; spending is off unless the Super Admin enables it
- **Recruiter boosts** → only where `jobs.posted_by = auth.uid()`, capped by `plans.limits.recruiter_boost_cap_per_month` (default 2)
- **Recruiter analytics** → own jobs only; company-wide analytics require HR Admin or above

## Enforcement pattern
Every privileged RPC begins with a role check. React may hide buttons for UX, but the database must refuse the action regardless of what the client sends.

```sql
IF NOT public.has_company_role(auth.uid(), _company_id,
     ARRAY['super_admin','hr_admin']::employer_role[]) THEN
  RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
END IF;
```

Use stable error codes so the UI can map them to specific messages: `insufficient_permissions`, `insufficient_credits`, `job_not_active`, `allowance_exhausted`, `boost_same_day`, `live_job_limit_reached`, `last_super_admin`.

## Membership edge cases

| Scenario | Required behaviour |
|---|---|
| Recruiter removed from org | **Soft revoke.** `employer_members.status='removed'`, set `removed_at`. Never hard-delete — `jobs.posted_by`, `candidate_unlocks.unlocked_by`, and `employer_activity` must keep resolving |
| Recruiter's personal account | Survives removal. Login, profile, and memberships in other companies are untouched |
| Unlocked candidates after removal | Company retains all of them. Unlocks are company-owned |
| Jobs by a removed recruiter | Stay live and company-owned. Offer reassignment on the jobs list; keep `posted_by` for audit |
| Role change | Effective on the next request. Never cache a role in a JWT claim |
| Last Super Admin leaving | **Blocked** with `last_super_admin`. Ownership must be transferred first |
| Removed recruiter re-invited | Reactivate the existing membership row; do not create a duplicate |
| Multiple HR Admins / Recruiters | Allowed |

Add if absent:
```sql
ALTER TABLE public.employer_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','removed','invited')),
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hr_admin_can_spend boolean NOT NULL DEFAULT false;
```
Every membership check must now also require `status='active'`. Audit `has_company_membership()` and `has_company_role()` for this — a removed recruiter retaining access is the worst failure mode in this prompt.

## Activity tracker
Every action below writes to `employer_activity` **in the same transaction** as the action, by trigger where possible:

Job created / edited / closed / reopened · Candidate unlocked (actor, job, candidate, source, cost) · Boost applied (actor, job, credits, window) · Candidate contacted (actor, candidate, channel) · DB search (→ `db_search_events`) · Member invited / joined / removed / role changed · Credits purchased / spent · Verification submitted / approved / rejected

Retention: 24 months minimum. This is the evidence base for every credit dispute.

## UI — `/employer/activity`
- Super Admin and HR Admin see the full company feed; recruiters see only their own entries
- Filters: member, action type, date range
- Each row: who, what, when, related job or candidate, credits affected
- CSV export for Super Admin

## Acceptance
- [ ] A recruiter calling an HR-Admin-only RPC directly is rejected by the database
- [ ] A removed recruiter cannot read any company data, but can still log in
- [ ] A removed recruiter's jobs stay live and their unlocks remain with the company
- [ ] The last Super Admin cannot leave or downgrade themselves
- [ ] A re-invited recruiter reactivates rather than duplicating
- [ ] HR Admin cannot spend credits unless `hr_admin_can_spend` is true
- [ ] A recruiter cannot boost another recruiter's job
- [ ] Every listed action appears in the activity feed with the correct actor

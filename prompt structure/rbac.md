# JobsKart — Roles & Access Control

Two independent role systems. Do not conflate them.

1. **Platform roles** — `platform_roles` table, `app_platform_role` enum (`super_admin`). JobsKart staff.
2. **Company roles** — `employer_members` table, `employer_role` enum (`super_admin`, `hr_admin`, `recruiter`). Per-company membership.

A user can hold a company role in several companies at once. Role is a property of the **membership**, never of the user.

---

## 1. Company role capabilities

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
| Apply boosts | Yes | Yes | Limited |
| Shortlist / manage applications | Yes | Yes | Yes |
| View analytics | Yes | Yes | Limited |

Two entries in the deck are underspecified and need a decision:

**"HR Admin — Manage Billing: Limited/Optional."** Recommendation: a per-company boolean `companies.hr_admin_can_spend` (default `false`). HR Admin may always *view* balances; spending is off unless Super Admin enables it. Ambiguity here is a refund dispute waiting to happen.

**"Recruiter — Apply Boosts: Limited."** Recommendation: recruiters may boost only jobs where `jobs.posted_by = auth.uid()`, capped at `recruiter_boost_cap_per_month` (default 2). Encoded in `plans.limits`.

**"Recruiter — Analytics: Limited."** Recommendation: recruiter sees metrics for their own jobs only. Company-wide analytics require HR Admin or above.

---

## 2. Enforcement

Every permission check happens in Postgres, never in React. React hides buttons for UX; the database refuses the action.

```sql
-- pattern for every privileged RPC
CREATE OR REPLACE FUNCTION public.some_privileged_action(_company_id uuid, ...)
RETURNS ... LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, ARRAY['super_admin','hr_admin']::employer_role[]) THEN
    RAISE EXCEPTION 'insufficient_permissions' USING ERRCODE = '42501';
  END IF;
  ...
END $$;
```

Existing helpers to reuse: `has_company_membership()`, `has_company_role()`, `has_platform_role()`, `user_companies()`.

Error codes should be stable strings (`insufficient_permissions`, `no_credits`, `job_not_active`, `allowance_exhausted`, `boost_same_day`) so the UI can map them to specific messages instead of showing a raw Postgres error.

---

## 3. Multi-user edge cases

| Scenario | Behaviour |
|---|---|
| Recruiter creates a personal account | Account exists independently of any company. Identity and login belong to the person |
| Recruiter added to an organization | Membership row created with a role. Permissions come from the org |
| Recruiter removed from an organization | **Soft revoke only.** Set `employer_members.status='removed'` + `removed_at`. Never hard-delete: FKs on `jobs.posted_by`, `candidate_unlocks.unlocked_by`, `employer_activity` must keep resolving for audit |
| Candidate access after removal | Company retains every unlocked candidate. Unlocks are company-owned (`candidate_unlocks.company_id`), never recruiter-owned |
| Jobs posted by a removed recruiter | Remain live and company-owned. Reassign ownership on the jobs list; `posted_by` is preserved for audit |
| Role change | Takes effect on next request — permission is read live, never cached in a JWT claim |
| Multiple HR Admins | Allowed |
| Multiple Recruiters | Allowed |
| Last Super Admin tries to leave | **Blocked.** A company must always have ≥1 active Super Admin. Transfer ownership first |
| Removed recruiter re-invited | Reactivate the existing membership row; do not create a duplicate |
| Recruiter joins a competitor company | Allowed. Memberships are independent; nothing crosses between companies |

---

## 4. Activity tracking

Every entry below writes to `employer_activity` in the same transaction as the action.

| Activity | Captured |
|---|---|
| Job created / edited / closed / reopened | actor, job, tier, timestamp |
| Candidate unlocked | actor, job, candidate, source (allowance/wallet), cost |
| Boost applied | actor, job, credits, window |
| Candidate contacted | actor, candidate, channel (call/WhatsApp/email) |
| DB search run | actor, job, filters, broadening stage, result count → `db_search_events` |
| Member invited / joined / removed / role changed | actor, target, old role, new role |
| Credits purchased / spent | actor, amount, balance after |
| Verification submitted / approved / rejected | actor, method, provider ref |

Super Admin and HR Admin see the full company feed at `/employer/activity`. Recruiters see only their own entries.

**Retention:** keep activity for 24 months minimum. This is the evidence base for every credit dispute.

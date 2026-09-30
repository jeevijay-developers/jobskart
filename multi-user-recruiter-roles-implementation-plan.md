# Multi-User Recruiter System & Role-Based Access Control
## Detailed Implementation Plan — JobsKart

> **Document Purpose**: This plan audits the current codebase against the product specification
> for Section 5 (Roles of Users in Employer Account) and Section 5.3 (Multi-User Recruiter System
> Edge Cases & Data Ownership). For each feature, it clearly marks what is **already implemented**,
> what **needs to be built**, and what **needs improvement**.

---

## 1. Role System Overview (from Product Spec)

The product specifies **three company roles**:

| Role | Purpose | Allowed Access | Restricted Access |
|---|---|---|---|
| **Super Admin** | Primary company owner/controller | Full — company settings, plans, billing, recruiters, jobs, DB access, boosts, trending jobs, analytics & verification | No restrictions |
| **HR Admin** | HR management & team operations | Create/edit/close jobs, manage recruiters, access candidate DB, unlock candidates, manage boosts, shortlist candidates, view analytics | Cannot change ownership, delete company, or control billing/plans completely |
| **Recruiter** | Daily hiring & candidate sourcing | Post jobs, search DB, unlock candidates, manage applications, shortlist candidates, contact unlocked profiles | Cannot manage recruiters, plans, billing, verification, or company-level settings |

---

## 2. Database Layer Audit

### ✅ IMPLEMENTED — DB Schema & RPC Functions

| Feature | Location | Status |
|---|---|---|
| `employer_members` table with `role`, `status`, `revoked_at`, `revoked_by` | `20260617103716_*.sql` + `20260928130000_*.sql` | ✅ Complete |
| `employer_invites` table with `company_id`, `email`, `role`, `token`, `expires_at`, `accepted_at` | `20260617103716_*.sql` | ✅ Complete |
| `employer_role` enum: `super_admin`, `hr_admin`, `recruiter` | `20260617103716_*.sql` | ✅ Complete |
| `has_company_membership(_user_id, _company_id)` — checks `status='active'` | `20260928130000_*.sql` | ✅ Complete |
| `has_company_role(_user_id, _company_id, _role)` — checks `status='active'` | `20260928130000_*.sql` | ✅ Complete |
| `user_companies(_user_id)` — returns only active companies | `20260928130000_*.sql` | ✅ Complete |
| `remove_member()` — soft-revoke, prevents last super_admin removal | `20260928130000_*.sql` | ✅ Complete |
| `reactivate_member()` — Super Admin only | `20260928130000_*.sql` | ✅ Complete |
| `accept_invite()` — reactivates previously revoked members | `20260928130000_*.sql` | ✅ Complete |
| `tg_members_revoked` trigger — audit log on soft-delete | `20260928130000_*.sql` | ✅ Complete |
| `get_invite_by_token()` RPC | Migrations | ✅ Complete |
| Audit trail via `employer_activity` table | Architecture | ✅ Complete |
| Candidate data ownership preserved on revoke (company-scoped `candidate_unlocks`) | DB design | ✅ Complete |

### ❌ NOT IMPLEMENTED — DB Layer Gaps

| Missing Feature | Why Needed | Priority |
|---|---|---|
| `change_member_role(_company_id, _user_id, _new_role)` RPC | Role changes require DB-level enforcement; cannot be done via direct UPDATE from client | **HIGH** |
| Email notification trigger on invite creation | Spec says recruit "receives invitation"; no email is sent today — only a link is created | **HIGH** |
| `send_invite_email()` edge function or Postgres hook | Without email, invitees must receive the link out-of-band (unscalable) | **HIGH** |
| RLS policy: Recruiter cannot see billing/plan data | Currently credits/plans page shows all data regardless of role | **MEDIUM** |
| Expiry enforcement cron on `employer_invites` | Invites older than 7 days should auto-expire; no sweep cron exists | **LOW** |

---

## 3. Frontend Layer Audit — Employer Portal

### 3.1 Team Management Page (`/employer/team`)

#### ✅ IMPLEMENTED

| Feature | Code Location | Status |
|---|---|---|
| View active team members with name, role badge | `team.tsx` L268–300 | ✅ |
| View revoked members (toggle via "Show Revoked") | `team.tsx` L304–347 | ✅ |
| Invite form (email + role select) → creates `employer_invites` row | `team.tsx` L188–214 | ✅ |
| `canInvite` gate: HR Admin + Super Admin only | `team.tsx` L216 | ✅ |
| `canManage` gate: HR Admin + Super Admin only | `team.tsx` L217 | ✅ |
| Revoke access button (soft-delete via direct UPDATE) | `team.tsx` L171–186 | ✅ (but bypasses RPC) |
| Restore access button for revoked members | `team.tsx` L154–169 | ✅ (but bypasses RPC) |
| Data Ownership notice banner | `team.tsx` L367–378 | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Role change UI** — No way to change a member's role (Recruiter → HR Admin) | Super Admin/HR Admin cannot promote or demote members; must re-invite | **HIGH** |
| **Revoke/Restore calls wrong path** — Uses direct Supabase `.update()` instead of `remove_member()` / `reactivate_member()` RPCs | Bypasses "last super_admin" guard and audit log; security risk | **HIGH** |
| **Invite link display** — After creating invite, no way to copy/view the actual invite URL | Users must manually construct the URL; UX is broken | **HIGH** |
| **Email delivery for invites** — `sendInvite()` only writes a DB row, no email is sent | Invitees never receive a notification | **HIGH** |
| **Invite resend/cancel** — Pending invites show in list but no "Resend" or "Cancel" button | Cannot manage stale invitations | **MEDIUM** |
| **Role badge rendering bug** — `roleBadgeClass()` returns a CSS class string but it's rendered as text content, not applied as `className` | Role badges display raw CSS class strings instead of styled badges | **MEDIUM** (visual bug) |
| **Navigation bug** — Sidebar "Team" button has `// TODO: navigate to dashboard` | Dead navigation button | **LOW** |

---

### 3.2 Billing & Credits Page (`/employer/credits`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Plan subscription (Basic/Paid tiers) via Razorpay | ✅ |
| Credit pack purchase (Job Post, Contact, Boost credits) via Razorpay | ✅ |
| Wallet balance display (3 separate balances) | ✅ |
| Invoice download (PDF generation) | ✅ |
| Transaction history with filter | ✅ |
| Grant & consumption ledger | ✅ |
| Downgrade to Basic plan with confirmation dialog | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Recruiter role cannot access billing** — Spec: Recruiter "Cannot manage plans, billing." Currently all authenticated employer users can access `/employer/credits` | Security/spec violation | **HIGH** |
| **HR Admin limited billing access** — Spec: HR Admin "Cannot control billing/plans completely." Currently HR Admins have full billing control | Spec violation | **MEDIUM** |
| **No role check at route level** — `myRole` is never loaded on credits page | Architecture gap | **HIGH** |
| **Plan renewal notifications** — No proactive email/WhatsApp notification before plan expiry | UX gap | **MEDIUM** |

---

### 3.3 Jobs Management (`/employer/jobs`, `/employer/jobs/new`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Recruiter can post jobs (via JobWizard) | ✅ |
| Edit/pause/close jobs | ✅ |
| Boost job (costs boost credits) | ✅ |
| Job quality score & meter | ✅ |
| Job expiry & auto-renew | ✅ |
| Salary suggestions | ✅ |
| Job tier selection (Classic/Classic+/Trending) | ✅ |
| Bulk job posting | ✅ |
| Applicant management with status changes | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Job ownership attribution** — Jobs don't show which recruiter posted them | Multi-recruiter scenario: HR Admin cannot see who posted what | **MEDIUM** |
| **Recruiter-scoped job view option** — No filter-by-poster in job list | UX improvement for large teams | **LOW** |

---

### 3.4 Candidate Database (`/employer/database`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Search candidates with filters | ✅ |
| Unlock candidate contact (hybrid allowance + wallet model) | ✅ |
| Masked data before unlock; full contact after unlock | ✅ |
| AI-powered search broadening (staged fallback) | ✅ |
| Candidate data preserved when recruiter is revoked | ✅ (DB layer) |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Session invalidation gap** — Revoked recruiter with a stale JWT can still access DB search until token expires | Security gap after revoke | **MEDIUM** |
| **"N new candidates since your last visit" counter** — Architecture doc mentions this; not visible in UI | UX gap | **LOW** |

---

### 3.5 Company Profile (`/employer/company`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Edit company name, industry, website, about, city | ✅ |
| Logo upload | ✅ |
| GST/PAN tax ID fields (members-only via `get_company_private` RPC) | ✅ |
| Company documents section | ✅ |
| Verification status badge | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Recruiter blocked from company settings** — Spec: Recruiter "Cannot manage company-level settings." Currently any employer member can edit | **Security/spec violation** | **HIGH** |
| **Ownership transfer** — Super Admin should be able to transfer ownership; no UI exists | Missing feature for Super Admin | **MEDIUM** |
| **Delete company** — No company deletion flow exists (for Super Admin) | Spec incomplete | **LOW** |

---

### 3.6 Verification (`/employer/verification`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| GST/PAN/CIN submission | ✅ |
| Email verification method | ✅ |
| Manual document upload | ✅ |
| Submission history list | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Recruiter blocked from verification** — Spec: Recruiter "Cannot manage verification." No role check | Spec violation | **HIGH** |

---

### 3.7 Reports & Analytics (`/employer/reports`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Hiring funnel chart (Applied, Shortlisted, Interview, Hired) | ✅ |
| Application trend area chart (7/30/90 day range) | ✅ |
| Top jobs by applications | ✅ |
| Key metrics | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **No role gate** — Recruiter can access analytics (per spec, analytics is HR Admin+) | Spec violation | **MEDIUM** |
| **Per-recruiter breakdown** — HR Admin/Super Admin cannot see analytics split by recruiter | Missing multi-user insight | **MEDIUM** |
| **Credit spending analytics** — No chart showing credit consumption over time | UX gap | **LOW** |

---

### 3.8 CRM & Automation (`/employer/crm`, `/employer/crm/automation`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Lead list with stage, source, last call info | ✅ |
| Task management (open/done/snoozed/cancelled) | ✅ |
| Call log drawer with outcome logging | ✅ |
| Next Best Actions (AI-suggested priorities) | ✅ |
| CRM automation rules (trigger → action) | ✅ |
| Automation rule enable/disable toggle | ✅ |
| Run history per rule | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Task assignment to specific recruiter** — `assignee_id` column exists but no UI to pick/filter | Multi-recruiter CRM unusable for delegation | **HIGH** |
| **Automation restricted to HR Admin+** — No role check on `/employer/crm/automation` | Spec violation | **MEDIUM** |

---

### 3.9 Activity Log (`/employer/activity`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Activity feed with kind filter (Applications, Jobs, Credits, Database, Team) | ✅ |
| Time range filter (Today, 24h, 3d, 7d, 30d, All time) | ✅ |
| Load more (batch 50) | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Filter by actor/recruiter** — No "who did it" filter for HR Admin+ | In multi-recruiter orgs, HR Admin cannot isolate one recruiter's activity | **HIGH** |
| **Actor name shown in activity items** — Activity rows don't clearly show who performed the action | Audit trail is incomplete from UX standpoint | **MEDIUM** |
| **Recruiter-scoped view** — Recruiters should see only their own activity | Role-scoped filtering missing | **MEDIUM** |

---

### 3.10 Invite Flow (`/invite/$token`)

#### ✅ IMPLEMENTED

| Feature | Status |
|---|---|
| Token lookup via `get_invite_by_token` RPC | ✅ |
| Expired invite detection | ✅ |
| Already-used invite detection | ✅ |
| Accept invite via `accept_invite` RPC (reactivates revoked members) | ✅ |
| Redirect to employer dashboard on success | ✅ |
| Sign-in prompt if unauthenticated | ✅ |

#### ❌ NOT IMPLEMENTED / NEEDS IMPROVEMENT

| Missing Feature | Impact | Priority |
|---|---|---|
| **Email mismatch check** — No warning if logged-in user email ≠ invite email | A user could accidentally accept someone else's invite | **HIGH** |
| **Invite link not copyable from Team page** — Team page creates invite row but shows no copy-link UI | Inviter cannot share the invite | **HIGH** |
| **Email/WhatsApp delivery** — No automated delivery of the invite link | Manual process required | **HIGH** |
| **New recruiter onboarding** — After accepting, no onboarding for the new recruiter | New recruiter UX is jarring | **MEDIUM** |

---

## 4. Multi-User Edge Cases Audit (Section 5.3)

| Edge Case | Expected Behavior | DB Implemented | UI Implemented | Gap |
|---|---|---|---|---|
| Recruiter creates personal account | Account exists independently from company | ✅ | ✅ | None |
| Recruiter added to organization | Receives membership with assigned role | ✅ | ✅ | Email delivery missing |
| Recruiter removed from organization | Only org access removed, personal account retained, soft delete | ✅ | ✅ | UI calls direct UPDATE instead of RPC |
| Recruiter activity tracking | All sensitive actions logged for auditing | ✅ | ⚠️ | Actor-scoped view missing |
| Recruiter added via invitation | Recruiter accepts invite & joins org | ✅ | ✅ | Email delivery + link copy missing |
| Candidate access after recruiter removal | Company retains unlocked candidate visibility | ✅ | ✅ | None |
| **Role change within organization** | Permissions dynamically updated | ✅ (DB check real-time) | ❌ **NO UI** | **Role change UI completely missing** |
| Multiple HR Admins | Allowed under same organization | ✅ | ✅ | None |
| Multiple Recruiters | Allowed under same organization | ✅ | ✅ | None |

---

## 5. Role-Gating Status — Page-Level Access Control

### Pages with NO Role Check (Should Be Restricted):

| Route | Who Should Have Access | Current State |
|---|---|---|
| `/employer/credits` | Super Admin (full); HR Admin (limited) | ❌ All roles |
| `/employer/company` | Super Admin + HR Admin | ❌ All roles |
| `/employer/verification` | Super Admin + HR Admin | ❌ All roles |
| `/employer/reports` | Super Admin + HR Admin | ❌ All roles |
| `/employer/crm/automation` | Super Admin + HR Admin | ❌ All roles |
| Company profile edit form | Super Admin + HR Admin | ❌ All roles can edit |

### Pages with Partial Role Check:

| Route | What Is Gated | What Is Missing |
|---|---|---|
| `/employer/team` | Invite + Manage buttons gated by `canInvite`/`canManage` | Role change, RPC safety |

### Architecture Gap:
Role is fetched **per-page** with no shared context. Every employer route independently calls `fetchMyCompanies`. There is **no global role context** (no shared hook, no route-level loader).

---

## 6. Implementation Plan — Prioritized Tasks

### Priority 1 — Critical (Security / Spec Violations)

#### Task 1.1: Create `useEmployerRole()` Hook
**Purpose**: A single hook that fetches and caches `{ companyId, role }` for the current user once, then provides it to all employer pages.

**Files to create**:
- `src/hooks/use-employer-role.ts` — NEW

---

#### Task 1.2: Gate `/employer/credits` by Role
**Logic**:
- Super Admin → full access (current behavior)
- HR Admin → can view balance + invoices + buy packs; **cannot** change plans
- Recruiter → redirect to dashboard with toast "Billing is managed by your admin"

**Files to modify**:
- `src/routes/_authenticated/employer/credits.tsx`

---

#### Task 1.3: Gate `/employer/company` by Role
**Logic**:
- Recruiter → redirect or show read-only view
- HR Admin + Super Admin → edit access

**Files to modify**:
- `src/routes/_authenticated/employer/company.tsx`

---

#### Task 1.4: Gate `/employer/verification` by Role
**Logic**:
- Recruiter → blocked
- HR Admin + Super Admin → full access

**Files to modify**:
- `src/routes/_authenticated/employer/verification.tsx`

---

#### Task 1.5: Fix Revoke/Restore to Use RPCs
**Problem**: `team.tsx` uses direct `.from("employer_members").update(...)` bypassing the `remove_member()` / `reactivate_member()` RPCs which contain the "last super_admin" guard and audit log.

**Fix**: Create server functions that call the RPCs.

**Files to create/modify**:
- `src/lib/team.functions.ts` — NEW: `revokeMember()`, `reactivateMember()` server functions
- `src/routes/_authenticated/employer/team.tsx` — call server fns instead of direct update

---

### Priority 2 — High (Core Multi-User Features)

#### Task 2.1: Role Change UI + RPC
**What**: Add a "Change Role" dropdown on each active team member row. Restricted to Super Admin only.

**DB migration required**:
```sql
CREATE OR REPLACE FUNCTION public.change_member_role(
  _company_id uuid,
  _user_id uuid,
  _new_role public.employer_role
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  -- Prevent demoting the last super_admin
  IF _new_role != 'super_admin' THEN
    PERFORM 1 FROM public.employer_members
    WHERE company_id = _company_id AND role = 'super_admin'
      AND status = 'active' AND user_id != _user_id
    HAVING count(*) >= 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot demote the last super admin';
    END IF;
  END IF;
  UPDATE public.employer_members
    SET role = _new_role
    WHERE company_id = _company_id AND user_id = _user_id AND status = 'active';
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_changed', 'Member role changed',
    'Role updated to ' || _new_role::text, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'new_role', _new_role)
  );
END;
$$;
```

**Files to create/modify**:
- `supabase/migrations/[timestamp]_change_member_role.sql` — NEW
- `src/lib/team.functions.ts` — add `changeMemberRole()` server function
- `src/routes/_authenticated/employer/team.tsx` — role change dropdown UI

---

#### Task 2.2: Invite Link Copy + Display
**What**: After invite is created, show the full invite URL with a "Copy link" button. Also show it on each pending invite row.

**Files to modify**:
- `src/routes/_authenticated/employer/team.tsx`
  - Modify `sendInvite()` to capture returned token
  - Show `Copy link` button after creation
  - Add copy button to each invite row in the pending invites section

---

#### Task 2.3: Email Invite Delivery
**What**: When invite row is created, send an email to `invite.email` with the invite link.

**Approach A (Recommended)**: Supabase Database Webhook on `employer_invites` insert → Edge Function `send-team-invite`.

**Files to create**:
- `supabase/functions/send-team-invite/index.ts` — NEW

**Approach B**: TanStack server function called after DB insert.
- `src/lib/team.functions.ts` — add `sendInviteEmail()` that calls email service

---

#### Task 2.4: Email Mismatch Check on Invite Accept
**What**: On `/invite/$token` page, compare logged-in user's email with `invite.email`. If mismatch, show a warning.

**Files to modify**:
- `src/routes/invite.$token.tsx`

---

#### Task 2.5: Cancel/Resend Pending Invites
**What**: Add "Cancel" and "Resend" action buttons to pending invite rows.

**Files to modify**:
- `src/routes/_authenticated/employer/team.tsx`
- `src/lib/team.functions.ts` — add `cancelInvite()`, `resendInvite()`

---

### Priority 3 — Medium (UX & Multi-Recruiter Analytics)

#### Task 3.1: Fix Role Badge Visual Bug
**What**: `roleBadgeClass()` returns a CSS class string but is currently rendered as text content. Replace with proper styled `<span>` badge.

**Current broken code** (`team.tsx` L282–283):
```tsx
<p className="text-xs text-muted-foreground">
  {roleBadgeClass(m.role)}   {/* ← renders "bg-primary-light text-primary" as text */}
</p>
```
**Correct code**:
```tsx
<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(m.role)}`}>
  {m.role.replace('_', ' ')}
</span>
```

**Files to modify**:
- `src/routes/_authenticated/employer/team.tsx`

---

#### Task 3.2: Actor Attribution in Activity Log
**What**: Show recruiter name on each activity row. Add filter by team member for HR Admin+.

**Files to modify**:
- `src/routes/_authenticated/employer/activity.tsx` — add actor filter
- `src/components/employer/ActivityFeed.tsx` — show actor name on each item

---

#### Task 3.3: Recruiter-Scoped Activity View
**What**: When logged-in user is a Recruiter, filter the activity query to `WHERE actor_id = auth.uid()`.

**Files to modify**:
- `src/routes/_authenticated/employer/activity.tsx`

---

#### Task 3.4: Task Assignment in CRM
**What**: Add assignee picker to CRM tasks. Fetch active team members and allow HR Admin+ to assign tasks.

**Files to modify**:
- `src/routes/_authenticated/employer/crm.tsx`
- `src/components/employer/CallLogDrawer.tsx`

---

#### Task 3.5: Gate Reports/Analytics by Role
**What**: Recruiter blocked or shown limited "my applications" summary only.

**Files to modify**:
- `src/routes/_authenticated/employer/reports.tsx`

---

#### Task 3.6: Per-Recruiter Analytics Breakdown
**What**: New section on Reports page (HR Admin+ only) showing per-recruiter stats: jobs posted, candidates unlocked, applications processed.

**Files to modify**:
- `src/routes/_authenticated/employer/reports.tsx`
- `src/lib/employer-analytics.functions.ts`

---

#### Task 3.7: Gate CRM Automation by Role
**What**: Recruiter sees automation rules in read-only mode. Cannot create/edit/delete rules.

**Files to modify**:
- `src/routes/_authenticated/employer/crm.automation.tsx`

---

#### Task 3.8: Job Ownership Attribution
**What**: Show "Posted by [Recruiter Name]" on each job card. HR Admin+ filter by poster.

**Files to modify**:
- `src/routes/_authenticated/employer/jobs.tsx`

---

### Priority 4 — Low (Polish & Edge Cases)

#### Task 4.1: Fix Team Page Navigation Bug
**What**: Replace `// TODO: navigate to dashboard` with proper `Link`.

**Files to modify**:
- `src/routes/_authenticated/employer/team.tsx` L224–231

---

#### Task 4.2: New Recruiter Welcome Modal
**What**: First-time recruiter onboarding modal after accepting an invite. Show role explanation and quick actions.

**Files to create/modify**:
- `src/components/employer/NewMemberWelcomeModal.tsx` — NEW
- `src/routes/_authenticated/employer/dashboard.tsx` — trigger on first visit

---

#### Task 4.3: Invite Expiry Sweep Cron
**What**: Postgres cron job to clean up expired invites.

```sql
SELECT cron.schedule(
  'expire-invites',
  '0 3 * * *',
  $$
    UPDATE public.employer_invites
    SET cancelled_at = now()
    WHERE expires_at < now()
      AND accepted_at IS NULL
      AND cancelled_at IS NULL;
  $$
);
```

**Files to create**:
- `supabase/migrations/[timestamp]_invite_expiry_sweep.sql` — NEW

---

#### Task 4.4: Ownership Transfer
**What**: Super Admin can transfer company ownership to another Super Admin.

**Files to create/modify**:
- New migration for `transfer_ownership()` RPC
- `src/routes/_authenticated/employer/company.tsx` — "Transfer Ownership" button

---

## 7. Summary: What Is Present vs. What Needs to Be Built

### ✅ Fully Implemented
- Three-role system (`super_admin`, `hr_admin`, `recruiter`) in database
- Soft-delete (revoke) with "last super_admin" guard in DB
- Reactivate revoked member RPC
- Invite creation, token generation, accept-invite flow
- Audit trail (`employer_activity`) for all privileged actions
- Candidate data ownership preserved on recruiter removal
- Multiple HR Admins / Recruiters allowed (no DB constraint preventing)
- Basic team management UI (view members, revoke, restore, invite form)
- Invite accept page with expiry/used-state detection
- Full billing: plans + credit packs + invoices + ledger

### ⚠️ Partially Implemented (Needs Improvement)
- **Revoke/restore**: Works but uses direct UPDATE instead of RPCs (bypasses security guards)
- **Invite flow**: DB side complete, but no email delivery and no copy-link UI
- **Team page**: Role gating for invite/manage works, but missing role-change capability
- **Activity log**: Exists but no actor filter or recruiter-scoped view
- **Role badges**: Logic exists but visual rendering bug makes them show as plain text

### ❌ Not Implemented (Needs to Be Built)
1. **Role change UI** (Recruiter ↔ HR Admin ↔ Super Admin)
2. **Role-based page access control** for Credits, Company, Verification, Reports, CRM Automation
3. **Email/WhatsApp delivery for invites**
4. **Invite link copy button** on Team page
5. **Cancel/Resend pending invites**
6. **Email mismatch warning** on invite accept
7. **Actor attribution and recruiter filter** in Activity Log
8. **Recruiter-scoped activity view** (see only own actions)
9. **Task assignment** in CRM
10. **Per-recruiter analytics breakdown** in Reports
11. **New recruiter welcome modal**
12. **Ownership transfer** for Super Admin
13. **Invite expiry sweep cron**
14. **Global `useEmployerRole()` hook** to avoid per-page role fetching
15. **Session invalidation on revoke** (beyond DB soft-delete)

---

## 8. File Inventory for All Changes

```
src/
├── hooks/
│   └── use-employer-role.ts                   ← NEW: global role context hook
│
├── lib/
│   └── team.functions.ts                      ← NEW: revokeMember, reactivateMember,
│                                                       changeMemberRole, sendInviteEmail,
│                                                       cancelInvite, resendInvite
│
├── routes/
│   ├── invite.$token.tsx                      ← MODIFY: email mismatch check
│   └── _authenticated/employer/
│       ├── team.tsx                           ← MODIFY: role-change UI, RPC calls, invite link
│       │                                               copy, cancel/resend invites, badge fix,
│       │                                               nav bug fix
│       ├── credits.tsx                        ← MODIFY: role gate (Recruiter blocked)
│       ├── company.tsx                        ← MODIFY: role gate (Recruiter read-only)
│       ├── verification.tsx                   ← MODIFY: role gate (Recruiter blocked)
│       ├── reports.tsx                        ← MODIFY: role gate + per-recruiter analytics
│       ├── crm.automation.tsx                 ← MODIFY: role gate (Recruiter view-only)
│       ├── crm.tsx                            ← MODIFY: task assignee picker
│       ├── activity.tsx                       ← MODIFY: actor filter + recruiter-scoped view
│       ├── dashboard.tsx                      ← MODIFY: new member welcome modal trigger
│       └── jobs.tsx                           ← MODIFY: job ownership attribution
│
└── components/employer/
    ├── ActivityFeed.tsx                        ← MODIFY: actor attribution display
    ├── CallLogDrawer.tsx                       ← MODIFY: assignee picker
    └── NewMemberWelcomeModal.tsx              ← NEW: first-time recruiter onboarding

supabase/
├── migrations/
│   ├── [timestamp]_change_member_role.sql     ← NEW: change_member_role() RPC
│   ├── [timestamp]_invite_expiry_sweep.sql    ← NEW: cron for expired invites
│   └── [timestamp]_team_rbac_rls.sql          ← NEW: RLS policies for billing/company
│
└── functions/
    └── send-team-invite/index.ts              ← NEW: invite email delivery edge function
```

---

*Document created: 2026-09-30 | Scope: Multi-User Recruiter System & RBAC | Based on codebase audit against product spec Section 5 and Section 5.3*

# Multi-User Recruiter System & Recommended Profile System: Audit & Implementation Plan

**Target Feature Sets:**
1. **Section 5.3:** Multi-User Recruiter System Edge Cases & Data Ownership
2. **Section 6:** Job Responses & Recommended Profile System

---

## 1. Executive Summary & Codebase Audit Checklist

We conducted a line-by-line audit of the JobsKart codebase against the two feature specification images. Below is the verification status for every point, identifying what is implemented, what has logical flaws, and what is missing.

### 5.3 Multi-User Recruiter System Edge Cases & Data Ownership Checklist

| # | Scenario / Edge Case | Expected System Behaviour & Ownership Logic | Current Implementation Status | Codebase Findings & Logical Gaps |
|---|---|---|---|---|
| **1** | **Recruiter creates personal account** | Recruiter account exists independently from company. Recruiter owns personal identity & login. | 🟡 **Partially Implemented** | Auth uses Supabase `auth.users` + `profiles`, but the onboarding flow assumes a user must either be invited or immediately create their own company. User cannot cleanly manage an independent recruiter identity without being bound to a single company workflow. |
| **2** | **Recruiter added to organization** | Recruiter receives organization membership with assigned role. Organization controls permissions. | 🟢 **Implemented** | `employer_members` table stores `(user_id, company_id, role)`. `has_company_membership()` and `has_company_role()` enforce access. |
| **3** | **Recruiter removed from organization** | Only organization access removed; recruiter personal account remains active. **Avoid hard delete, use access revocation & soft delete.** Personal account retained; company data remains with company. | 🔴 **Logical Bug / Violation** | `remove_member()` in migration `20260630002107` executes a **hard delete**: `DELETE FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id;`. There is no `status` (`active` vs `revoked`) or `revoked_at` timestamp. Historical membership records and accountability are destroyed. |
| **4** | **Recruiter activity tracking** | All sensitive actions logged for auditing. System-level logging. | 🟡 **Partially Implemented (Gaps)** | `employer_activity` table exists, but: <br>1. Team invitations (`sendInvite`) and invite acceptances (`accept_invite`) are not logged.<br>2. `activity.tsx` does NOT query or display `actor_id` or the recruiter's name/email, making audit reviews anonymous.<br>3. Status changes in `jobs.$jobId.applicants.tsx` do not log to `employer_activity`. |
| **5** | **Recruiter added via invitation** | Recruiter accepts invite & joins organization. Membership-based onboarding. | 🟢 **Implemented** | `employer_invites` table, `/invite/:token` page, and `accept_invite(_token)` RPC handle invitation token verification and joining. |
| **6** | **Candidate access after recruiter removal** | Company retains unlocked candidate visibility. Company-owned access. | 🟢 **Implemented** | `candidate_unlocks` rows are keyed by `company_id`. Even if the unlocking recruiter leaves, the company retains access. However, soft-delete is needed to maintain `unlocked_by` foreign-key integrity. |
| **7** | **Role change within organization** | Permissions dynamically updated. Membership-role controlled. | 🟢 **Implemented** | `update_member_role(_company_id, _user_id, _role)` RPC dynamically sets roles (`super_admin`, `hr_admin`, `recruiter`) with last-admin demotion guards. |
| **8** | **Multiple HR Admins** | Allowed under same organization. Shared operational access. | 🟢 **Implemented** | Multiple HR Admin memberships are supported under one company. |
| **9** | **Multiple Recruiters** | Allowed under same organization. Controlled by role permissions. | 🟢 **Implemented** | Multiple Recruiters are supported under one company with role-gated access. |

---

### 6. Job Responses & Recommended Profile System Checklist

| # | Feature / Psychology Point | Expected System Behaviour | Current Implementation Status | Codebase Findings & Logical Gaps |
|---|---|---|---|---|
| **1** | **Candidate Sources: Applied vs. AI Recommended** | Dual-source pipeline: (1) Applied Candidates, (2) AI Recommended Profiles surfaced in the job response workflow. | 🔴 **NOT Implemented** | `jobs.$jobId.applicants.tsx` ONLY lists candidates who explicitly applied (`applications` table). There is no "AI Recommended Profiles" source or tab inside the job pipeline. |
| **2** | **Integrated responses + recommendation workflow** | Recruiter can manage applications and discover recommended talent within the same job view. | 🔴 **NOT Implemented** | Candidate search is completely siloed inside `/employer/database`. Recruiters have to jump between pages and manually configure search queries instead of having an integrated workflow. |
| **3** | **Dynamic relevancy-based candidate ranking** | Matching skills, experience, location, and salary against job requirements. | 🟡 **Partially Implemented** | `compute_candidate_match()` calculates a 0–100 score, but it is only used to sort already-applied candidates and on generic DB search. No automated feed exists to recommend matching database profiles for a specific job. |
| **4** | **Hot profiles with high hiring intent** | Dynamic tagging for candidates actively seeking jobs with high profile completion. | 🟡 **Partially Implemented** | SQL logic assigns `'Hot Profile'` tag (recent applications >= 3, profile strength >= 80), but there is no dedicated filter, badge highlight, or visual emphasis on candidate cards. |
| **5** | **Nearby & active candidates** | Dynamic location proximity and recent activity indicators. | 🟡 **Partially Implemented** | Proximity bonus (city/state) and activity bonus (active in last 24h/72h/7d) exist in SQL, but are not exposed as filterable chips or prominent UI badges in candidate lists. |
| **6** | **Dynamic-assisted recruiter candidate discovery** | System actively assists recruiter with match explanations and recommendations. | 🔴 **NOT Implemented** | No visual match breakdown (e.g. 5/5 skills match, location match), no "Invite to Apply" workflow for non-applicants, and no recommendations drawer. |
| **7** | **Smart recruiter engagement psychology** | System feels like active hiring intelligence; recruiters feel platform is continuously working. | 🔴 **NOT Implemented** | No discovery counters (e.g. "8 new matches found today"), no automated email/in-app match digest for employers, and no dynamic refresh indicators. |

---

## 2. Industry Benchmark & Architecture (Naukri, Indeed, LinkedIn Recruiter)

How industry leaders structure these features:
1. **Recruiter Identity & Soft Deletion (LinkedIn Recruiter / Workable)**:
   - A recruiter's personal account (`User`) is distinct from their `Seat` or `Membership`.
   - When a recruiter departs, the company admin **revokes the seat** (`status = 'revoked'`).
   - The recruiter loses access to company jobs, pipeline, and candidate unlocks immediately.
   - All past candidate unlocks, notes, tags, and interviews created by that recruiter remain linked to the company and credit usage is preserved.
2. **Integrated Dual-Source Pipeline (Indeed / LinkedIn Recruiter / Naukri Resdex)**:
   - When opening a job post, recruiters see two main tabs:
     - **Tab 1: Applicants (Inbound)**: Candidates who submitted applications.
     - **Tab 2: Matched / Recommended Profiles (Outbound)**: Algorithmic matches from the platform's candidate pool who meet the job's criteria (skills, location, experience) but haven't applied yet.
   - For Recommended Profiles, recruiters can:
     - **1-Click Unlock Contact Details** (uses credit allowance).
     - **Invite to Apply** (sends an automated email/SMS/push notification inviting the candidate to apply).
     - **Dismiss / Not a Fit** (refines the recommendation algorithm).
   - High-intent indicators (e.g., "Active today", "Actively applying", "Immediate joiner") create urgency and drive credit consumption.

---

## 3. Comprehensive Implementation Plan

### Phase 1: Multi-User Recruiter System Edge Cases & Audit Trail (Section 5.3)

#### 1.1 Database Schema Migration: Soft-Delete for Employer Members
- **File:** `supabase/migrations/<timestamp>_recruiter_soft_delete_and_auditing.sql`
- **Changes**:
  1. Add columns to `public.employer_members`:
     - `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'))`
     - `revoked_at timestamptz`
     - `revoked_by uuid REFERENCES auth.users(id)`
  2. Update helper functions:
     - `has_company_membership(_user_id, _company_id)`: must check `status = 'active'`.
     - `has_company_role(_user_id, _company_id, _role)`: must check `status = 'active'`.
     - `user_companies(_user_id)`: must filter `WHERE status = 'active'`.
  3. Replace `remove_member(_company_id, _user_id)` RPC:
     - Change from `DELETE FROM employer_members` to:
       ```sql
       UPDATE public.employer_members
       SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
       WHERE user_id = _user_id AND company_id = _company_id;
       ```
     - Log activity: `team.revoked` with metadata `{ "user_id": _user_id, "revoked_by": auth.uid() }`.
  4. Create `reactivate_member(_company_id, _user_id, _role)` RPC:
     - Allows super admins to reinstate a previously revoked recruiter.
  5. Update `accept_invite(_token)` RPC:
     - If the user was previously revoked, update `status = 'active'`, `revoked_at = NULL`, `revoked_by = NULL`, and log `team.joined`.

#### 1.2 System-Level Audit Trail Enhancement
- **File:** `supabase/migrations/<timestamp>_recruiter_soft_delete_and_auditing.sql`
- **Changes**:
  1. Add trigger or RPC logging for:
     - `team.invited`: Log when an invite is created in `employer_invites`.
     - `team.joined`: Log when an invite is accepted in `accept_invite`.
     - `application.status_changed`: Log when applicant status is updated (shortlisted, interview, rejected, hired).
  2. Update `employer_activity` read policy and view to join `profiles(full_name, email)` on `actor_id` so the UI can display: *"John Doe (Recruiter) updated application status"*.

#### 1.3 Team Management UI Updates
- **File:** `src/routes/_authenticated/employer/team.tsx`
- **Changes**:
  1. Update member list:
     - Display active team members with role badges.
     - Add an expandable/tabbed view for **Revoked Members** (history/audit).
  2. Change action from "Delete" to "Revoke Access" with confirmation explaining that company data and unlocked candidates are preserved.
  3. Allow Super Admins to "Reactivate Access" for revoked members.
  4. Display recruiter names and emails properly in the member list by joining `profiles`.

#### 1.4 Audit Trail UI Updates
- **Files:** `src/routes/_authenticated/employer/activity.tsx` & `src/components/employer/ActivityFeed.tsx`
- **Changes**:
  1. Fetch `actor:profiles!actor_id(full_name, email)` alongside activity records.
  2. Render actor attribution: *"By [Recruiter Name]"* or *"By System"*.
  3. Add filter for team operations (`team.invited`, `team.joined`, `team.revoked`, `team.role_changed`).

---

### Phase 2: Job Responses & Recommended Profile System (Section 6)

#### 2.1 Backend Engine: Proactive Job Candidate Recommendations
- **File:** `supabase/migrations/<timestamp>_job_candidate_recommendations.sql`
- **Changes**:
  1. Create RPC `public.get_recommended_candidates_for_job`:
     - Parameters: `_job_id uuid, _limit int DEFAULT 30, _offset int DEFAULT 0, _min_score int DEFAULT 50, _filter text DEFAULT NULL`
     - Logic:
       - Validate active job and company membership.
       - Exclude candidates who have **already applied** to this `_job_id`.
       - Exclude candidates who have been dismissed by the employer for this job (`job_candidate_dismissals`).
       - Compute match score via `public.compute_candidate_match(cp.user_id, _job_id, true)`.
       - Filter by `match_score >= _min_score`.
       - Check unlock status against `public.candidate_unlocks`.
       - Return candidate details (masked if not unlocked), `match_score`, `match_breakdown`, `tags` (`Hot Profile`, `Nearby Candidate`, `Recently Active`, `Recommended`), and `is_unlocked`.
  2. Create dismissal table:
     - `CREATE TABLE public.job_candidate_dismissals (job_id uuid, candidate_user_id uuid, dismissed_by uuid, created_at timestamptz, PRIMARY KEY (job_id, candidate_user_id))` to support dismissing candidates from recommendation feeds.
  3. Create RPC `public.invite_candidate_to_apply`:
     - Parameters: `_job_id uuid, _candidate_user_id uuid, _message text DEFAULT NULL`
     - Logic:
       - Verify company membership and active job status.
       - Insert into `notifications` for candidate: *"[Company Name] invited you to apply for [Job Title]"*.
       - Log activity: `candidate.invited_to_apply`.

#### 2.2 Integrated Job Responses + Recommendations Interface
- **File:** `src/routes/_authenticated/employer/jobs.$jobId.applicants.tsx`
- **Changes**:
  1. Add top-level **Source Switcher**:
     - `[ Applied Candidates (count) ]`
     - `[ AI Recommended Profiles (count) ✨ ]`
  2. In **AI Recommended Profiles** view:
     - Display candidate cards with:
       - Match Score circular meter or badge (e.g. `92% Match`).
       - Breakdown tags: 🔥 **Hot Profile**, 📍 **Nearby Candidate**, ⚡ **Recently Active**.
       - Skill match summary (e.g., `4 of 5 required skills`).
       - Masked contact details with **Unlock Profile** button (linking to allowance/wallet).
       - **Invite to Apply** button (triggers invitation notification).
       - **Dismiss** button (removes from active suggestions).
  3. Relevancy filters:
     - Sort by: "Highest Match", "Recently Active", "Nearby First".
     - Toggle filter: "Hot Profiles only", "Nearby only".

#### 2.3 Responses Page Integration
- **File:** `src/routes/_authenticated/employer/responses.tsx`
- **Changes**:
  1. Add candidate source filter:
     - "All Applications"
     - "Job-Specific AI Recommendations"
  2. When a job is selected from the job filter dropdown, show a quick-action card:
     *"We found 15 matching candidates in Bangalore who haven't applied yet."* with a direct link or tab switch to explore recommended profiles.

#### 2.4 Smart Recruiter Engagement Psychology & Active Hiring Intelligence
- **Files:** `src/routes/_authenticated/employer/dashboard.tsx` & `src/components/employer/RecommendedCandidatesWidget.tsx`
- **Changes**:
  1. **Dashboard Recommendation Widget**:
     - Shows "Active Hiring Intelligence" summary:
       - *"3 high-intent candidates were active in your job's location today."*
     - Quick preview cards with one-click invite or unlock.
  2. **Candidate Match Explanation Modal/Drawer**:
     - Clicking on the Match Score opens an explainability popup:
       - Skills overlap: 60/60 pts
       - Location compatibility: 20/20 pts (Bangalore)
       - Experience match: 15/15 pts (3 years in range 2–5)
       - Intent & Activity Bonus: +15 pts (Active 2h ago, applied to 4 jobs this week)
  3. **Visual Indicators**:
     - Highlighting "Hot Profiles" with high response probability to boost recruiter trust and platform dependency.

---

## 4. Verification & Testing Protocol

1. **Recruiter Soft Delete & Data Retention**:
   - Create 2 recruiter accounts in the test company.
   - Log in as Recruiter A and unlock a candidate.
   - Log in as Super Admin and revoke Recruiter A's access.
   - Verify Recruiter A's status becomes `revoked` in `employer_members` and they cannot access the employer portal.
   - Verify the company STILL retains the unlocked candidate in `candidate_unlocks`.
   - Verify the audit log records `team.revoked` with actor information.
2. **Audit Logging**:
   - Invite a new recruiter -> Verify `team.invited` in `employer_activity`.
   - Accept invite -> Verify `team.joined` in `employer_activity`.
   - Update candidate status -> Verify `application.status_changed` in `employer_activity`.
   - Open `/employer/activity` -> Verify all activities show the actor's name/email.
3. **Dual-Source Job Candidate Pipeline**:
   - Open `/employer/jobs/:jobId/applicants`.
   - Verify both tabs: "Applied Candidates" and "AI Recommended Profiles".
   - Test "AI Recommended Profiles":
     - Verify candidate list excludes existing applicants.
     - Verify candidates are ordered by match score.
     - Verify badges: "Hot Profile", "Nearby Candidate", "Recently Active".
     - Test "Invite to Apply" -> Verify candidate receives notification.
     - Test "Unlock Profile" -> Verify credit deduction and contact unmasking.
     - Test "Dismiss" -> Verify candidate is removed from recommendation feed.

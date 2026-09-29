# Employer CRM & Automation — Implementation Plan

Source spec: product flow diagram — `Lead Management → CRM Pipeline → Call Logs & Support → Follow-up Reminders → Employer Recommendations → Automation Engine`. This plan turns that flow into buildable phases against the current JobsKart schema, **reusing what already exists** (applications + status history, unlock/access model, candidate recommendations, notifications, pg_cron → edge-function plumbing) and adding only four new tables plus a template-first rule engine.

## 1. How other job portals do it (reference patterns)

| Portal | What they ship | Pattern worth stealing |
|---|---|---|
| **LinkedIn Recruiter** | Per-project pipelines with admin-managed **custom pipeline stages** plus **automated pipeline stages** (system moves candidates when they reply / accept); notes & reminders per candidate; bulk InMail outreach | Automated stages = event-triggered stage moves with an audit trail; custom stages are admin-governed, never per-recruiter |
| **Indeed employer dashboard / Indeed Hire** | Applicant inbox with screening answers, smart sorting, simple status pipeline; Hire adds CRM pipeline + email templates | Screening-first inbox; pipeline as a *thin layer over application status*, not a parallel object model |
| **ZipRecruiter** | Candidate match scores, automated invite-to-apply to matched candidates | Push recommendations *to the employer* ("who you should contact next"), don't just sort a list |
| **Workable / Lever / Greenhouse (ATS)** | Stages, tags, notes, email sequences, scheduled reminders, scorecards; workflow rules (trigger → action) with run history | Reminders as first-class assignable **tasks**; trigger→action rules with a visible execution ledger |
| **Recruit CRM / Zoho Recruit (staffing)** | Telecaller workspace: click-to-dial, call outcome codes, auto follow-up task on no-answer, bulk WhatsApp/SMS, workflow run ledger | **Outcome → default follow-up delay** mapping; every automation fire/skip recorded |
| **Apna / WorkIndia (Indian blue-collar)** | Recruiter app built around direct calling: call the candidate from the app, track call status, WhatsApp follow-ups, "hire in days" work queues | Phone-first UX: `tel:` deep links, big one-tap outcome buttons, a **"due today" work queue** instead of a dashboard |

**Synthesis for JobsKart:** in blue/grey-collar hiring the CRM is a **calling work queue**, not a desktop ATS. Every successful product converges on the same five moves: (1) pipeline = application statuses made visible as a board; (2) every contact attempt logged with an outcome code; (3) outcomes auto-schedule the next follow-up; (4) the day starts from a "what should I do now" queue (reminders + recommendations); (5) automation is template-first trigger→action rules with a run ledger employers can inspect. JobsKart already owns ~60% of the substrate — applications + trigger-maintained status history, unlocks with contact gating, match scores + `get_recommended_candidates_for_job`, notifications, cron→edge claim patterns — so this plan adds only the calling layer, the task layer and the rule engine on top, with **no parallel stage or lead tables**.

## 2. Current state (audit, 2026-09-28)

**Already exists (reuse, do not rebuild):**
- `applications` (`company_id, job_id, candidate_id, status application_status, employer_notes, viewed_by_employer_at`, UNIQUE(job, candidate)); enum `application_status = applied|shortlisted|interview|hired|rejected|withdrawn` (`20260617111751`). Triggers `tg_applications_after_insert/after_update` (`20260622093545:254-293`) already maintain `application_status_history` and notify the candidate on status change. `application_notes` for free-text notes.
- Ranking & sourcing: `get_ranked_job_applicants`, `get_recommended_candidates_for_job(_job_id,_limit,_offset,_min_score,_filter 'hot'|'nearby'|'active')`, `application_match_scores`, `application_ai_scores`, invite + dismissal (`20260928130001_job_candidate_recommendations.sql`).
- Access model: `candidate_unlocks` (per-job allowance → wallet credits), `can_access_job_responses(_job_id)`, rate-limited `search_candidates_for_company`, `log_contact_viewed`, masking convention (`MASKED_MOBILE` in `employer/database.tsx`).
- Plans & entitlements: `plans.limits jsonb` + `get_company_entitlements()`; `company_auto_renew(_company_id)` is the canonical COALESCE(plan-limit, plan_settings-default) gating pattern; new billing catalogue `billing_product_entitlements` / `company_benefit_grants` (`20260928130006`).
- Scheduling & notifications: `notifications` table + `NotificationBell`; pg_cron → pg_net → edge function pattern with vault service key; atomic-claim bookkeeping pattern (`claim_due_expiry_reminders`, `job-expiry-reminders` edge fn); Resend email in `supabase/functions/_shared/resend.ts`.
- Logging: `employer_activity` + `log_employer_activity` (EXECUTE revoked from authenticated — callable only from SECURITY DEFINER code/triggers).
- Employer surfaces: dashboard KPI cards, `employer/responses.tsx` inbox, `employer/jobs.$jobId.applicants.tsx` (status tabs + Recommended tab), nav array in `src/lib/employer-nav.ts`.

**Missing entirely:** call logs, follow-up tasks/reminders, pipeline board UI, unified lead inbox (applications ∪ unlocks), automation rules engine, next-best-action queue, CRM nav entry. Grep for `call_log|follow_up|automation|pipeline|crm` across `src/` + migrations returns nothing feature-related.

**Defect to fix en route:** application status changes are **direct client-side `supabase.update()` calls** (`employer/responses.tsx:262`, `employer/jobs.$jobId.applicants.tsx:375`). RLS limits them to company members, but there is no role check, no `employer_activity` entry, and no hook for automation. All status writes move to a DEFINER RPC in Phase 2 (the existing trigger keeps owning history + candidate notification, so nothing doubles).

**Conventions to follow:** `createServerFn().middleware([requireSupabaseAuth]).validator(zod)` in `src/lib/*.functions.ts`; stable error-code strings → friendly toasts (`mapExpiryError` pattern); money/access logic in Postgres SECURITY DEFINER functions with row locks; schema changes only as new re-runnable migrations; `types.ts` hand-extended until the user runs `supabase db push`; one commit per phase, main always working (Lovable sync).

## 3. Design decisions

1. **Pipeline = the existing `applications.status` enum, not a new stage table.** Board columns are the six statuses; a move = `crm_move_stage()` RPC (DEFINER: membership + role check → update status; existing trigger writes history + notifies candidate; RPC adds `employer_activity` + automation hooks). LinkedIn-style custom company stages deferred to v2 — enum changes ripple into candidate UI, emails and reports.
2. **Leads are derived, never stored.** `get_crm_leads()` DEFINER RPC unions `applications` ∪ `candidate_unlocks` into one lead per (company, candidate): `source application|unlock|both`, `stage` (application status, else `new`), `contacted` (any call_log), `last_call_at/outcome`, `open_tasks`, `next_follow_up_at`, best match score. No lead table ⇒ zero sync drift with applications/unlocks, and retention sweeps need no lead branch.
3. **Call logs are telecaller-grade but phone-free.** `call_logs` stores outcome, notes, duration, `contact_source ('application'|'unlock')` — **never the phone number** (no PII duplication; read path joins `profiles` and applies the existing masking rule). The insert RPC re-verifies contact entitlement server-side (`can_access_job_responses(job)` OR unlock row exists), so a call log can never attest to access that didn't exist. UI is phone-first: one-tap `tel:` link + six large outcome buttons (WorkIndia pattern).
4. **Outcome → follow-up defaults** in `crm_settings.outcome_followup_hours` jsonb: `no_answer→48h, switched_off→24h, connected_neutral→24h, follow_up_requested→user-picked, connected_interested→0 (suggest stage move instead), connected_not_interested/wrong_number→0 (close hint)`. `crm_log_call()` auto-creates the task (source `call_log`) unless the caller overrides — the single highest-ROI automation in staffing CRMs.
5. **Follow-up reminders = tasks + atomic-claim cron.** `follow_up_tasks` (assignee, due_at, status `open|done|snoozed|cancelled`, priority 0–2, source `manual|call_log|automation|system`). pg_cron `*/5 * * * *` → edge `crm-task-reminders` → `claim_due_crm_tasks()` DEFINER (single `UPDATE … WHERE status='open' AND due_at <= now() AND due_notified_at IS NULL … RETURNING`, sets `due_notified_at`) → edge inserts `notifications` (type `crm.follow_up`) for assignee + creator. Overdue is computed at read time, never stored.
6. **Recommendations = a deterministic next-best-action queue.** `get_crm_next_best_actions(_company_id,_limit)` scores open leads in SQL: overdue follow-up (+2 + overdue days), unlocked-not-called >24h (+3), applied-not-viewed >48h (+2), shortlisted-no-interview >3d (+2), promised call-back due (+3), match score ≥70 stuck at `applied` (+2), interview tomorrow unconfirmed (+1). Weights live in `crm_settings.weights` jsonb (admin-tunable). The existing `get_recommended_candidates_for_job` stays as the separate "who to source" card — CRM recommendations answer "what do I do next with leads I already have".
7. **Automation engine = template-first trigger→action rules with a run ledger.** `automation_rules` + `automation_runs` with `UNIQUE(rule_id, trigger_key)` (trigger_key encodes entity + window, e.g. `app:<id>:uncontacted`) = idempotency. v1 triggers: `application_uncontacted_h`, `call_no_answer`, `stage_stalled_h`, `task_overdue_h`, `unlock_unused_h`. v1 actions: `create_task`, `notify`, `move_stage` (forward-only; never auto-moves into `rejected/withdrawn/hired`). Tick: pg_cron `*/10 * * * *` → edge `crm-automation-tick` → `crm_tick_automation(_batch)` DEFINER: `FOR UPDATE SKIP LOCKED` over enabled rules, one static SQL branch per trigger (no dynamic SQL), `cooldown_hours` + `max_fires_per_lead` enforced from the runs ledger, every fire/skip/error written to `automation_runs`. Kill switches: global `plan_settings.crm_automation_enabled`, per-rule `enabled`, plan entitlement.
8. **Seeded templates, not a blank editor.** First automation-page visit calls `crm_ensure_default_rules()` which inserts three enabled rules for the company: *new applicant uncontacted 24h → task*, *no-answer call → call-back task in 48h*, *shortlisted 3d without interview → notify*. UI offers a template gallery + edit/toggle; arbitrary condition-builder UI is v2 (conditions stay jsonb, template-driven).
9. **Plan gating: core CRM free, automation paid.** Pipeline, calls, tasks, recommendations on every plan (retention features). The automation engine is gated by a new limits key `crm_automation_rules_max` (seed: Basic 0, Regular 3, Unlimited −1) resolved by `company_crm_entitlement(_company_id)` following the `company_auto_renew` COALESCE pattern; the same key is registered in the new billing catalogue so it can be sold as an add-on benefit later.
10. **Roles:** any company member can read CRM data; `recruiter` and above can move stages, log calls, manage tasks; only `hr_admin`/`super_admin` (company-scoped) can create/edit rules. Enforced inside the DEFINER RPCs via `has_company_role`.
11. **Retention & privacy:** `call_logs.application_id` / `follow_up_tasks.application_id` are `ON DELETE CASCADE`, so the existing `response-retention-sweep` (60-day model) purges CRM rows together with the application; unlock-only tasks/calls (application_id NULL) are deleted by an added sweep branch keyed on `candidate_unlocks` retention. Raw mobiles never stored; contact reveals keep flowing through `log_contact_viewed`.
12. **Activity logging:** new kinds `crm_stage_moved, crm_call_logged, crm_task_created, crm_task_completed, crm_task_snoozed, crm_rule_saved, crm_rule_toggled, crm_automation_fired`, all emitted via `log_employer_activity` inside the DEFINER functions — the existing `/employer/activity` feed surfaces them for free.
13. **No CTI/telephony and no WhatsApp sending in v1.** Manual logging + `tel:` links; `register_whatsapp_send` ledger exists but no sender integration ships today, so a WhatsApp action type is deliberately left out of the v1 enum (schema leaves room).
14. **Board UX without new dependencies:** v1 stage moves are per-card menus (forward/back buttons + column counts), not drag-and-drop — no dnd library exists in the repo; drag is a v2 nicety.

## 4. Schema (single re-runnable migration `20260928150000_employer_crm_automation.sql`)

```
enums:
  call_outcome         = connected_interested | connected_neutral | connected_not_interested
                       | no_answer | switched_off | wrong_number
  followup_task_status = open | done | snoozed | cancelled
  crm_trigger          = application_uncontacted_h | call_no_answer | stage_stalled_h
                       | task_overdue_h | unlock_unused_h
  crm_action           = create_task | notify | move_stage

call_logs(id pk, company_id fk companies CASCADE, job_id fk jobs SET NULL,
          application_id fk applications CASCADE NULL,
          candidate_id fk auth.users CASCADE NOT NULL,
          caller_id fk auth.users NOT NULL,
          outcome call_outcome NOT NULL, duration_sec int NULL CHECK >= 0,
          notes text, contact_source text NOT NULL CHECK IN ('application','unlock'),
          created_at default now())
  indexes: (company_id, created_at desc), (application_id, created_at desc),
           (candidate_id, company_id)

follow_up_tasks(id pk, company_id fk companies CASCADE, job_id fk jobs CASCADE NULL,
          application_id fk applications CASCADE NULL,
          candidate_id fk auth.users CASCADE NOT NULL,
          assignee_id fk auth.users SET NULL NULL, title text NOT NULL, body text,
          priority int NOT NULL DEFAULT 1 CHECK 0..2, due_at timestamptz NOT NULL,
          status followup_task_status NOT NULL DEFAULT 'open',
          source text NOT NULL DEFAULT 'manual' CHECK IN ('manual','call_log','automation','system'),
          source_ref uuid NULL, due_notified_at timestamptz NULL,
          completed_at timestamptz NULL, completed_by fk auth.users NULL,
          created_by fk auth.users NOT NULL, created_at, updated_at)
  indexes: (company_id, status, due_at), (assignee_id, status, due_at), (application_id)

automation_rules(id pk, company_id fk companies CASCADE, name text NOT NULL,
          trigger crm_trigger NOT NULL, conditions jsonb NOT NULL DEFAULT '{}',
          action crm_action NOT NULL, action_payload jsonb NOT NULL DEFAULT '{}',
          enabled bool NOT NULL DEFAULT true,
          cooldown_hours int NOT NULL DEFAULT 24 CHECK >= 0,
          max_fires_per_lead int NOT NULL DEFAULT 3 CHECK > 0,
          created_by fk auth.users NOT NULL, created_at, updated_at)
  index: (company_id, enabled, trigger)

automation_runs(id pk, rule_id fk automation_rules CASCADE, company_id fk companies CASCADE,
          application_id uuid NULL, candidate_id uuid NULL,
          trigger_key text NOT NULL, fired_at default now(),
          result text NOT NULL CHECK IN ('ok','skipped','error'),
          detail jsonb NOT NULL DEFAULT '{}',
          UNIQUE(rule_id, trigger_key))
  index: (company_id, fired_at desc)

crm_settings(id pk CHECK (id = 1), weights jsonb NOT NULL,
          outcome_followup_hours jsonb NOT NULL, automation_batch int NOT NULL DEFAULT 200,
          updated_at)
  seed weights = {overdue_task:2, unlock_unused:3, applied_unviewed:2, stage_stalled:2,
                  callback_due:3, hot_stuck:2, interview_unconfirmed:1}
  seed outcome_followup_hours = {no_answer:48, switched_off:24, connected_neutral:24,
                  follow_up_requested:24, connected_interested:0,
                  connected_not_interested:0, wrong_number:0}

alterations:
  plan_settings  + crm_automation_enabled bool NOT NULL DEFAULT true
                 + crm_automation_rules_max int NOT NULL DEFAULT 3
  plans.limits   jsonb_set 'crm_automation_rules_max' → Basic 0 / Regular 3 / Unlimited -1
  cron: crm-task-reminders   '*/5 * * * *'  → edge fn crm-task-reminders
  cron: crm-automation-tick  '*/10 * * * *' → edge fn crm-automation-tick
```

RLS on all four new tables: `SELECT` for authenticated via `has_company_membership(auth.uid(), company_id)`; **no** insert/update/delete policies for authenticated (every write goes through a DEFINER RPC); `service_role` ALL. `crm_settings`: authenticated SELECT (weights are not sensitive), writes only via super-admin DEFINER RPC. `automation_runs` readable by members (transparency ledger).

## 5. SQL function contracts (all `SECURITY DEFINER SET search_path = public`)

| Function | Behaviour |
|---|---|
| `crm_move_stage(_application_id, _to application_status, _actor)` → jsonb | membership + role (`recruiter` ok) check; update `applications.status` (existing trigger writes history + candidate notification); `log_employer_activity('crm_stage_moved')`. Errors: `not_a_member`, `insufficient_role`, `application_not_found` |
| `crm_log_call(_company_id, _application_id NULL, _candidate_id, _job_id NULL, _outcome, _notes NULL, _duration_sec NULL, _follow_up_at NULL, _actor)` → jsonb `{call_id, task_id}` | entitlement re-check: application path needs `can_access_job_responses(job)`; unlock-only path needs a `candidate_unlocks` row; insert call; auto-task from `outcome_followup_hours` (or explicit `_follow_up_at`); activity `crm_call_logged`. Error: `contact_not_unlocked` |
| `crm_save_task(_task_id NULL, _company_id, _application_id NULL, _candidate_id, _job_id NULL, _title, _body NULL, _priority, _due_at, _assignee_id NULL, _actor)` → uuid | membership check; upsert; resets `due_notified_at` on due_at change; activity `crm_task_created` |
| `crm_set_task_status(_task_id, _status, _new_due_at NULL, _actor)` | `done` stamps completed_at/by; `snoozed` requires `_new_due_at`; activity `crm_task_completed` / `crm_task_snoozed` |
| `claim_due_crm_tasks()` → jsonb | atomic claim (sets `due_notified_at`) returning `[{task_id, company_id, assignee_id, created_by, title, link}]`; service_role-only; edge fn fan-outs notifications |
| `crm_ensure_default_rules(_company_id, _actor)` | inserts the three template rules when the company has none; idempotent |
| `crm_save_rule(_rule_id NULL, _company_id, _name, _trigger, _conditions, _action, _action_payload, _enabled, _cooldown_hours, _max_fires, _actor)` | hr_admin+ only; on create/re-enable enforces `count(enabled) < rules_max` (−1 = unlimited) via `company_crm_entitlement`; activity `crm_rule_saved`/`crm_rule_toggled`. Errors: `rule_limit_reached`, `automation_disabled`, `insufficient_role` |
| `crm_tick_automation(_batch int DEFAULT 200)` → jsonb `{rules_evaluated, fired, skipped, errors}` | service_role-only; loops enabled rules `FOR UPDATE SKIP LOCKED`; static SQL branch per trigger builds `(rule, application/candidate, trigger_key)` sets filtered by cooldown + max-fires (`NOT EXISTS` on runs); executes action in-tx (`move_stage` reuses the internal helper of `crm_move_stage`, forward-only); `INSERT … ON CONFLICT (rule_id, trigger_key) DO NOTHING` into runs; per-rule exception → run row `result='error'` |
| `get_crm_leads(_company_id, _job_id NULL, _source NULL, _stage NULL, _contacted NULL, _limit, _offset)` → table | membership check; union per decision 2 with aggregates (last call, open tasks, next follow-up, best match score) |
| `get_crm_next_best_actions(_company_id, _limit)` → table `(kind, score, reason, application_id, candidate_id, job_id, link)` | weighted scoring per decision 6, weights from `crm_settings` |
| `company_crm_entitlement(_company_id)` → table `(automation_enabled bool, rules_max int)` | `COALESCE(plan.limits->>'crm_automation_rules_max', plan_settings.crm_automation_rules_max)` + global kill switch |
| `crm_admin_update_settings(_weights jsonb, _outcome_hours jsonb)` | super_admin only; upserts `crm_settings` |

## 6. Server functions (`src/lib/crm.functions.ts`)

Zod-validated wrappers over the RPCs above: `getLeads`, `moveStage`, `logCall`, `saveTask`, `setTaskStatus`, `getTasks(companyId, view 'due'|'overdue'|'open'|'all')`, `getNextBestActions`, `getRules`, `saveRule`, `toggleRule`, `getRuns`, `getEntitlement`, `ensureDefaultRules`. `mapCrmError()` maps stable codes (`not_a_member, insufficient_role, application_not_found, contact_not_unlocked, rule_limit_reached, automation_disabled, task_not_found, rule_not_found`) to friendly toasts, same pattern as `mapExpiryError`.

## 7. UI surfaces

- **Nav:** "CRM" entry (`PhoneCall` icon) in `src/lib/employer-nav.ts` after Responses.
- **`/employer/crm` hub:** KPI strip (due today, overdue, uncontacted leads, hires this week); **Work queue** = next-best-action cards with reason chips and one-click actions (call / schedule / move stage); **Follow-ups** list (due / overdue / open tabs, inline complete + snooze-with-datepicker); **Leads** table (job filter limited to live owned jobs, source badge application/unlock/both, stage chip, last-call outcome + age, next follow-up, row action menu).
- **`employer/jobs.$jobId.applicants.tsx`:** Table | **Board** toggle; board = six status columns with counts; card shows name, match score, contacted dot, move menu; card opens a **drawer** (profile summary, contact reveal per existing access rules, call timeline, log-call form with outcome buttons + `tel:` link, notes via existing `application_notes`, tasks, schedule-follow-up).
- **`/employer/crm/automation`:** entitlement banner + upgrade CTA when `rules_max = 0`; rule list (trigger→action summary, enabled switch, fires count, last fired); editor dialog with template gallery; runs ledger table (last 50: rule, lead, result, when, detail).
- **Dashboard:** new KPI card "Follow-ups due" (amber when overdue > 0) linking to `/employer/crm`.
- **Notifications:** type `crm.follow_up` deep-links to the task's lead drawer; automation notices link to the runs ledger.

## 8. Phases

### Phase 1 — Schema, settings, entitlements (S)
Migration §4 + `types.ts` hand-extensions (tables, enums, functions) + seed blocks guarded by `WHERE NOT EXISTS`.
**Acceptance:** migration re-runs cleanly on a scratch DB; cross-company SELECT denied by RLS; `company_crm_entitlement` returns 0/3/−1 per seeded plan and honours `plan_settings` fallback.

### Phase 2 — Stage RPC + pipeline board (M)
`crm_move_stage` + board toggle & move menus on the applicants page; **replace the direct client-side status updates** in `responses.tsx` and `jobs.$jobId.applicants.tsx` with the server fn; activity kinds land in `/employer/activity`.
**Acceptance:** a move writes exactly one history row (trigger) + one activity row (RPC) + one candidate notification (trigger); a non-member and a wrong-company member both get friendly errors; board counts match table tabs.

### Phase 3 — Call logs + lead inbox + CRM hub v1 (M)
`crm_log_call`, `get_crm_leads`, `/employer/crm` hub (leads table + KPI strip), call drawer on applicants board, outcome→auto-task defaults.
**Acceptance:** logging a call on an unlocked lead creates call + auto task with the configured delay; logging on a locked (not unlocked, responses-locked) lead fails with `contact_not_unlocked` toast and stores nothing; leads union shows application-only, unlock-only and both rows with correct contacted flags.

### Phase 4 — Follow-up tasks + reminders (M)
Task CRUD RPCs, follow-ups list + dashboard KPI, edge fn `crm-task-reminders` + cron, notification fan-out, snooze semantics.
**Acceptance:** a task whose due_at passes gets exactly one notification even if the edge fn runs twice (claim is atomic); snooze re-arms and re-notifies at the new time; overdue counts stable across reloads; cascade delete verified when an application is purged.

### Phase 5 — Automation engine (L)
Rules CRUD + templates + `crm_tick_automation` + edge fn `crm-automation-tick` + cron + plan gating + runs ledger UI.
**Acceptance:** seeded rule fires once for a backdated uncontacted application and not again inside cooldown; two concurrent ticks never double-fire (`SKIP LOCKED` + unique trigger_key); enabling a 4th rule on Regular plan rejects with `rule_limit_reached`; global kill switch stops all firing; every fire/skip/error visible in the runs ledger with reason.

### Phase 6 — Next-best actions + weights admin (M)
`get_crm_next_best_actions`, work-queue cards on the hub, `crm_admin_update_settings` + a Masters-panel tab for weights/outcome hours.
**Acceptance:** each action kind reproducible from seeded data with the documented score; editing a weight reorders the queue without a deploy; reasons render as human-readable chips.

## 9. Out of scope (v1)

Custom/company-defined pipeline stages; drag-and-drop board; CTI/dialer integration and call recording; WhatsApp/SMS sending actions and candidate drip sequences; bulk lead actions; candidate-facing pipeline visibility beyond the existing status; native mobile surfaces; visual rule builder (conditions jsonb stays template-driven); CRM funnel analytics (existing `reports.tsx` funnel chart suffices until a dedicated phase).

## 10. Risks & mitigations

- **Tick loop cost on large companies** → batch limit from `crm_settings.automation_batch`, `FOR UPDATE SKIP LOCKED`, covering indexes on (company, status, due_at) and (company, enabled, trigger); per-trigger SQL is index-scoped, never a full lead scan.
- **Notification spam** → cooldown_hours + max_fires_per_lead + `due_notified_at` claim column; reminders and automation use separate notification types so the bell can filter.
- **Legacy direct status updates bypassing logs** → removed in Phase 2; RLS already blocks cross-company writes, RPC adds role check + activity + hooks.
- **PII leakage via call logs** → phone numbers never stored; entitlement re-verified at insert; reads join masked profile fields.
- **Automation moving candidates wrongly** → `move_stage` action is forward-only and refuses terminal statuses; every auto-move carries `changed_by = null` + `crm_automation_fired` activity so employers can audit and revert from the board.
- **Lovable sync / branch health** → one commit per phase, main always builds, migrations pushed by the user (no DB creds in agent env), never rewrite pushed history.

## 11. Sizing

| Phase | Effort | Notes |
|---|---|---|
| 1 Schema/settings/entitlements | S | One migration + types hand-edit |
| 2 Stage RPC + board | M | Includes removing direct client updates |
| 3 Call logs + leads + hub | M | Core of the deck's first three blocks |
| 4 Tasks + reminders | M | Cron + edge fn + notifications |
| 5 Automation engine | L | Rule engine, tick, ledger, gating |
| 6 Next-best actions + admin | M | SQL scoring + Masters tab |

## 12. Deck coverage matrix

| Deck block | Where it lands | Phase |
|---|---|---|
| Lead Management | `get_crm_leads` (applications ∪ unlocks, contact state) + `/employer/crm` leads inbox | 3 |
| CRM Pipeline | Status board on applicants page + `crm_move_stage` RPC | 2 |
| Call Logs & Support | `call_logs` + outcome buttons + `tel:` + notes via `application_notes` | 3 |
| Follow-up Reminders | `follow_up_tasks` + claim cron + notifications + dashboard KPI | 4 |
| Employer Recommendations | `get_crm_next_best_actions` work queue + existing `get_recommended_candidates_for_job` sourcing card | 6 |
| Automation Engine | `automation_rules/runs` + `crm_tick_automation` + edge/cron + templates + plan gating | 5 |

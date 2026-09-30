import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type CallOutcome = Database["public"]["Enums"]["call_outcome"];
type TaskStatus = Database["public"]["Enums"]["followup_task_status"];
type CrmTrigger = Database["public"]["Enums"]["crm_trigger"];
type CrmAction = Database["public"]["Enums"]["crm_action"];

export type ApplicationStatus = Database["public"]["Enums"]["application_status"];

// JSON-object shape that survives TanStack Start's serializable-return check
// (Record<string, unknown> does not).
export type JsonRecord = Record<string, string | number | boolean | null>;

// Static badge class map — all strings must be written in full so Tailwind JIT
// can detect them at build time (dynamic template strings are NOT scanned).
const OUTCOME_TONE_MAP: Record<string, { bg: string; text: string }> = {
  connected_interested:     { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  connected_neutral:        { bg: "bg-blue-100 dark:bg-blue-900/40",       text: "text-blue-700 dark:text-blue-300" },
  connected_not_interested: { bg: "bg-slate-100 dark:bg-slate-800",        text: "text-slate-500 dark:text-slate-400" },
  no_answer:                { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-400" },
  switched_off:             { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-400" },
  wrong_number:             { bg: "bg-slate-100 dark:bg-slate-800",        text: "text-slate-500 dark:text-slate-400" },
};

/** Returns a combined Tailwind class string for a call outcome badge. */
export function getOutcomeBadgeClass(outcomeId: string): string {
  const t = OUTCOME_TONE_MAP[outcomeId] ?? { bg: "bg-slate-100", text: "text-slate-500" };
  return `${t.bg} ${t.text}`;
}

export const CALL_OUTCOMES: { id: CallOutcome; label: string }[] = [
  { id: "connected_interested",     label: "Interested" },
  { id: "connected_neutral",        label: "Connected" },
  { id: "connected_not_interested", label: "Not interested" },
  { id: "no_answer",                label: "No answer" },
  { id: "switched_off",             label: "Switched off" },
  { id: "wrong_number",             label: "Wrong number" },
];


// Stable error codes raised by the CRM RPCs in
// supabase/migrations/20260929090000_employer_crm_automation.sql (plus the
// shared update_application_status guard from 20260929080000).
const CRM_ERROR_MESSAGES: Record<string, string> = {
  not_a_member: "You don't have access to this company's CRM.",
  insufficient_role: "Only company admins can manage automation rules.",
  application_not_found: "This application could not be found.",
  contact_not_unlocked:
    "Unlock this candidate's contact details before logging calls.",
  rule_limit_reached:
    "Your plan's automation rule limit is reached — pause a rule or upgrade.",
  automation_disabled: "Automation is not available on your plan.",
  task_not_found: "This follow-up task could not be found.",
  rule_not_found: "This automation rule could not be found.",
  snooze_needs_due_date: "Pick a new due date to snooze this follow-up.",
  insufficient_permissions_or_invalid_transition:
    "Some candidates can't move to that status (hired/rejected are final).",
  invalid_status: "That status is not allowed.",
};

export function mapCrmError(message: string): string {
  for (const [code, friendly] of Object.entries(CRM_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendly;
  }
  return message;
}

const uuid = z.string().uuid();

export const moveStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        applicationIds: z.array(uuid).min(1),
        status: z.enum([
          "applied",
          "shortlisted",
          "interview",
          "hired",
          "rejected",
          "withdrawn",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("update_application_status", {
      _application_ids: data.applicationIds,
      _status: data.status,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        candidateId: uuid,
        outcome: z.enum([
          "connected_interested",
          "connected_neutral",
          "connected_not_interested",
          "no_answer",
          "switched_off",
          "wrong_number",
        ]),
        applicationId: uuid.nullish(),
        jobId: uuid.nullish(),
        notes: z.string().max(2000).nullish(),
        durationSec: z.number().int().min(0).nullish(),
        followUpAt: z.string().datetime().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("crm_log_call", {
      _company_id: data.companyId,
      _candidate_id: data.candidateId,
      _outcome: data.outcome,
      _application_id: data.applicationId ?? undefined,
      _job_id: data.jobId ?? undefined,
      _notes: data.notes ?? undefined,
      _duration_sec: data.durationSec ?? undefined,
      _follow_up_at: data.followUpAt ?? undefined,
    });
    if (error) throw new Error(error.message);
    return result as { call_id: string; task_id: string | null };
  });

export const getCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ companyId: uuid, candidateId: uuid }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("call_logs")
      .select("id, outcome, notes, duration_sec, created_at, caller_id, job_id, application_id")
      .eq("company_id", data.companyId)
      .eq("candidate_id", data.candidateId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return rows as {
      id: string;
      outcome: CallOutcome;
      notes: string | null;
      duration_sec: number | null;
      created_at: string;
      caller_id: string;
      job_id: string | null;
      application_id: string | null;
    }[];
  });

export const saveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        candidateId: uuid,
        title: z.string().min(2).max(140),
        dueAt: z.string().datetime(),
        taskId: uuid.nullish(),
        applicationId: uuid.nullish(),
        jobId: uuid.nullish(),
        body: z.string().max(2000).nullish(),
        priority: z.number().int().min(0).max(2).optional(),
        assigneeId: uuid.nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("crm_save_task", {
      _company_id: data.companyId,
      _candidate_id: data.candidateId,
      _title: data.title,
      _due_at: data.dueAt,
      _task_id: data.taskId ?? undefined,
      _application_id: data.applicationId ?? undefined,
      _job_id: data.jobId ?? undefined,
      _body: data.body ?? undefined,
      _priority: data.priority ?? 1,
      _assignee_id: data.assigneeId ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        taskId: uuid,
        status: z.enum(["open", "done", "snoozed", "cancelled"]),
        newDueAt: z.string().datetime().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("crm_set_task_status", {
      _task_id: data.taskId,
      _status: data.status,
      _new_due_at: data.newDueAt ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        view: z.enum(["due", "overdue", "open", "all"]).default("due"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    let qy = context.supabase
      .from("follow_up_tasks")
      .select(
        "id, title, body, priority, due_at, status, source, application_id, job_id, candidate_id, assignee_id, profiles!candidate_id (full_name, avatar_url)",
      )
      .eq("company_id", data.companyId)
      .order("due_at", { ascending: true })
      .limit(100);
    if (data.view !== "all") qy = qy.eq("status", "open");
    if (data.view === "due")
      qy = qy.gte("due_at", now).lte("due_at", new Date(Date.now() + 86_400_000).toISOString());
    if (data.view === "overdue") qy = qy.lt("due_at", now);
    const { data: rows, error } = await qy;
    if (error) throw new Error(error.message);
    return rows as unknown as {
      id: string;
      title: string;
      body: string | null;
      priority: number;
      due_at: string;
      status: TaskStatus;
      source: string;
      application_id: string | null;
      job_id: string | null;
      candidate_id: string;
      assignee_id: string | null;
      profiles: { full_name: string | null; avatar_url: string | null } | null;
    }[];
  });

export const getTaskCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const endOfDay = new Date(Date.now() + 86_400_000).toISOString();
    const [overdue, due] = await Promise.all([
      context.supabase
        .from("follow_up_tasks")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.companyId)
        .eq("status", "open")
        .lt("due_at", now),
      context.supabase
        .from("follow_up_tasks")
        .select("id", { count: "exact", head: true })
        .eq("company_id", data.companyId)
        .eq("status", "open")
        .gte("due_at", now)
        .lte("due_at", endOfDay),
    ]);
    if (overdue.error) throw new Error(overdue.error.message);
    if (due.error) throw new Error(due.error.message);
    return { overdue: overdue.count ?? 0, dueToday: due.count ?? 0 };
  });

export const getLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        jobId: uuid.nullish(),
        source: z.enum(["application", "unlock", "both"]).nullish(),
        stage: z.string().nullish(),
        contacted: z.boolean().nullish(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("get_crm_leads", {
      _company_id: data.companyId,
      _job_id: data.jobId ?? undefined,
      _source: data.source ?? undefined,
      _stage: data.stage ?? undefined,
      _contacted: data.contacted ?? undefined,
      _limit: data.limit ?? 50,
      _offset: data.offset ?? 0,
    });
    if (error) throw new Error(error.message);
    return rows as Database["public"]["Functions"]["get_crm_leads"]["Returns"];
  });

export const getNextBestActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ companyId: uuid, limit: z.number().int().min(1).max(20).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "get_crm_next_best_actions",
      { _company_id: data.companyId, _limit: data.limit ?? 8 },
    );
    if (error) throw new Error(error.message);
    return rows as Database["public"]["Functions"]["get_crm_next_best_actions"]["Returns"];
  });

export const getRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("automation_rules")
      .select("id, name, trigger, conditions, action, action_payload, enabled, cooldown_hours, max_fires_per_lead, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows as unknown as {
      id: string;
      name: string;
      trigger: CrmTrigger;
      conditions: JsonRecord;
      action: CrmAction;
      action_payload: JsonRecord;
      enabled: boolean;
      cooldown_hours: number;
      max_fires_per_lead: number;
      created_at: string;
    }[];
  });

export const saveRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        name: z.string().min(3).max(80),
        trigger: z.enum([
          "application_uncontacted_h",
          "call_no_answer",
          "stage_stalled_h",
          "task_overdue_h",
          "unlock_unused_h",
        ]),
        action: z.enum(["create_task", "notify", "move_stage"]),
        enabled: z.boolean(),
        ruleId: uuid.nullish(),
        conditions: z.record(z.string(), z.unknown()).optional(),
        actionPayload: z.record(z.string(), z.unknown()).optional(),
        cooldownHours: z.number().int().min(0).max(24 * 30).optional(),
        maxFiresPerLead: z.number().int().min(1).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("crm_save_rule", {
      _company_id: data.companyId,
      _name: data.name,
      _trigger: data.trigger,
      _action: data.action,
      _enabled: data.enabled,
      _rule_id: data.ruleId ?? undefined,
      _conditions: (data.conditions ?? {}) as never,
      _action_payload: (data.actionPayload ?? {}) as never,
      _cooldown_hours: data.cooldownHours ?? 24,
      _max_fires_per_lead: data.maxFiresPerLead ?? 3,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const getRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("automation_runs")
      .select(
        "id, trigger_key, result, detail, fired_at, candidate_id, application_id, automation_rules (name)",
      )
      .eq("company_id", data.companyId)
      .order("fired_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows as unknown as {
      id: string;
      trigger_key: string;
      result: string;
      detail: JsonRecord;
      fired_at: string;
      candidate_id: string | null;
      application_id: string | null;
      automation_rules: { name: string } | null;
    }[];
  });

export const getEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "company_crm_entitlement",
      { _company_id: data.companyId },
    );
    if (error) throw new Error(error.message);
    const ent = (rows as { automation_enabled: boolean; rules_max: number }[] | null)?.[0];
    return { enabled: ent?.automation_enabled ?? false, rulesMax: ent?.rules_max ?? 0 };
  });

export const ensureDefaultRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("crm_ensure_default_rules", {
      _company_id: data.companyId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

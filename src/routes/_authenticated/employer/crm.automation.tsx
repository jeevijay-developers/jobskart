import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  History,
  Lock,
  Play,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { RoleGate } from "@/components/employer/RoleGate";
import { useEmployerRole } from "@/hooks/use-employer-role";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import {
  ensureDefaultRules,
  getEntitlement,
  getRules,
  getRuns,
  mapCrmError,
  saveRule,
} from "@/lib/crm.functions";

export const Route = createFileRoute(
  "/_authenticated/employer/crm/automation",
)({
  head: () => ({ meta: [{ title: "CRM Automation · JobsKart Employer" }] }),
  component: CrmAutomationPage,
});

type Rule = {
  id: string;
  name: string;
  trigger:
    | "application_uncontacted_h"
    | "call_no_answer"
    | "stage_stalled_h"
    | "task_overdue_h"
    | "unlock_unused_h";
  conditions: Record<string, unknown>;
  action: "create_task" | "notify" | "move_stage";
  action_payload: Record<string, unknown>;
  enabled: boolean;
  cooldown_hours: number;
  max_fires_per_lead: number;
  created_at: string;
};

type Run = {
  id: string;
  trigger_key: string;
  result: string;
  detail: Record<string, unknown>;
  fired_at: string;
  candidate_id: string | null;
  application_id: string | null;
  automation_rules: { name: string } | null;
};

function triggerLabel(t: string) {
  switch (t) {
    case "application_uncontacted_h":
      return "Application uncontacted for 24h+";
    case "call_no_answer":
      return "Call ended in 'No answer' or 'Switched off'";
    case "stage_stalled_h":
      return "Lead stalled in stage for 48h+";
    case "task_overdue_h":
      return "Follow-up task is overdue";
    case "unlock_unused_h":
      return "Unlocked contact unused after 24h";
    default:
      return t;
  }
}

function actionLabel(a: string) {
  switch (a) {
    case "create_task":
      return "Create follow-up task";
    case "notify":
      return "Send alert notification";
    case "move_stage":
      return "Auto-move stage";
    default:
      return a;
  }
}

function CrmAutomationPage() {
  const { canViewReports: canManageAutomation, loading: roleLoading } = useEmployerRole();
  const [cid, setCid] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<{
    enabled: boolean;
    rulesMax: number;
  } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // New rule form states
  const [ruleName, setRuleName] = useState("");
  const [trigger, setTrigger] = useState<Rule["trigger"]>(
    "application_uncontacted_h",
  );
  const [action, setAction] = useState<Rule["action"]>("create_task");

  const fetchEntitlement = useServerFn(getEntitlement);
  const fetchRules = useServerFn(getRules);
  const fetchRuns = useServerFn(getRuns);
  const saveRuleFn = useServerFn(saveRule);
  const ensureDefaults = useServerFn(ensureDefaultRules);

  useEffect(() => {
    (async () => {
      let id = getActiveCompanyId();
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const ms = await fetchMyCompanies(u.user.id);
          id = ms[0]?.company_id ?? null;
        }
      }
      if (!id) return;
      setCid(id);
    })();
  }, []);

  const loadData = async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const ent = await fetchEntitlement({ data: { companyId: cid } });
      setEntitlement(ent);

      if (ent.enabled) {
        const [rList, runList] = await Promise.all([
          fetchRules({ data: { companyId: cid } }),
          fetchRuns({ data: { companyId: cid } }),
        ]);
        setRules(rList as Rule[]);
        setRuns(runList as Run[]);
      }
    } catch (e) {
      toast.error(
        mapCrmError(
          e instanceof Error ? e.message : "Failed to load automations",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cid) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid]);

  const handleToggle = async (rule: Rule) => {
    if (!cid) return;
    try {
      await saveRuleFn({
        data: {
          companyId: cid,
          ruleId: rule.id,
          name: rule.name,
          trigger: rule.trigger,
          action: rule.action,
          enabled: !rule.enabled,
          cooldownHours: rule.cooldown_hours,
          maxFiresPerLead: rule.max_fires_per_lead,
        },
      });
      toast.success(rule.enabled ? "Rule paused" : "Rule active");
      loadData();
    } catch (e) {
      toast.error(
        mapCrmError(e instanceof Error ? e.message : "Couldn't update rule"),
      );
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cid || !ruleName.trim()) return;
    try {
      await saveRuleFn({
        data: {
          companyId: cid,
          name: ruleName.trim(),
          trigger,
          action,
          enabled: true,
          cooldownHours: 24,
          maxFiresPerLead: 3,
        },
      });
      toast.success("Automation rule created");
      setRuleName("");
      setCreating(false);
      loadData();
    } catch (err) {
      toast.error(
        mapCrmError(err instanceof Error ? err.message : "Failed to save rule"),
      );
    }
  };

  const handleApplyDefaults = async () => {
    if (!cid) return;
    try {
      await ensureDefaults({ data: { companyId: cid } });
      toast.success("Default CRM rules initialized");
      loadData();
    } catch (err) {
      toast.error(
        mapCrmError(
          err instanceof Error ? err.message : "Failed to add default rules",
        ),
      );
    }
  };

  if (!roleLoading && !canManageAutomation) {
    return (
      <EmployerShell title="CRM Automation">
        <RoleGate allowed={false}>{null}</RoleGate>
      </EmployerShell>
    );
  }

  return (
    <EmployerShell
      title="CRM Automation"
      subtitle="Trigger automatic follow-ups and notifications to keep leads active."
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/employer/crm"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Leads
          </Link>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-4 py-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      ) : entitlement && !entitlement.enabled ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-foreground">
            CRM Automation Not Available
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Automated workflows, lead triggers, and scheduled follow-ups require
            an upgraded company hiring plan.
          </p>
          <Link
            to="/employer/credits"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark transition-colors"
          >
            <Zap className="h-4 w-4" /> Upgrade Plan
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Rules List header & Add Button */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Active Rules ({rules.length}/{entitlement?.rulesMax ?? 5})
              </h2>
              <p className="text-xs text-muted-foreground">
                Automations execute in the background via event triggers and cron
                schedules.
              </p>
            </div>
            <div className="flex gap-2">
              {rules.length === 0 && (
                <button
                  type="button"
                  onClick={handleApplyDefaults}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Initialize Default Rules
                </button>
              )}
              <button
                type="button"
                onClick={() => setCreating(!creating)}
                disabled={(rules.length >= (entitlement?.rulesMax ?? 5)) && !creating}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> {creating ? "Cancel" : "Add Rule"}
              </button>
            </div>
          </div>

          {/* Create Rule Form */}
          {creating && (
            <form
              onSubmit={handleCreateRule}
              className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm space-y-4"
            >
              <h3 className="text-sm font-bold text-foreground">
                New Automation Rule
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Rule Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="e.g. Prompt candidate after missed call"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    className="form-input h-10 w-full text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    When this happens (Trigger)
                  </label>
                  <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value as Rule["trigger"])}
                    className="form-input h-10 w-full text-sm"
                  >
                    <option value="application_uncontacted_h">
                      Uncontacted for 24 hours
                    </option>
                    <option value="call_no_answer">Call missed / no answer</option>
                    <option value="stage_stalled_h">Stage stalled 48 hours</option>
                    <option value="task_overdue_h">Task overdue</option>
                    <option value="unlock_unused_h">Unlocked contact unused</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Do this (Action)
                  </label>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value as Rule["action"])}
                    className="form-input h-10 w-full text-sm"
                  >
                    <option value="create_task">Create follow-up task</option>
                    <option value="notify">Send push / bell alert</option>
                    <option value="move_stage">Move stage</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
                >
                  Save Automation
                </button>
              </div>
            </form>
          )}

          {/* Rules List */}
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <Bot className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">
                  No automation rules yet
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click 'Initialize Default Rules' or create a custom one above.
                </p>
              </div>
            ) : (
              rules.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          r.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                      <h4 className="font-semibold text-sm text-foreground">
                        {r.name}
                      </h4>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">Trigger:</span>{" "}
                      {triggerLabel(r.trigger)}
                      <span className="text-border">|</span>
                      <span className="font-medium text-foreground/80">Action:</span>{" "}
                      {actionLabel(r.action)}
                      <span className="text-border">|</span>
                      <span>Cooldown: {r.cooldown_hours}h</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(r)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                      r.enabled
                        ? "border border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "border border-border bg-card text-muted-foreground hover:bg-surface"
                    }`}
                  >
                    <Power className="h-3 w-3" />
                    {r.enabled ? "Active" : "Paused"}
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Execution History */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
              <History className="h-4 w-4 text-primary" /> Execution Runs Log
            </h3>
            {runs.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No recent executions logged yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 px-3 font-semibold">Rule</th>
                      <th className="py-2 px-3 font-semibold">Result</th>
                      <th className="py-2 px-3 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.id}
                        className="border-b border-border/50 last:border-0 hover:bg-surface/50"
                      >
                        <td className="py-2 px-3 font-medium text-foreground">
                          {run.automation_rules?.name ?? run.trigger_key}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              run.result === "success" || run.result === "fired"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                : "bg-surface text-muted-foreground"
                            }`}
                          >
                            {run.result}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {formatDistanceToNow(new Date(run.fired_at), {
                            addSuffix: true,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </EmployerShell>
  );
}

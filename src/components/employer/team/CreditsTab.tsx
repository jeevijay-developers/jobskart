import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, Check, Download, HandCoins, Repeat, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ThemedListDropdown } from "@/components/ui/themed-form-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  BENEFIT_LABELS,
  BENEFIT_TYPES,
  mapTeamError,
  parseQuantity,
  subtreeIds,
  toCsv,
  type BenefitType,
} from "@/lib/team-permissions";
import {
  fetchAllocationOverview,
  fetchCreditRequests,
  fetchCreditSummary,
  fetchMovements,
  fetchTopupRules,
  type TopupRule,
  type AllocationRow,
  type CreditRequest,
  type CreditSummary,
} from "@/lib/team-data";
import type { TeamContext } from "./types";

type Action =
  | { kind: "give"; userId: string; name: string }
  | { kind: "take"; userId: string; name: string }
  | { kind: "request" };

export function CreditsTab({ ctx }: { ctx: TeamContext }) {
  const { companyId, userId, can, members } = ctx;
  const canPool = can("credits.allocate");
  const canDelegate = can("credits.delegate");
  const canReclaim = can("credits.reclaim");
  const canDecide = can("credits.approve_requests");

  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [benefit, setBenefit] = useState<BenefitType>("contact");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [rules, setRules] = useState<TopupRule[]>([]);
  const [threshold, setThreshold] = useState(String(ctx.settings?.low_credit_threshold ?? 3));
  const [ruleDraft, setRuleDraft] = useState<{
    userId: string;
    benefit: BenefitType;
    target: string;
    cadence: "weekly" | "monthly";
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, o, r, tr] = await Promise.all([
        fetchCreditSummary(companyId),
        fetchAllocationOverview(companyId),
        fetchCreditRequests(companyId),
        fetchTopupRules(companyId).catch(() => [] as TopupRule[]),
      ]);
      setSummary(s);
      setRows(o);
      setRequests(r);
      setRules(tr);
      setError(null);
    } catch (e) {
      setError(mapTeamError((e as Error)?.message));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(
    () => (userId ? subtreeIds(members, userId) : new Set<string>()),
    [members, userId],
  );
  const allocated = summary?.mode === "allocated";

  const byUser = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        role: string;
        reports_to: string | null;
        per: Partial<Record<BenefitType, AllocationRow>>;
      }
    >();
    for (const r of rows) {
      const entry = map.get(r.user_id) ?? {
        name: r.full_name || r.email || "Unnamed",
        role: r.role_name,
        reports_to: r.reports_to,
        per: {},
      };
      entry.per[r.benefit_type] = r;
      map.set(r.user_id, entry);
    }
    return [...map.entries()];
  }, [rows]);

  const switchMode = async () => {
    if (!summary) return;
    const next = allocated ? "pooled" : "allocated";
    const msg = allocated
      ? "Switch back to one shared pool? Everything reserved for individual members returns to the pool."
      : "Switch to per-member credits? Teammates without the 'spend from pool' permission can only use credits you allocate to them, so allocate before you switch or they'll be blocked.";
    if (!window.confirm(msg)) return;
    setModeBusy(true);
    try {
      const { error: e } = await supabase.rpc("set_credit_mode", {
        _company_id: companyId,
        _mode: next,
      });
      if (e) throw e;
      toast.success(
        next === "allocated"
          ? "Per-member credits enabled"
          : "Credits are shared in one pool again",
      );
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setModeBusy(false);
    }
  };

  const submit = async () => {
    if (!action) return;
    const n = parseQuantity(qty);
    if (!n) {
      toast.error("Enter a whole number greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const idem = crypto.randomUUID();
      if (action.kind === "give") {
        const fn = canPool ? "allocate_member_credits" : "delegate_member_credits";
        const { error: e } = await supabase.rpc(fn, {
          _company_id: companyId,
          _to_user: action.userId,
          _benefit: benefit,
          _qty: n,
          _idem: idem,
        });
        if (e) throw e;
        toast.success(`Gave ${n} ${BENEFIT_LABELS[benefit].toLowerCase()} to ${action.name}`);
      } else if (action.kind === "take") {
        const { error: e } = await supabase.rpc("reclaim_member_credits", {
          _company_id: companyId,
          _from_user: action.userId,
          _benefit: benefit,
          _qty: n,
          _idem: idem,
        });
        if (e) throw e;
        toast.success(
          `Took back ${n} ${BENEFIT_LABELS[benefit].toLowerCase()} from ${action.name}`,
        );
      } else {
        const { error: e } = await supabase.rpc("request_member_credits", {
          _company_id: companyId,
          _benefit: benefit,
          _qty: n,
          _reason: reason,
        });
        if (e) throw e;
        toast.success("Request sent");
      }
      setAction(null);
      setQty("");
      setReason("");
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r: CreditRequest, approve: boolean) => {
    let note: string | null = null;
    if (!approve) {
      note = window.prompt("Reason for denying (optional)") ?? null;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.rpc("decide_credit_request", {
        _request_id: r.id,
        _approve: approve,
        _note: note ?? undefined,
      });
      if (e) throw e;
      toast.success(approve ? "Request approved" : "Request denied");
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  const download = (name: string, csv: string) => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportBalances = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(
      `credit-balances-${stamp}.csv`,
      toCsv(
        ["Teammate", "Role", "Credit type", "Balance", "Used in last 30 days"],
        rows.map((r) => [
          r.full_name || r.email || "Unnamed",
          r.role_name,
          BENEFIT_LABELS[r.benefit_type],
          r.balance,
          r.spent_30d,
        ]),
      ),
    );
  };

  const exportMovements = async () => {
    try {
      const m = await fetchMovements(companyId, 90);
      const stamp = new Date().toISOString().slice(0, 10);
      download(
        `credit-movements-${stamp}.csv`,
        toCsv(
          ["When", "Event", "Credit type", "Quantity", "From", "To", "By"],
          m.map((x) => [
            x.created_at,
            x.event,
            BENEFIT_LABELS[x.benefit_type],
            x.qty,
            x.from_name,
            x.to_name,
            x.actor_name,
          ]),
        ),
      );
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    }
  };

  const saveThreshold = async () => {
    const n = Number(threshold);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      toast.error("Enter a whole number from 0 to 1000.");
      return;
    }
    const { error: e } = await supabase.rpc("set_low_credit_threshold", {
      _company_id: companyId,
      _threshold: n,
    });
    if (e) toast.error(mapTeamError(e.message));
    else toast.success("Low-balance alert saved");
  };

  const saveRule = async () => {
    if (!ruleDraft) return;
    const target = parseQuantity(ruleDraft.target);
    if (!ruleDraft.userId || !target) {
      toast.error("Pick a teammate and a whole-number target.");
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.rpc("set_topup_rule", {
        _company_id: companyId,
        _user_id: ruleDraft.userId,
        _benefit: ruleDraft.benefit,
        _target: target,
        _cadence: ruleDraft.cadence,
      });
      if (e) throw e;
      toast.success("Top-up rule saved");
      setRuleDraft(null);
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (id: string) => {
    const { error: e } = await supabase.rpc("delete_topup_rule", { _rule_id: id });
    if (e) toast.error(mapTeamError(e.message));
    else {
      toast.success("Rule removed");
      await load();
    }
  };

  const cancelRequest = async (r: CreditRequest) => {
    const { error: e } = await supabase.rpc("cancel_credit_request", { _request_id: r.id });
    if (e) toast.error(mapTeamError(e.message));
    else {
      toast.success("Request cancelled");
      await load();
    }
  };

  if (loading) return <p className="text-xs text-muted-foreground">Loading credits…</p>;
  if (error || !summary) {
    return (
      <p className="rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">
        {error ?? "Couldn't load credits."}
      </p>
    );
  }

  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending").slice(0, 8);
  const benefitOptions = BENEFIT_TYPES.map((b) => ({ value: b, label: BENEFIT_LABELS[b] }));

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">
              {allocated ? "Per-member credits" : "Shared credit pool"}
            </h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {allocated
                ? "Each teammate spends only the credits reserved for them. Managers can pass credits down to their own team; unused credits can be taken back any time."
                : "Everyone with the right permissions spends from one company balance. Switch on per-member credits to give each teammate their own budget."}
            </p>
          </div>
          {canPool && allocated && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <label htmlFor="low-threshold">Alert at</label>
              <input
                id="low-threshold"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                onBlur={saveThreshold}
                inputMode="numeric"
                className="form-input h-8 w-14 text-center text-xs"
              />
              <span>or fewer</span>
            </div>
          )}
          {canPool && (
            <button
              onClick={switchMode}
              disabled={modeBusy}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-surface disabled:opacity-60"
            >
              {allocated ? "Switch to shared pool" : "Switch to per-member credits"}
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {BENEFIT_TYPES.map((b) => {
            const s = summary.benefits[b];
            const personalView = allocated && !summary.can_view_all;
            const headline = personalView ? s.mine : allocated ? (s.pool ?? 0) : (s.wallet ?? 0);
            return (
              <div key={b} className="rounded-xl border border-border bg-surface p-3">
                <p className="text-xs font-semibold text-muted-foreground">{BENEFIT_LABELS[b]}</p>
                <p className="mt-1 text-2xl font-bold">{headline}</p>
                <p className="text-[11px] text-muted-foreground">
                  {personalView
                    ? "available to you"
                    : allocated
                      ? `in pool · ${s.reserved ?? 0} reserved · ${s.wallet ?? 0} total`
                      : "company balance"}
                </p>
                {allocated && !personalView && (
                  <p className="mt-1 text-xs font-medium text-primary">
                    {summary.can_pool_spend && s.mine === 0
                      ? "You spend from the pool"
                      : `You hold ${s.mine}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {allocated && (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Balances</h2>
              <div className="flex flex-wrap items-center gap-2">
                {byUser.length > 0 && (
                  <button
                    onClick={exportBalances}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface"
                  >
                    <Download className="h-4 w-4" /> Balances CSV
                  </button>
                )}
                {summary.can_view_all && (
                  <button
                    onClick={exportMovements}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface"
                  >
                    <Download className="h-4 w-4" /> Movements CSV
                  </button>
                )}
                <button
                  onClick={() => {
                    setBenefit("contact");
                    setAction({ kind: "request" });
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
                >
                  <HandCoins className="h-4 w-4" /> Request credits
                </button>
              </div>
            </div>
            {byUser.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing to show yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-surface text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Teammate</th>
                      {BENEFIT_TYPES.map((b) => (
                        <th key={b} className="px-3 py-2 font-semibold">
                          {BENEFIT_LABELS[b]}
                        </th>
                      ))}
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {byUser.map(([uid, u]) => {
                      const self = uid === userId;
                      const inTeam = mine.has(uid);
                      const canGive = !self && (canPool || (canDelegate && inTeam));
                      const canTake = !self && canReclaim && (canPool || inTeam);
                      return (
                        <tr key={uid} className="border-t border-border">
                          <td className="px-3 py-2">
                            <p className="font-medium">
                              {u.name}
                              {self && (
                                <span className="text-xs text-muted-foreground"> (you)</span>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{u.role}</p>
                          </td>
                          {BENEFIT_TYPES.map((b) => (
                            <td key={b} className="px-3 py-2">
                              <span className="font-semibold">{u.per[b]?.balance ?? 0}</span>
                              <span className="block text-[11px] text-muted-foreground">
                                used {u.per[b]?.spent_30d ?? 0} in 30d
                              </span>
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1.5">
                              {canGive && (
                                <button
                                  onClick={() => {
                                    setBenefit("contact");
                                    setAction({ kind: "give", userId: uid, name: u.name });
                                  }}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                                >
                                  <Send className="h-3.5 w-3.5" /> Give
                                </button>
                              )}
                              {canTake && (
                                <button
                                  onClick={() => {
                                    setBenefit("contact");
                                    setAction({ kind: "take", userId: uid, name: u.name });
                                  }}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                                >
                                  <ArrowDownToLine className="h-3.5 w-3.5" /> Take back
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {(canPool || rules.length > 0) && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Automatic top-ups</h2>
                {canPool && (
                  <button
                    onClick={() =>
                      setRuleDraft({
                        userId: "",
                        benefit: "contact",
                        target: "",
                        cadence: "monthly",
                      })
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface"
                  >
                    <Repeat className="h-4 w-4" /> Add rule
                  </button>
                )}
              </div>
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No rules. A rule tops a teammate back up to a target balance, weekly or monthly,
                  from the pool.
                </p>
              ) : (
                <div className="space-y-2">
                  {rules.map((r) => {
                    const who = members.find((m) => m.user_id === r.user_id);
                    return (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {who?.profiles?.full_name || who?.profiles?.email || "Teammate"}: keep{" "}
                            {r.target_balance} {BENEFIT_LABELS[r.benefit_type].toLowerCase()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.cadence} · next{" "}
                            {formatDistanceToNow(new Date(r.next_run_at), { addSuffix: true })}
                          </p>
                        </div>
                        {canPool && (
                          <button
                            onClick={() => deleteRule(r.id)}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Credit requests ({pending.length} pending)</h2>
            {pending.length === 0 && (
              <p className="text-xs text-muted-foreground">No pending requests.</p>
            )}
            <div className="space-y-2">
              {pending.map((r) => {
                const own = r.requester === userId;
                const routedToMe = r.routed_to === userId;
                return (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {own ? "You" : (r.profiles?.full_name ?? "A teammate")} asked for {r.qty}{" "}
                        {BENEFIT_LABELS[r.benefit_type].toLowerCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.reason ? `“${r.reason}” · ` : ""}
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {own ? (
                      <button
                        onClick={() => cancelRequest(r)}
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                      >
                        Cancel
                      </button>
                    ) : (
                      canDecide &&
                      (canPool || routedToMe) && (
                        <>
                          <button
                            onClick={() => decide(r, true)}
                            disabled={busy}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-success hover:bg-success-light disabled:opacity-60"
                          >
                            <Check className="h-3.5 w-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => decide(r, false)}
                            disabled={busy}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light disabled:opacity-60"
                          >
                            <X className="h-3.5 w-3.5" /> Deny
                          </button>
                        </>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            {history.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">Recent decisions</summary>
                <ul className="mt-2 space-y-1">
                  {history.map((r) => (
                    <li key={r.id}>
                      {r.profiles?.full_name ?? "Teammate"} · {r.qty}{" "}
                      {BENEFIT_LABELS[r.benefit_type].toLowerCase()} · {r.status}
                      {r.decision_note ? ` (${r.decision_note})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </>
      )}

      <Dialog open={!!ruleDraft} onOpenChange={(o) => !o && setRuleDraft(null)}>
        <DialogContent className="sm:max-w-md">
          {ruleDraft && (
            <>
              <DialogHeader>
                <DialogTitle>Automatic top-up</DialogTitle>
                <DialogDescription>
                  On schedule, we raise this teammate's balance to the target using whatever the
                  company pool has available.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <ThemedListDropdown
                  label="Teammate"
                  value={ruleDraft.userId}
                  onChange={(v) => setRuleDraft({ ...ruleDraft, userId: v })}
                  options={[
                    { value: "", label: "Choose a teammate" },
                    ...members.map((m) => ({
                      value: m.user_id,
                      label: m.profiles?.full_name || m.profiles?.email || "Unnamed",
                    })),
                  ]}
                />
                <ThemedListDropdown
                  label="Credit type"
                  value={ruleDraft.benefit}
                  onChange={(v) => setRuleDraft({ ...ruleDraft, benefit: v as BenefitType })}
                  options={BENEFIT_TYPES.map((b) => ({ value: b, label: BENEFIT_LABELS[b] }))}
                />
                <label className="block text-sm font-medium">
                  Keep at
                  <input
                    value={ruleDraft.target}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, target: e.target.value })}
                    inputMode="numeric"
                    className="form-input mt-1"
                    placeholder="e.g. 20"
                  />
                </label>
                <ThemedListDropdown
                  label="Repeat"
                  value={ruleDraft.cadence}
                  onChange={(v) =>
                    setRuleDraft({ ...ruleDraft, cadence: v as "weekly" | "monthly" })
                  }
                  options={[
                    { value: "weekly", label: "Every week" },
                    { value: "monthly", label: "Every month" },
                  ]}
                />
              </div>
              <DialogFooter>
                <button
                  onClick={() => setRuleDraft(null)}
                  className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={saveRule}
                  disabled={busy}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                >
                  Save rule
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          {action && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {action.kind === "give"
                    ? `Give credits to ${action.name}`
                    : action.kind === "take"
                      ? `Take back from ${action.name}`
                      : "Request credits"}
                </DialogTitle>
                <DialogDescription>
                  {action.kind === "give"
                    ? canPool
                      ? "Credits come out of the company pool."
                      : "Credits come out of your own balance."
                    : action.kind === "take"
                      ? canPool
                        ? "Credits go back to the company pool."
                        : "Credits come back to your own balance."
                      : "Your manager (or an admin) will see this and can approve it."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="block text-sm font-medium">
                  Credit type
                  <ThemedListDropdown
                    label="Credit type"
                    value={benefit}
                    onChange={(v) => setBenefit(v as BenefitType)}
                    options={benefitOptions}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Quantity
                  <input
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    inputMode="numeric"
                    className="form-input mt-1"
                    placeholder="e.g. 10"
                  />
                </label>
                {action.kind === "request" && (
                  <label className="block text-sm font-medium">
                    Why do you need them?{" "}
                    <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="form-input mt-1 resize-none"
                    />
                  </label>
                )}
              </div>
              <DialogFooter>
                <button
                  onClick={() => setAction(null)}
                  className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                >
                  {busy
                    ? "Working…"
                    : action.kind === "request"
                      ? "Send request"
                      : action.kind === "give"
                        ? "Give"
                        : "Take back"}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

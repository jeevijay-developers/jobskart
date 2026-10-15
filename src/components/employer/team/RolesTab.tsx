import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Copy, Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mapTeamError, missingForGrant, permissionDiff } from "@/lib/team-permissions";
import type { RoleRow } from "@/lib/team-data";
import { PermissionMatrix } from "./PermissionMatrix";
import type { TeamContext } from "./types";

const SCOPE_LABELS: Record<RoleRow["scope"], { label: string; hint: string }> = {
  own: { label: "Own jobs", hint: "Works on jobs they posted or that are shared with them" },
  team: { label: "Team's jobs", hint: "Also sees jobs posted by people who report to them" },
  all: { label: "All jobs", hint: "Sees every job in the company" },
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  scope: RoleRow["scope"];
  perms: Set<string>;
};

export function RolesTab({ ctx }: { ctx: TeamContext }) {
  const { roles, members, invites, catalog, can, isOwner, customRolesEnabled, companyId, reload } =
    ctx;
  const canManage = can("roles.manage");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const accessMode = ctx.settings?.access_mode ?? "open";

  const changeAccessMode = async (next: "open" | "scoped") => {
    if (next === accessMode) return;
    const msg =
      next === "scoped"
        ? "Turn on role-based job visibility? Each role then only sees the applicants of the jobs its visibility setting allows (own, team or all). Share a job to give someone access."
        : "Switch back to open visibility? Everyone with applicant access will see every job's applicants again.";
    if (!window.confirm(msg)) return;
    setModeBusy(true);
    try {
      const { error } = await supabase.rpc("set_access_mode", {
        _company_id: companyId,
        _mode: next,
      });
      if (error) throw error;
      toast.success(
        next === "scoped"
          ? "Role-based job visibility is on"
          : "Job visibility is open to everyone again",
      );
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setModeBusy(false);
    }
  };

  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) if (m.role_id) map.set(m.role_id, (map.get(m.role_id) ?? 0) + 1);
    for (const i of invites) if (i.role_id) map.set(i.role_id, (map.get(i.role_id) ?? 0) + 1);
    return map;
  }, [members, invites]);

  const openNew = (from?: RoleRow) => {
    setOriginal([]);
    setDraft({
      id: null,
      name: from ? `${from.name} copy` : "",
      description: from?.description ?? "",
      scope: from?.scope ?? "own",
      perms: new Set(
        from
          ? from.permissions.filter((p) => isOwner || ctx.permissions.includes(p))
          : ["jobs.view"],
      ),
    });
  };

  const openEdit = (r: RoleRow) => {
    setOriginal(r.permissions);
    setDraft({
      id: r.id,
      name: r.name,
      description: r.description,
      scope: r.scope,
      perms: new Set(r.permissions),
    });
  };

  const save = async () => {
    if (!draft) return;
    if (draft.name.trim().length < 2) {
      toast.error("Give the role a name (at least 2 characters).");
      return;
    }
    setSaving(true);
    try {
      const perms = [...draft.perms];
      if (draft.id) {
        const { error } = await supabase.rpc("update_company_role", {
          _company_id: companyId,
          _role_id: draft.id,
          _name: draft.name,
          _description: draft.description,
          _permissions: perms,
          _scope: draft.scope,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("create_company_role", {
          _company_id: companyId,
          _name: draft.name,
          _description: draft.description,
          _permissions: perms,
          _scope: draft.scope,
        });
        if (error) throw error;
      }
      toast.success(draft.id ? "Role updated" : "Role created");
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: RoleRow) => {
    if (!window.confirm(`Delete the role "${r.name}"? This can't be undone.`)) return;
    setBusyId(r.id);
    try {
      const { error } = await supabase.rpc("delete_company_role", {
        _company_id: companyId,
        _role_id: r.id,
      });
      if (error) throw error;
      toast.success("Role deleted");
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusyId(null);
    }
  };

  const system = roles.filter((r) => r.is_system);
  const custom = roles.filter((r) => !r.is_system);
  const diff = draft?.id ? permissionDiff(original, [...draft.perms]) : null;
  const blocked = draft ? missingForGrant(ctx.permissions, [...draft.perms], isOwner) : [];

  return (
    <div className="space-y-6">
      {!customRolesEnabled && (
        <div className="rounded-xl border border-primary/30 bg-primary-light/30 p-4">
          <p className="text-sm font-semibold text-primary">Custom roles are a paid-plan feature</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Build roles with exactly the permissions your team needs, and tailor access per
            teammate. The standard roles below stay available on every plan.
          </p>
          <Link
            to="/employer/credits"
            className="mt-3 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            See plans
          </Link>
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Job visibility</h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {accessMode === "scoped"
                ? "Each role sees only the applicants of jobs its visibility allows: its own, its team's, or all. Use Share on a job to give someone access."
                : "Everyone with applicant access sees every job's applicants. Turn on role-based visibility to limit people to their own or their team's jobs."}
            </p>
          </div>
          {canManage && (
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-semibold">
              {(["open", "scoped"] as const).map((m) => (
                <button
                  key={m}
                  disabled={modeBusy}
                  onClick={() => changeAccessMode(m)}
                  className={`rounded-md px-3 py-1.5 ${
                    accessMode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "open" ? "Open" : "By role"}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Standard roles</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {system.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              count={usage.get(r.id) ?? 0}
              actions={
                <>
                  <button
                    onClick={() => openEdit(r)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                  >
                    View
                  </button>
                  {canManage && customRolesEnabled && !r.is_locked && (
                    <button
                      onClick={() => openNew(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                      title="Start a custom role from this one"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicate
                    </button>
                  )}
                </>
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Custom roles ({custom.length})</h2>
          {canManage && customRolesEnabled && (
            <button
              onClick={() => openNew()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" /> New role
            </button>
          )}
        </div>
        {custom.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {customRolesEnabled ? "No custom roles yet." : "Upgrade to create custom roles."}
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {custom.map((r) => (
              <RoleCard
                key={r.id}
                role={r}
                count={usage.get(r.id) ?? 0}
                actions={
                  <>
                    <button
                      onClick={() => openEdit(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {canManage ? "Edit" : "View"}
                    </button>
                    {canManage && (
                      <button
                        onClick={() => remove(r)}
                        disabled={busyId === r.id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {draft.id
                    ? roles.find((r) => r.id === draft.id)?.is_system
                      ? "Role permissions"
                      : "Edit role"
                    : "New custom role"}
                </DialogTitle>
                <DialogDescription>
                  Pick what this role can do. You can only grant permissions you hold yourself.
                </DialogDescription>
              </DialogHeader>

              {(() => {
                const editing = draft.id ? roles.find((r) => r.id === draft.id) : null;
                const readOnly =
                  !canManage || !customRolesEnabled || (!!editing && editing.is_system);
                return (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium">
                        Name
                        <input
                          value={draft.name}
                          disabled={readOnly}
                          maxLength={60}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          className="form-input mt-1"
                          placeholder="e.g. Night shift lead"
                        />
                      </label>
                      <label className="block text-sm font-medium">
                        Description
                        <input
                          value={draft.description}
                          disabled={readOnly}
                          maxLength={160}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          className="form-input mt-1"
                          placeholder="What is this role for?"
                        />
                      </label>
                    </div>

                    <div>
                      <p className="text-sm font-medium">Job visibility</p>
                      <div className="mt-1 grid gap-2 sm:grid-cols-3">
                        {(Object.keys(SCOPE_LABELS) as RoleRow["scope"][]).map((s) => (
                          <label
                            key={s}
                            className={`rounded-lg border p-2 text-xs ${
                              draft.scope === s
                                ? "border-primary bg-primary-light/30"
                                : "border-border bg-card"
                            } ${readOnly ? "opacity-70" : "cursor-pointer"}`}
                          >
                            <input
                              type="radio"
                              name="scope"
                              className="mr-1.5 accent-[var(--primary)]"
                              checked={draft.scope === s}
                              disabled={readOnly}
                              onChange={() => setDraft({ ...draft, scope: s })}
                            />
                            <span className="font-semibold">{SCOPE_LABELS[s].label}</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {SCOPE_LABELS[s].hint}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <PermissionMatrix
                      defs={catalog}
                      selected={draft.perms}
                      readOnly={readOnly}
                      isDisabled={(k) =>
                        !isOwner && !ctx.permissions.includes(k) && !original.includes(k)
                      }
                      onToggle={(k, on) => {
                        const next = new Set(draft.perms);
                        if (on) next.add(k);
                        else next.delete(k);
                        setDraft({ ...draft, perms: next });
                      }}
                    />

                    {diff && (diff.added.length > 0 || diff.removed.length > 0) && !readOnly && (
                      <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
                        {diff.added.length > 0 && <span>Adds {diff.added.length}. </span>}
                        {diff.removed.length > 0 && <span>Removes {diff.removed.length}. </span>}
                        Changes apply to everyone with this role immediately.
                      </p>
                    )}
                    {blocked.length > 0 && !readOnly && (
                      <p className="rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">
                        You hold {blocked.length} fewer permission(s) than selected, so this can't
                        be saved.
                      </p>
                    )}

                    <DialogFooter>
                      <button
                        onClick={() => setDraft(null)}
                        className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface"
                      >
                        {readOnly ? "Close" : "Cancel"}
                      </button>
                      {!readOnly && (
                        <button
                          onClick={save}
                          disabled={saving || blocked.length > 0}
                          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                        >
                          {saving ? "Saving…" : draft.id ? "Save changes" : "Create role"}
                        </button>
                      )}
                    </DialogFooter>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleCard({ role, count, actions }: { role: RoleRow; count: number; actions: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {role.name}
            {role.is_locked && (
              <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked role" />
            )}
          </p>
          <p className="text-xs text-muted-foreground">{role.description || "Custom role"}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted-foreground">
          <Users className="h-3 w-3" /> {count}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {role.permissions.length} permissions · {SCOPE_LABELS[role.scope].label}
      </p>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  Copy,
  Mail,
  MessageCircle,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Field } from "@/components/candidate/primitives";
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
import { emailSchema } from "@/lib/validators";
import { mapTeamError, whatsappShareUrl } from "@/lib/team-permissions";
import type { TeamInvite, TeamMember } from "@/lib/team-data";
import { PermissionMatrix } from "./PermissionMatrix";
import { nameOf, type TeamContext } from "./types";

function inviteUrl(token: string) {
  return typeof window === "undefined" ? "" : `${window.location.origin}/invite/${token}`;
}

// navigator.clipboard only exists in secure contexts; this app is also served over plain http on LAN IPs in testing.
function copyWithFallback(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied to clipboard");
      return;
    }
  } catch {
    /* fall through */
  }
  if (copyWithFallback(text)) toast.success("Link copied to clipboard");
  else toast.error("Couldn't copy — copy it manually");
}

// supabase.functions.invoke() rejects a non-2xx response as a FunctionsHttpError whose
// .context is the raw Response — read the body back so the admin sees *why* the email failed.
async function describeInviteSendError(err: unknown): Promise<string> {
  const context = (err as { context?: Response })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      /* not JSON */
    }
  }
  return (err as Error)?.message ?? "Unknown error";
}

function roleBadgeClass(locked: boolean | undefined, key: string | undefined) {
  if (locked) return "bg-primary-light text-primary";
  if (key === "hr_admin" || key === "manager") return "bg-warning-light text-warning";
  return "bg-surface text-muted-foreground";
}

export function MembersTab({ ctx }: { ctx: TeamContext }) {
  const { members, revoked, invites, roles, companyId, userId, can, isOwner, reload } = ctx;
  const canInvite = can("team.invite");
  const canRoles = can("team.manage_roles");
  const canRemove = can("team.remove");

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [lastInvite, setLastInvite] = useState<{ email: string; token: string } | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [custom, setCustom] = useState<{
    member: TeamMember;
    extra: Set<string>;
    revoked: Set<string>;
  } | null>(null);
  const [savingCustom, setSavingCustom] = useState(false);
  const [leaving, setLeaving] = useState<{
    member: TeamMember;
    jobs: number;
    target: string;
  } | null>(null);
  const companyName = ctx.settings?.name ?? "our company";

  // Roles the current user may hand out: no owner role unless owner; custom roles only on paid plans.
  const assignable = useMemo(
    () =>
      roles.filter((r) => {
        if (r.is_locked && !isOwner) return false;
        if (!r.is_system && !ctx.customRolesEnabled) return false;
        return isOwner || r.permissions.every((p) => ctx.permissions.includes(p));
      }),
    [roles, isOwner, ctx.customRolesEnabled, ctx.permissions],
  );
  const roleOptions = assignable.map((r) => ({
    value: r.id,
    label: r.is_system ? r.name : `${r.name} (custom)`,
  }));
  const defaultRoleId =
    assignable.find((r) => r.key === "recruiter")?.id ?? assignable[0]?.id ?? "";
  const effectiveRoleId = roleId || defaultRoleId;

  const run = async (
    userKey: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    ok: string,
  ) => {
    setBusyUserId(userKey);
    try {
      const { error } = await fn();
      if (error) throw error;
      toast.success(ok);
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusyUserId(null);
    }
  };

  const changeRole = (m: TeamMember, newRoleId: string) =>
    run(
      m.user_id,
      () =>
        supabase.rpc("set_member_role", {
          _company_id: companyId,
          _user_id: m.user_id,
          _role_id: newRoleId,
        }),
      "Role updated",
    );

  const changeManager = (m: TeamMember, managerId: string) =>
    run(
      m.user_id,
      () =>
        supabase.rpc("set_member_manager", {
          _company_id: companyId,
          _user_id: m.user_id,
          _manager_id: (managerId || null) as unknown as string,
        }),
      "Reporting line updated",
    );

  const doRevoke = (m: TeamMember) =>
    run(
      m.user_id,
      () => supabase.rpc("remove_member", { _company_id: companyId, _user_id: m.user_id }),
      "Access revoked",
    );

  // Offer to hand over the leaver's jobs first; their credits move back to their manager or the pool automatically.
  const revokeMember = async (m: TeamMember) => {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("posted_by", m.user_id);
    if (count && count > 0) {
      const owner = members.find((x) => x.company_roles?.is_locked && x.user_id !== m.user_id);
      const fallback = members.find((x) => x.user_id !== m.user_id);
      setLeaving({
        member: m,
        jobs: count,
        target: m.reports_to ?? owner?.user_id ?? fallback?.user_id ?? "",
      });
      return;
    }
    if (
      !window.confirm(
        `Revoke ${nameOf(m)}'s access? Their credits move back to their manager or the pool.`,
      )
    )
      return;
    await doRevoke(m);
  };

  const reassignAndRevoke = async (reassign: boolean) => {
    if (!leaving) return;
    const { member, target } = leaving;
    setBusyUserId(member.user_id);
    try {
      if (reassign) {
        const { error } = await supabase.rpc("reassign_member_jobs", {
          _company_id: companyId,
          _from_user: member.user_id,
          _to_user: target,
        });
        if (error) throw error;
      }
      const { error: rErr } = await supabase.rpc("remove_member", {
        _company_id: companyId,
        _user_id: member.user_id,
      });
      if (rErr) throw rErr;
      toast.success(reassign ? "Jobs reassigned and access revoked" : "Access revoked");
      setLeaving(null);
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusyUserId(null);
    }
  };

  const restoreMember = (m: TeamMember) =>
    run(
      m.user_id,
      () =>
        supabase.rpc("reactivate_member", {
          _company_id: companyId,
          _user_id: m.user_id,
          _role: m.role === "super_admin" && !isOwner ? "recruiter" : m.role,
        }),
      "Access restored",
    );

  const saveCustom = async () => {
    if (!custom) return;
    setSavingCustom(true);
    try {
      const { error } = await supabase.rpc("set_member_permissions", {
        _company_id: companyId,
        _user_id: custom.member.user_id,
        _extra: [...custom.extra],
        _revoked: [...custom.revoked],
      });
      if (error) throw error;
      toast.success("Permissions updated");
      setCustom(null);
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setSavingCustom(false);
    }
  };

  const sendInvite = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Enter a valid email address");
      return;
    }
    if (!effectiveRoleId) {
      toast.error("Choose a role for the invite.");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("create_employer_invite", {
        _company_id: companyId,
        _email: parsed.data,
        _role_id: effectiveRoleId,
      });
      if (error) throw error;
      const created = data as unknown as { id: string; token: string };
      setLastInvite({ email: parsed.data, token: created.token });
      setEmail("");
      setRoleId("");
      await reload();
      toast.success("Invite created!");
      // Fire-and-forget: a failed email must never block invite creation (the copyable link is the fallback).
      supabase.functions
        .invoke("send-employer-invite", { body: { inviteId: created.id } })
        .then(async ({ error: sendErr }) => {
          if (sendErr) {
            const reason = await describeInviteSendError(sendErr);
            toast.error(
              `Invite created, but the email couldn't be sent (${reason}). Share the copy link instead.`,
            );
          }
        });
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setSending(false);
    }
  };

  const cancelInvite = async (inv: TeamInvite) => {
    setBusyInviteId(inv.id);
    try {
      const { error } = await supabase.rpc("cancel_employer_invite", {
        _company_id: companyId,
        _invite_id: inv.id,
      });
      if (error) throw error;
      if (lastInvite?.token === inv.token) setLastInvite(null);
      toast.success(`Invite for ${inv.email} cancelled`);
      await reload();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusyInviteId(null);
    }
  };

  const resendInvite = async (inv: TeamInvite) => {
    setBusyInviteId(inv.id);
    try {
      const { data, error } = await supabase.rpc("resend_employer_invite", {
        _company_id: companyId,
        _invite_id: inv.id,
      });
      if (error) throw error;
      const refreshed = data as unknown as { id: string; token: string; email: string };
      setLastInvite({ email: refreshed.email, token: refreshed.token });
      toast.success(`Invite for ${inv.email} refreshed`);
      await reload();
      supabase.functions
        .invoke("send-employer-invite", { body: { inviteId: refreshed.id } })
        .then(async ({ error: sendErr }) => {
          if (sendErr) {
            const reason = await describeInviteSendError(sendErr);
            toast.error(
              `Invite refreshed, but the email couldn't be sent (${reason}). Share the copy link instead.`,
            );
          }
        });
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusyInviteId(null);
    }
  };

  const nameById = new Map(members.map((m) => [m.user_id, nameOf(m)]));
  const managerOptions = (m: TeamMember) => [
    { value: "", label: "No manager" },
    ...members
      .filter((x) => x.user_id !== m.user_id)
      .map((x) => ({ value: x.user_id, label: nameOf(x) })),
  ];

  const seats = ctx.seats;
  const seatLabel = seats
    ? seats.max < 0
      ? `${seats.used} seat${seats.used === 1 ? "" : "s"} used · unlimited on your plan`
      : `${seats.used + seats.pending} of ${seats.max} seats used (${seats.used} active${seats.pending ? `, ${seats.pending} invited` : ""})`
    : null;
  const seatsFull = !!seats && seats.max >= 0 && seats.used + seats.pending >= seats.max;

  return (
    <div className="space-y-6">
      {seatLabel && (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            seatsFull ? "bg-warning-light text-warning" : "bg-surface text-muted-foreground"
          }`}
        >
          {seatLabel}
          {seatsFull && " — remove someone or upgrade your plan to invite more people."}
        </p>
      )}

      {lastInvite && (
        <div className="rounded-xl border border-primary/30 bg-primary-light/30 p-4">
          <p className="text-sm font-semibold text-primary">Invitation created!</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Share this link with {lastInvite.email}:
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl(lastInvite.token)}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground"
            />
            <button
              onClick={() => copyToClipboard(inviteUrl(lastInvite.token))}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <a
              href={whatsappShareUrl(companyName, inviteUrl(lastInvite.token))}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          </div>
        </div>
      )}

      <section className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {showRevoked
            ? `Revoked members (${revoked.length})`
            : `Active members (${members.length})`}
        </h2>
        <button
          onClick={() => setShowRevoked(!showRevoked)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            showRevoked ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
          }`}
        >
          <UserPlus className="h-3 w-3" />
          <span>Show revoked</span>
        </button>
      </section>

      {!showRevoked ? (
        <div className="space-y-2">
          {members.length === 0 && (
            <p className="text-xs text-muted-foreground">No active members.</p>
          )}
          {members.map((m) => {
            const isSelf = m.user_id === userId;
            const locked = !!m.company_roles?.is_locked;
            const rolesForRow = roleOptions.some((o) => o.value === m.role_id)
              ? roleOptions
              : [
                  ...roleOptions,
                  { value: m.role_id ?? "", label: m.company_roles?.name ?? m.role },
                ];
            const customised = m.extra_permissions.length > 0 || m.revoked_permissions.length > 0;
            return (
              <div
                key={m.user_id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {nameOf(m).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {nameOf(m)}{" "}
                    {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(locked, m.company_roles?.key)}`}
                    >
                      {m.company_roles?.name ?? m.role}
                    </span>
                    {customised && (
                      <span className="rounded-full bg-warning-light px-2 py-0.5 text-[11px] text-warning">
                        Customised
                      </span>
                    )}
                    {m.reports_to && (
                      <span className="text-[11px] text-muted-foreground">
                        Reports to {nameById.get(m.reports_to) ?? "—"}
                      </span>
                    )}
                  </div>
                </div>
                {canRoles && !isSelf && (
                  <>
                    <ThemedListDropdown
                      label="Role"
                      value={m.role_id ?? ""}
                      onChange={(v) => v && v !== m.role_id && changeRole(m, v)}
                      disabled={busyUserId === m.user_id || (locked && !isOwner)}
                      className="h-8 w-40 text-xs"
                      selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
                      options={rolesForRow}
                    />
                    <ThemedListDropdown
                      label="Reports to"
                      value={m.reports_to ?? ""}
                      onChange={(v) => v !== (m.reports_to ?? "") && changeManager(m, v)}
                      disabled={busyUserId === m.user_id}
                      className="h-8 w-40 text-xs"
                      selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
                      options={managerOptions(m)}
                    />
                    {!locked && (
                      <button
                        onClick={() =>
                          ctx.customRolesEnabled
                            ? setCustom({
                                member: m,
                                extra: new Set(m.extra_permissions),
                                revoked: new Set(m.revoked_permissions),
                              })
                            : toast.error(mapTeamError("plan_requires_upgrade"))
                        }
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                        title="Customise this person's permissions"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Customise</span>
                      </button>
                    )}
                  </>
                )}
                {canRemove && !isSelf && (
                  <button
                    onClick={() => revokeMember(m)}
                    disabled={busyUserId === m.user_id}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light disabled:opacity-60"
                    title="Revoke access"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Revoke</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {revoked.length === 0 && (
            <p className="text-xs text-muted-foreground">No revoked members.</p>
          )}
          {revoked.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{nameOf(m)}</p>
                <p className="text-xs text-muted-foreground">
                  Revoked{" "}
                  {formatDistanceToNow(new Date(m.revoked_at ?? Date.now()), { addSuffix: true })}
                </p>
              </div>
              {canRemove && (
                <button
                  onClick={() => restoreMember(m)}
                  disabled={busyUserId === m.user_id}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-success hover:bg-success-light disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Restore</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {invites.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Pending invites ({invites.length})</h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{inv.email}</p>
                  <span className="inline-flex items-center rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {inv.company_roles?.name ?? "Role"}
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(inviteUrl(inv.token))}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Copy link</span>
                </button>
                <a
                  href={whatsappShareUrl(companyName, inviteUrl(inv.token))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                  title="Share on WhatsApp"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">WhatsApp</span>
                </a>
                {canInvite && (
                  <>
                    <button
                      onClick={() => resendInvite(inv)}
                      disabled={busyInviteId === inv.id}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface disabled:opacity-60"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Resend</span>
                    </button>
                    <button
                      onClick={() => cancelInvite(inv)}
                      disabled={busyInviteId === inv.id}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Cancel</span>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <UserPlus className="h-4 w-4" /> Invite teammate
        </h2>
        {!canInvite && (
          <p className="mt-3 rounded-lg bg-warning-light px-3 py-2 text-xs text-warning">
            Your role can't create invitations. Ask an Owner or HR Admin.
          </p>
        )}
        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-start gap-2">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Data ownership:</strong> All candidate unlocks and
              hiring activity belong to your company — not to individual recruiters. Revoking a
              recruiter's access preserves all data for your team.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Email" required>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface px-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input rounded-l-none"
                placeholder="teammate@company.com"
                disabled={!canInvite}
              />
            </div>
          </Field>
          <Field label="Role" required>
            <ThemedListDropdown
              label="Role"
              value={effectiveRoleId}
              onChange={setRoleId}
              disabled={!canInvite}
              selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
              options={roleOptions}
            />
          </Field>
          <button
            onClick={sendInvite}
            disabled={sending || !canInvite || !effectiveRoleId}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" /> Create invite
          </button>
          <p className="text-xs text-muted-foreground">
            We'll email them an invite link. They'll join after verifying their mobile number — you
            can also copy the link and share it yourself.
          </p>
        </div>
      </section>

      <Dialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(null)}>
        <DialogContent className="sm:max-w-md">
          {leaving && (
            <>
              <DialogHeader>
                <DialogTitle>Revoke {nameOf(leaving.member)}?</DialogTitle>
                <DialogDescription>
                  They posted {leaving.jobs} job{leaving.jobs === 1 ? "" : "s"}. Hand them to a
                  teammate so someone keeps owning the applicants. Their credits go back to their
                  manager or the pool.
                </DialogDescription>
              </DialogHeader>
              <ThemedListDropdown
                label="Reassign jobs to"
                value={leaving.target}
                onChange={(v) => setLeaving({ ...leaving, target: v })}
                options={members
                  .filter((x) => x.user_id !== leaving.member.user_id)
                  .map((x) => ({ value: x.user_id, label: nameOf(x) }))}
              />
              <DialogFooter>
                <button
                  onClick={() => setLeaving(null)}
                  className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={() => reassignAndRevoke(false)}
                  disabled={busyUserId === leaving.member.user_id}
                  className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface disabled:opacity-60"
                >
                  Revoke only
                </button>
                <button
                  onClick={() => reassignAndRevoke(true)}
                  disabled={busyUserId === leaving.member.user_id || !leaving.target}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                >
                  Reassign and revoke
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!custom} onOpenChange={(o) => !o && setCustom(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {custom && (
            <>
              <DialogHeader>
                <DialogTitle>Customise {nameOf(custom.member)}</DialogTitle>
                <DialogDescription>
                  Start from their role ({custom.member.company_roles?.name}). Tick extras to add,
                  or untick role permissions to take them away for this person only.
                </DialogDescription>
              </DialogHeader>
              {(() => {
                const base = new Set(
                  roles.find((r) => r.id === custom.member.role_id)?.permissions ?? [],
                );
                const effective = new Set(
                  [...base, ...custom.extra].filter((p) => !custom.revoked.has(p)),
                );
                return (
                  <PermissionMatrix
                    defs={ctx.catalog}
                    selected={effective}
                    isDisabled={(k) => !isOwner && !ctx.permissions.includes(k)}
                    onToggle={(k, on) => {
                      const extra = new Set(custom.extra);
                      const rev = new Set(custom.revoked);
                      if (on) {
                        rev.delete(k);
                        if (!base.has(k)) extra.add(k);
                      } else {
                        extra.delete(k);
                        if (base.has(k)) rev.add(k);
                      }
                      setCustom({ ...custom, extra, revoked: rev });
                    }}
                  />
                );
              })()}
              <DialogFooter>
                <button
                  onClick={() => setCustom({ ...custom, extra: new Set(), revoked: new Set() })}
                  className="h-9 rounded-lg border border-border bg-card px-4 text-sm hover:bg-surface"
                >
                  Reset to role
                </button>
                <button
                  onClick={saveCustom}
                  disabled={savingCustom}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                >
                  {savingCustom ? "Saving…" : "Save"}
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

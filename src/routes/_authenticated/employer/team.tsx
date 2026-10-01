import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Copy,
  Mail,
  RefreshCw,
  Trash2,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { RoleGate } from "@/components/employer/RoleGate";
import { Field } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { useEmployerRole } from "@/hooks/use-employer-role";
import type { EmployerRole } from "@/lib/employer";
import { emailSchema } from "@/lib/validators";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/team")({
  head: () => ({ meta: [{ title: "Team · JobsKart" }] }),
  component: TeamPage,
});

type Member = {
  user_id: string;
  role: EmployerRole;
  status: string;
  revoked_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};

type Invite = {
  id: string;
  email: string;
  role: EmployerRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

const ROLE_LABELS: Record<EmployerRole, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  recruiter: "Recruiter",
};

function roleBadgeClass(role: string) {
  switch (role) {
    case "super_admin":
      return "bg-primary-light text-primary";
    case "hr_admin":
      return "bg-warning-light text-warning";
    default:
      return "bg-surface text-muted-foreground";
  }
}

function inviteUrl(token: string) {
  return typeof window === "undefined" ? "" : `${window.location.origin}/invite/${token}`;
}

// navigator.clipboard is only available in secure contexts (https:// or
// localhost) — this app is also served over plain http:// on LAN IPs during
// testing, where it's undefined/throws. Fall back to the legacy
// execCommand('copy') path, which works regardless of secure-context.
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

// supabase.functions.invoke() rejects a non-2xx response as a FunctionsHttpError
// whose .context is the raw Response — our function's body ({ok:false,error})
// is only reachable by reading it back out, otherwise all the admin sees is a
// generic "non-2xx status code" with no indication of *why* the email failed
// (e.g. the sending domain isn't verified with Resend, or isn't allowed to
// mail this recipient yet).
async function describeInviteSendError(err: unknown): Promise<string> {
  const context = (err as { context?: Response })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      /* body wasn't JSON — fall through to the generic message */
    }
  }
  return (err as Error)?.message ?? "Unknown error";
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied to clipboard");
      return;
    }
  } catch {
    // Fall through to the legacy fallback below.
  }
  if (copyWithFallback(text)) {
    toast.success("Link copied to clipboard");
  } else {
    toast.error("Couldn't copy — copy it manually");
  }
}

function TeamPage() {
  const {
    loading: roleLoading,
    userId,
    companyId: cid,
    accessMessage: roleAccessMessage,
    isSuperAdmin,
    canInviteMembers: canInvite,
    canManageTeamMembers: canManage,
    refresh,
  } = useEmployerRole();
  const [members, setMembers] = useState<Member[]>([]);
  const [revokedMembers, setRevokedMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EmployerRole>("recruiter");
  const [sending, setSending] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [lastInvite, setLastInvite] = useState<{ email: string; token: string } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const loadTeamData = async (companyId: string) => {
    setMembersLoading(true);
    const [mRes, iRes, rRes] = await Promise.all([
      supabase
        .from("employer_members")
        .select(
          "user_id, role, status, revoked_at, profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)",
        )
        .eq("company_id", companyId)
        .eq("status", "active"),
      supabase
        .from("employer_invites")
        .select("id, email, role, token, expires_at, accepted_at, created_at")
        .eq("company_id", companyId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("employer_members")
        .select(
          "user_id, role, status, revoked_at, profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)",
        )
        .eq("company_id", companyId)
        .eq("status", "revoked"),
    ]);

    if (mRes.error || iRes.error || rRes.error) {
      setDataError(
        mRes.error?.message || iRes.error?.message || rRes.error?.message || "Couldn't load team details.",
      );
    } else {
      setDataError(null);
      setMembers((mRes.data || []) as unknown as Member[]);
      setRevokedMembers((rRes.data || []) as unknown as Member[]);
      setInvites((iRes.data || []) as Invite[]);
    }
    setMembersLoading(false);
  };

  // Fetch team data whenever the active company becomes known / changes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (!roleLoading && cid && loadedFor !== cid) {
    setLoadedFor(cid);
    void loadTeamData(cid);
  }

  const reload = async () => {
    await refresh();
    if (cid) await loadTeamData(cid);
  };

  const reactivateMember = async (
    userId: string,
    memberRole: Member["role"],
    name: string | null,
  ) => {
    if (!cid) return;
    setBusyUserId(userId);
    try {
      const { error } = await supabase.rpc("reactivate_member", {
        _company_id: cid,
        _user_id: userId,
        _role: memberRole,
      });
      if (error) throw error;
      await reload();
      setShowRevoked(false);
      toast.success(`Access restored for ${name ?? "user"}`);
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to restore access");
    } finally {
      setBusyUserId(null);
    }
  };

  const revokeMember = async (userId: string, name: string | null) => {
    if (!cid) return;
    setBusyUserId(userId);
    try {
      const { error } = await supabase.rpc("remove_member", {
        _company_id: cid,
        _user_id: userId,
      });
      if (error) throw error;
      await reload();
      toast.success(`Access revoked for ${name ?? "user"}`);
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to revoke access");
    } finally {
      setBusyUserId(null);
    }
  };

  const changeRole = async (userId: string, newRole: EmployerRole) => {
    if (!cid) return;
    setBusyUserId(userId);
    try {
      const { error } = await supabase.rpc("update_member_role", {
        _company_id: cid,
        _user_id: userId,
        _role: newRole,
      });
      if (error) throw error;
      await reload();
      toast.success(`Role updated to ${ROLE_LABELS[newRole]}`);
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to change role");
    } finally {
      setBusyUserId(null);
    }
  };

  const sendInvite = async () => {
    if (!cid || !email || !role) return;
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      toast.error(parsedEmail.error.issues[0]?.message || "Enter a valid email address");
      return;
    }
    setSending(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      // token, expires_at have secure DB defaults (see employer_invites DDL) — no need to generate client-side.
      const { data, error } = await supabase
        .from("employer_invites")
        .insert({ company_id: cid, email: parsedEmail.data, role, invited_by: u.user.id })
        .select("id, token")
        .single();
      if (error) throw error;
      setLastInvite({ email: parsedEmail.data, token: data.token });
      setEmail("");
      setRole("recruiter");
      await reload();
      toast.success("Invite created!");
      // Fire-and-forget: a failed invite email must never block invite creation
      // itself (CLAUDE.md: no third-party failure blocks a core flow) — the
      // copyable link above still works as a fallback either way.
      supabase.functions.invoke("send-employer-invite", { body: { inviteId: data.id } }).then(async ({ error: sendErr }) => {
        if (sendErr) {
          const reason = await describeInviteSendError(sendErr);
          toast.error(`Invite created, but the email couldn't be sent (${reason}). Share the copy link instead.`);
        }
      });
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const cancelInvite = async (invite: Invite) => {
    if (!cid) return;
    setBusyInviteId(invite.id);
    try {
      const { error } = await supabase.rpc("cancel_employer_invite", {
        _company_id: cid,
        _invite_id: invite.id,
      });
      if (error) throw error;
      if (lastInvite?.token === invite.token) setLastInvite(null);
      await reload();
      toast.success(`Invite for ${invite.email} cancelled`);
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to cancel invite");
    } finally {
      setBusyInviteId(null);
    }
  };

  const resendInvite = async (invite: Invite) => {
    if (!cid) return;
    setBusyInviteId(invite.id);
    try {
      const { data, error } = await supabase.rpc("resend_employer_invite", {
        _company_id: cid,
        _invite_id: invite.id,
      });
      if (error) throw error;
      const refreshed = data as unknown as { id: string; token: string; email: string };
      setLastInvite({ email: refreshed.email, token: refreshed.token });
      await reload();
      toast.success(`Invite for ${invite.email} refreshed`);
      supabase.functions.invoke("send-employer-invite", { body: { inviteId: refreshed.id } }).then(async ({ error: sendErr }) => {
        if (sendErr) {
          const reason = await describeInviteSendError(sendErr);
          toast.error(`Invite refreshed, but the email couldn't be sent (${reason}). Share the copy link instead.`);
        }
      });
    } catch (error) {
      toast.error((error as Error)?.message ?? "Failed to resend invite");
    } finally {
      setBusyInviteId(null);
    }
  };

  const accessMessage = roleAccessMessage ?? dataError;
  const loading = roleLoading || membersLoading;

  return (
    <EmployerShell title="Team" subtitle="Manage who has access to your company on JobsKart.">
      <div className="space-y-6">
        {accessMessage && (
          <p className="rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">{accessMessage}</p>
        )}

        {!roleLoading && !canManage ? (
          <RoleGate allowed={false} />
        ) : (
          <>
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
                </div>
              </div>
            )}

            <section className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Team</h1>
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
              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Active members ({members.length})</h2>
                {loading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active members.</p>
                ) : (
                  <div className="space-y-2">
                    {members.map((m) => {
                      const name = m.profiles?.full_name ?? "Unnamed";
                      const isSelf = m.user_id === userId;
                      return (
                        <div
                          key={m.user_id}
                          className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface"
                        >
                          <div className="flex-shrink-0">
                            {m.profiles?.full_name ? (
                              <span>{m.profiles.full_name.charAt(0)}</span>
                            ) : (
                              <span className="flex h-6 w-6 items-center justify-center bg-muted rounded-full text-xs">
                                NA
                              </span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium">{name}</p>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(m.role)}`}
                            >
                              {ROLE_LABELS[m.role] ?? m.role}
                            </span>
                          </div>
                          {isSuperAdmin && (
                            <ThemedSelect
                              value={m.role}
                              onChange={(e) => changeRole(m.user_id, e.target.value as EmployerRole)}
                              disabled={busyUserId === m.user_id || isSelf}
                              className="form-input h-8 w-40 text-xs"
                            >
                              <option value="recruiter">Recruiter</option>
                              <option value="hr_admin">HR Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </ThemedSelect>
                          )}
                          {canManage && (
                            <button
                              onClick={() => revokeMember(m.user_id, name)}
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
                )}
              </section>
            ) : (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Revoked members ({revokedMembers.length})</h2>
                {revokedMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No revoked members.</p>
                ) : (
                  <div className="space-y-2">
                    {revokedMembers.map((m) => {
                      const name = m.profiles?.full_name ?? "Unnamed";
                      return (
                        <div
                          key={m.user_id}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface"
                        >
                          <div className="flex-shrink-0">
                            {m.profiles?.full_name ? (
                              <span>{m.profiles.full_name.charAt(0)}</span>
                            ) : (
                              <span className="flex h-6 w-6 items-center justify-center bg-muted rounded-full text-xs">
                                NA
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium">{name}</p>
                            <p className="text-xs text-muted-foreground">
                              Revoked{" "}
                              {formatDistanceToNow(new Date(m.revoked_at ?? Date.now()), { addSuffix: true })}
                            </p>
                          </div>
                          {canManage && (
                            <button
                              onClick={() => reactivateMember(m.user_id, m.role, name)}
                              disabled={busyUserId === m.user_id}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-success hover:bg-success-light disabled:opacity-60"
                              title="Restore access"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Restore</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {invites.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">Pending invites ({invites.length})</h2>
                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm font-medium">{inv.email}</p>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeClass(inv.role)}`}
                        >
                          {ROLE_LABELS[inv.role] ?? inv.role}
                        </span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(inviteUrl(inv.token))}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                        title="Copy invite link"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Copy link</span>
                      </button>
                      <button
                        onClick={() => resendInvite(inv)}
                        disabled={busyInviteId === inv.id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface disabled:opacity-60"
                        title="Resend invite"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Resend</span>
                      </button>
                      <button
                        onClick={() => cancelInvite(inv)}
                        disabled={busyInviteId === inv.id}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light disabled:opacity-60"
                        title="Cancel invite"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Cancel</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <UserPlus className="h-4 w-4" /> Invite teammate
              </h2>
              {!canInvite && !loading && (
                <p className="mt-3 rounded-lg bg-warning-light px-3 py-2 text-xs text-warning">
                  Only HR Admins and Super Admins can create invitations.
                </p>
              )}

              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start gap-2">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Data ownership:</strong> All candidate unlocks
                    and hiring activity belong to your company — not to individual recruiters. Revoking
                    a recruiter's access preserves all data for your team.
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
                    />
                  </div>
                </Field>
                <Field label="Role" required>
                  <ThemedSelect
                    value={role}
                    onChange={(e) => setRole(e.target.value as EmployerRole)}
                    className="form-input"
                    contentClassName="max-h-[min(15rem,var(--radix-select-content-available-height))] overflow-y-auto overflow-x-hidden"
                    itemClassName="hover:bg-surface hover:text-foreground focus:bg-surface focus:text-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary data-[state=checked]:hover:bg-primary/10 data-[state=checked]:hover:text-primary data-[state=checked]:focus:bg-primary/10 data-[state=checked]:focus:text-primary"
                  >
                    <option value="recruiter">Recruiter — post jobs, manage applicants</option>
                    <option value="hr_admin">HR Admin — recruiter + edit company</option>
                    <option value="super_admin">Super Admin — full access</option>
                  </ThemedSelect>
                </Field>
                <button
                  onClick={sendInvite}
                  disabled={sending || !canInvite || !!accessMessage}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4" /> Create invite
                </button>
                <p className="text-xs text-muted-foreground">
                  We'll email them an invite link. They'll join after verifying their mobile number — you can also copy the link below and share it yourself.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </EmployerShell>
  );
}

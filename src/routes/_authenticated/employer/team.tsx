import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Copy,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, setActiveCompanyId } from "@/lib/employer";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/team")({
  head: () => ({ meta: [{ title: "Team · JobsKart" }] }),
  component: TeamPage,
});

type Member = {
  user_id: string;
  role: string;
  status: string;
  revoked_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
};
type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
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

function TeamPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [revokedMembers, setRevokedMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("recruiter");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    setMeId(u.user?.id ?? null);
    if (!u.user) {
      setCid(null);
      setMyRole(null);
      setMembers([]);
      setRevokedMembers([]);
      setInvites([]);
      setAccessMessage("Sign in with an employer account to manage a team.");
      setLoading(false);
      return;
    }

    try {
      const memberships = await fetchMyCompanies(u.user.id);
      let membership = memberships.find((item) => item.company_id === getActiveCompanyId());
      if (!membership) membership = memberships[0];
      if (!membership) {
        setCid(null);
        setMyRole(null);
        setMembers([]);
        setRevokedMembers([]);
        setInvites([]);
        setAccessMessage("This account is not a member of an employer company yet.");
        return;
      }

      const id = membership.company_id;
      setActiveCompanyId(id);
      setCid(id);
      setMyRole(membership.role);
      setAccessMessage(null);

      const [mRes, iRes] = await Promise.all([
        supabase
          .from("employer_members")
          .select("user_id, role, status, revoked_at, profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)")
          .eq("company_id", id),
        supabase
          .from("employer_invites")
          .select("id, email, role, token, expires_at, accepted_at, created_at")
          .eq("company_id", id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false }),
      ]);
      if (mRes.error || iRes.error) {
        setAccessMessage(
          mRes.error?.message || iRes.error?.message || "Couldn't load team details.",
        );
      }
      const allMembers = (mRes.data || []) as unknown as Member[];
      setMembers(allMembers.filter((m) => m.status === "active" || !m.status));
      setRevokedMembers(allMembers.filter((m) => m.status === "revoked"));
      setInvites((iRes.data || []) as Invite[]);
    } catch (error) {
      setCid(null);
      setMyRole(null);
      setMembers([]);
      setRevokedMembers([]);
      setInvites([]);
      setAccessMessage(error instanceof Error ? error.message : "Couldn't load team access.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const sendInvite = async () => {
    if (!cid) return;
    if (!canInvite) return toast.error("Only HR Admins and Super Admins can create invitations.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email.");
    setSending(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("employer_invites").insert({
      company_id: cid,
      email: email.trim().toLowerCase(),
      role: role as never,
      invited_by: u.user!.id,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success("Invite created. Share the link with your teammate.");
    setEmail("");
    load();
  };

  const copy = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        toast.success("Invite link copied.");
        return;
      }
      const input = document.createElement("textarea");
      input.value = url;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      input.setSelectionRange(0, input.value.length);
      const copied = document.execCommand("copy");
      document.body.removeChild(input);
      if (!copied) throw new Error("Copy command was unavailable");
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy the link. Please select and copy it manually.");
    }
  };

  const revokeInvite = async (id: string) => {
    if (!confirm("Revoke this invite?")) return;
    const { error } = await supabase.from("employer_invites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const canInvite = myRole === "super_admin" || myRole === "hr_admin";
  const canManage = myRole === "super_admin";

  const changeRole = async (userId: string, newRole: string) => {
    if (!cid) return;
    const { error } = await supabase.rpc("update_member_role", {
      _company_id: cid,
      _user_id: userId,
      _role: newRole as never,
    });
    if (error) return toast.error(error.message);
    toast.success("Role updated.");
    load();
  };

  const revokeMember = async (userId: string, memberName: string | null) => {
    if (!cid) return;
    if (
      !confirm(
        `Revoke access for ${memberName ?? "this teammate"}?\n\nThey will immediately lose access to the employer portal. All data they created (candidate unlocks, applications reviewed) remains with your company.`,
      )
    )
      return;
    const { error } = await supabase.rpc("remove_member", { _company_id: cid, _user_id: userId });
    if (error) return toast.error(error.message);
    toast.success("Access revoked. Company data is preserved.");
    load();
  };

  const reactivateMember = async (userId: string, memberName: string | null) => {
    if (!cid) return;
    if (!confirm(`Restore access for ${memberName ?? "this teammate"}?`)) return;
    const { error } = await supabase.rpc("reactivate_member", {
      _company_id: cid,
      _user_id: userId,
      _role: "recruiter" as never,
    });
    if (error) return toast.error(error.message);
    toast.success("Access restored as Recruiter. You can change their role now.");
    load();
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "?";
    return name
      .split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  return (
    <EmployerShell title="Team" subtitle="Invite recruiters, HR admins, and super admins.">
      <div className="min-w-0 space-y-5">
        {/* Stats row */}
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <section className="flex min-h-24 min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Active Members
              </p>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-black leading-none tracking-tight text-foreground tabular-nums">
              {loading ? "—" : members.length}
            </p>
          </section>

          <section className="flex min-h-24 min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Pending Invites
              </p>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                <Mail className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-black leading-none tracking-tight text-foreground tabular-nums">
              {loading ? "—" : invites.length}
            </p>
          </section>

          <section className="flex min-h-24 min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Revoked Access
              </p>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface text-muted-foreground">
                <XCircle className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-black leading-none tracking-tight text-foreground tabular-nums">
              {loading ? "—" : revokedMembers.length}
            </p>
          </section>
        </div>

        <div className="grid min-w-0 items-start gap-6 min-[1100px]:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="min-w-0 space-y-4">
            {/* Active Members */}
            <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
              <h2 className="text-sm font-bold">
                Active Members{" "}
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  ({members.length})
                </span>
              </h2>
              {loading ? (
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg bg-surface" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No active members yet.</p>
              ) : (
                <div className="mt-4 divide-y divide-border">
                  {members.map((m) => {
                    const isMe = m.user_id === meId;
                    const name = m.profiles?.full_name;
                    const email = m.profiles?.email;
                    return (
                      <div
                        key={m.user_id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                            {getInitials(name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {name ?? "Team member"}{" "}
                              {isMe && (
                                <span className="ml-1 text-[10px] font-bold uppercase text-primary">
                                  You
                                </span>
                              )}
                            </p>
                            {email && (
                              <p className="truncate text-xs text-muted-foreground">{email}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canManage && !isMe ? (
                            <ThemedSelect
                              value={m.role}
                              onChange={(e) => changeRole(m.user_id, e.target.value)}
                              className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold"
                            >
                              <option value="recruiter">Recruiter</option>
                              <option value="hr_admin">HR Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </ThemedSelect>
                          ) : (
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${roleBadgeClass(m.role)}`}
                            >
                              {m.role.replace(/_/g, " ")}
                            </span>
                          )}
                          {canManage && !isMe && (
                            <button
                              onClick={() => revokeMember(m.user_id, name ?? null)}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light"
                              title="Revoke access"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Revoke</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Pending Invites */}
            <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
              <h2 className="text-sm font-bold">
                Pending invites{" "}
                <span className="ml-1 text-xs font-medium text-muted-foreground">
                  ({invites.length})
                </span>
              </h2>
              {invites.length > 0 && (
                <div className="mt-4 space-y-2">
                  {invites.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-surface p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{i.email}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {i.role.replace(/_/g, " ")} · invited{" "}
                          {formatDistanceToNow(new Date(i.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => copy(i.token)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface"
                        >
                          <Copy className="h-3 w-3" /> Copy link
                        </button>
                        <button
                          onClick={() => revokeInvite(i.id)}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light"
                          title="Cancel invite"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {invites.length === 0 && !loading && (
                <p className="mt-3 text-xs text-muted-foreground">No pending invites.</p>
              )}
            </section>

            {/* Revoked Members — Audit History */}
            {(canManage || revokedMembers.length > 0) && (
              <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
                <button
                  onClick={() => setShowRevoked((v) => !v)}
                  className="flex w-full items-center justify-between text-sm font-bold"
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    Revoked Access History{" "}
                    <span className="ml-1 text-xs font-medium text-muted-foreground">
                      ({revokedMembers.length})
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {showRevoked ? "Hide" : "Show"}
                  </span>
                </button>
                {showRevoked && (
                  <div className="mt-4">
                    {revokedMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No revoked members. Access history is preserved here for auditing.
                      </p>
                    ) : (
                      <div className="divide-y divide-border">
                        {revokedMembers.map((m) => {
                          const name = m.profiles?.full_name;
                          const emailVal = m.profiles?.email;
                          return (
                            <div
                              key={m.user_id}
                              className="flex flex-wrap items-center justify-between gap-2 py-3 opacity-70"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-muted-foreground">
                                  {getInitials(name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium line-through">
                                    {name ?? "Team member"}
                                  </p>
                                  {emailVal && (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {emailVal}
                                    </p>
                                  )}
                                  {m.revoked_at && (
                                    <p className="text-[10px] text-muted-foreground">
                                      Revoked{" "}
                                      {formatDistanceToNow(new Date(m.revoked_at), {
                                        addSuffix: true,
                                      })}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                                  {m.role.replace(/_/g, " ")} · revoked
                                </span>
                                {canManage && (
                                  <button
                                    onClick={() => reactivateMember(m.user_id, name ?? null)}
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-success hover:bg-success-light"
                                    title="Restore access"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Restore</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Invite Form */}
          <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <UserPlus className="h-4 w-4" /> Invite teammate
            </h2>
            {accessMessage && (
              <p className="mt-3 rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">
                {accessMessage}
              </p>
            )}
            {!accessMessage && !canInvite && !loading && (
              <p className="mt-3 rounded-lg bg-warning-light px-3 py-2 text-xs text-warning">
                Only HR Admins and Super Admins can create invitations.
              </p>
            )}

            {/* Data ownership notice */}
            {canManage && (
              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start gap-2">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Data Ownership:</strong> All candidate unlocks
                    and hiring activity belong to your company — not to individual recruiters. Revoking
                    a recruiter's access preserves all data for your team.
                  </p>
                </div>
              </div>
            )}

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
                  onChange={(e) => setRole(e.target.value)}
                  className="form-input"
                  contentClassName="max-h-[min(15rem,var(--radix-select-content-available-height))] overflow-y-auto overflow-x-hidden"
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
                You'll get a unique link to share with your teammate. They'll join after signing in.
              </p>
            </div>
          </section>
        </div>
      </div>
    </EmployerShell>
  );
}

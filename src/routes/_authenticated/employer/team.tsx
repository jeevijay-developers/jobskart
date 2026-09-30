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
  role: "super_admin" | "hr_admin" | "recruiter";
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

      // Fetch active members
      const [mRes, iRes, rRes] = await Promise.all([
        supabase
          .from("employer_members")
          .select("user_id, role, status, revoked_at, profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)")
          .eq("company_id", id)
          .eq("status", "active"),
        supabase
          .from("employer_invites")
          .select("id, email, role, token, expires_at, accepted_at, created_at")
          .eq("company_id", id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("employer_members")
          .select("user_id, role, status, revoked_at, profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)")
          .eq("company_id", id)
          .eq("status", "revoked"),
      ]);

      if (mRes.error || iRes.error || rRes.error) {
        setAccessMessage(
          mRes.error?.message ||
            iRes.error?.message ||
            rRes.error?.message ||
            "Couldn't load team details."
        );
      } else {
        setMembers((mRes.data || []) as unknown as Member[]);
        setRevokedMembers((rRes.data || []) as unknown as Member[]);
        setInvites((iRes.data || []) as Invite[]);
      }
    } catch (error) {
      setCid(null);
      setMyRole(null);
      setMembers([]);
      setRevokedMembers([]);
      setInvites([]);
      setAccessMessage(
        error instanceof Error ? error.message : "Couldn't load team access."
      );
    } finally {
      setLoading(false);
    }
  };
useEffect(() => {
    load();
  }, []);

  const reactivateMember = async (
    userId: string,
    memberRole: Member["role"],
    name: string | null,
  ) => {
    if (!cid) return;
    try {
      const { error } = await supabase.rpc("reactivate_member", {
        _company_id: cid,
        _user_id: userId,
        _role: memberRole,
      });
      if (error) throw error;
      await load();
      setShowRevoked(false);
      toast.success(`Access restored for ${name ?? "user"}`);
    } catch (error) {
      toast.error(
        (error as Error)?.message ?? "Failed to restore access"
      );
    }
  };

  const revokeMember = async (userId: string, name: string | null) => {
    if (!cid) return;
    try {
      const { error } = await supabase.rpc("remove_member", {
        _company_id: cid,
        _user_id: userId,
      });
      if (error) throw error;
      await load();
      toast.success(`Access revoked for ${name ?? "user"}`);
    } catch (error) {
      toast.error(
        (error as Error)?.message ?? "Failed to revoke access"
      );
    }
  };

  const sendInvite = async () => {
    if (!cid || !email || !role) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from("employer_invites")
        .insert({
          company_id: cid,
          email,
          role,
          token: Math.random().toString(36).substring(2, 15),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        })
        .single();
      if (error) throw error;
      setEmail("");
      setRole("recruiter");
      await load();
      toast.success("Invite sent!");
    } catch (error) {
      toast.error(
        (error as Error)?.message ?? "Failed to send invite"
      );
    } finally {
      setSending(false);
    }
  };

  const canInvite = myRole === "hr_admin" || myRole === "super_admin";
  const canManage = myRole === "hr_admin" || myRole === "super_admin";
return (
    <EmployerShell>
      <div className="flex h-full w-full">
        <aside className="w-64 border-r border-border">
          <nav className="flex h-full flex-col p-4 space-y-4">
            <button
              onClick={() => {
                // TODO: navigate to dashboard
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <Users className="h-4 w-4" />
              <span>Team</span>
            </button>
            {/* Additional navigation items can be added here */}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <header className="flex flex-col space-y-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between">
              <h1 className="text-2xl font-bold">Team</h1>
              <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
                <button
                  onClick={() => setShowRevoked(!showRevoked)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    showRevoked
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  <UserPlus className="h-3 w-3" />
                  <span>Show Revoked</span>
                </button>
              </div>
            </div>
            {accessMessage && (
              <p className="rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">
                {accessMessage}
              </p>
            )}
          </header>

          {!showRevoked ? (
            <>
              <section className="space-y-4">
                <h2 className="text-lg font-semibold">Active Members ({members.length})</h2>
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No active members.</p>
                ) : (
                  <div className="space-y-2">
                    {members.map((m) => {
                      const name = m.profiles?.full_name ?? "Unnamed";
                      return (
                        <div key={m.user_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface">
                          <div className="flex-shrink-0">
                            {m.profiles?.full_name ? (
                              <span className="">{m.profiles.full_name.charAt(0)}</span>
                            ) : (
                              <span className="flex h-6 w-6 items-center justify-center bg-muted rounded-full text-xs">NA</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium">{name}</p>
                            <p className="text-xs text-muted-foreground">
                              {roleBadgeClass(m.role)}
                            </p>
                          </div>
                          {canManage && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => revokeMember(m.user_id, name)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-destructive hover:bg-destructive-light"
                                title="Revoke access"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Revoke</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
<>
                  <section className="space-y-4">
                    <h2 className="text-lg font-semibold">Revoked Members ({revokedMembers.length})</h2>
                    {revokedMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No revoked members.</p>
                    ) : (
                      <div className="space-y-2">
                        {revokedMembers.map((m) => {
                          const name = m.profiles?.full_name ?? "Unnamed";
                          return (
                            <div key={m.user_id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface">
                              <div className="flex-shrink-0">
                                {m.profiles?.full_name ? (
                                  <span className="">{m.profiles.full_name.charAt(0)}</span>
                                ) : (
                                  <span className="flex h-6 w-6 items-center justify-center bg-muted rounded-full text-xs">NA</span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1">
                                <p className="text-sm font-medium">{name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Revoked {formatDistanceToNow(new Date(m.revoked_at ?? undefined), { addSuffix: true })}
                                </p>
                              </div>
                              {canManage && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => reactivateMember(m.user_id, m.role, name)}
                                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-success hover:bg-success-light"
                                    title="Restore access"
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Restore</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
          )}

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
                  <p className="mt-3 rounded-bg-warning-light px-3 py-2 text-xs text-warning">
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
                    You'll get a unique link to share with your teammate. They'll join after signing in.
                  </p>
                </div>
              </section>
            </main>
          </div>
        </EmployerShell>
      );
}

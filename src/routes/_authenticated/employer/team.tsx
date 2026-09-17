import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Mail, Trash2, UserPlus } from "lucide-react";
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

function TeamPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("recruiter");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    setMeId(u.user?.id ?? null);
    if (!u.user) {
      setCid(null);
      setMyRole(null);
      setMembers([]);
      setInvites([]);
      setAccessMessage("Sign in with an employer account to manage a team.");
      setLoading(false);
      return;
    }

    try {
      const memberships = await fetchMyCompanies(u.user.id);
      let membership = memberships.find((item) => item.company_id === getActiveCompanyId());

      // A stored company can belong to a previously signed-in account. Only
      // use a company for which the current user has a real membership.
      if (!membership) membership = memberships[0];
      if (!membership) {
        setCid(null);
        setMyRole(null);
        setMembers([]);
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
        supabase.from("employer_members").select("user_id, role").eq("company_id", id),
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
      setMembers((mRes.data || []) as unknown as Member[]);
      setInvites((iRes.data || []) as Invite[]);
    } catch (error) {
      setCid(null);
      setMyRole(null);
      setMembers([]);
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
      // Clipboard API is available only in secure contexts. The fallback keeps
      // copying functional on local HTTP deployments too.
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

  const revoke = async (id: string) => {
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

  const removeMember = async (userId: string) => {
    if (!cid) return;
    if (!confirm("Remove this teammate? They'll lose access immediately.")) return;
    const { error } = await supabase.rpc("remove_member", { _company_id: cid, _user_id: userId });
    if (error) return toast.error(error.message);
    toast.success("Removed.");
    load();
  };

  return (
    <EmployerShell title="Team" subtitle="Invite recruiters, HR admins, and super admins.">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-sm font-bold">
              Members{" "}
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
            ) : (
              <div className="mt-4 divide-y divide-border">
                {members.map((m) => {
                  const isMe = m.user_id === meId;
                  return (
                    <div
                      key={m.user_id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                          T
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            Team member{" "}
                            {isMe && (
                              <span className="ml-1 text-[10px] font-bold uppercase text-primary">
                                You
                              </span>
                            )}
                          </p>
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
                          <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase">
                            {m.role.replace("_", " ")}
                          </span>
                        )}
                        {canManage && !isMe && (
                          <button
                            onClick={() => removeMember(m.user_id)}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light"
                            title="Remove"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {invites.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-sm font-bold">Pending invites</h2>
              <div className="mt-4 space-y-2">
                {invites.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.email}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {i.role} · invited{" "}
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
                        onClick={() => revoke(i.id)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
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
    </EmployerShell>
  );
}

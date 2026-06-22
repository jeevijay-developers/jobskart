import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Mail, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/team")({
  head: () => ({ meta: [{ title: "Team · JobsKart" }] }),
  component: TeamPage,
});

type Member = { user_id: string; role: string; profiles: { full_name: string | null; email: string | null; avatar_url: string | null } | null };
type Invite = { id: string; email: string; role: string; token: string; expires_at: string; accepted_at: string | null; created_at: string };

function TeamPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("recruiter");
  const [sending, setSending] = useState(false);

  const load = async () => {
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
    const [mRes, iRes] = await Promise.all([
      supabase.from("employer_members").select("user_id, role, profiles (full_name, email, avatar_url)").eq("company_id", id),
      supabase.from("employer_invites").select("id, email, role, token, expires_at, accepted_at, created_at").eq("company_id", id).is("accepted_at", null).order("created_at", { ascending: false }),
    ]);
    setMembers((mRes.data || []) as unknown as Member[]);
    setInvites((iRes.data || []) as Invite[]);
  };
  useEffect(() => { load(); }, []);

  const sendInvite = async () => {
    if (!cid) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email.");
    setSending(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("employer_invites").insert({
      company_id: cid, email: email.trim().toLowerCase(), role: role as never, invited_by: u.user!.id,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success("Invite created. Share the link with your teammate.");
    setEmail("");
    load();
  };

  const copy = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied.");
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this invite?")) return;
    const { error } = await supabase.from("employer_invites").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <EmployerShell title="Team" subtitle="Invite recruiters, HR admins, and super admins.">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-sm font-bold">Members</h2>
            <div className="mt-4 divide-y divide-border">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                      {(m.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{m.profiles?.full_name || "Member"}</p>
                      <p className="text-xs text-muted-foreground">{m.profiles?.email}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase">{m.role.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </section>

          {invites.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <h2 className="text-sm font-bold">Pending invites</h2>
              <div className="mt-4 space-y-2">
                {invites.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{i.email}</p>
                      <p className="text-[10px] text-muted-foreground">{i.role} · invited {formatDistanceToNow(new Date(i.created_at), { addSuffix: true })}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => copy(i.token)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs hover:bg-surface">
                        <Copy className="h-3 w-3" /> Copy link
                      </button>
                      <button onClick={() => revoke(i.id)} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light">
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
          <h2 className="flex items-center gap-2 text-sm font-bold"><UserPlus className="h-4 w-4" /> Invite teammate</h2>
          <div className="mt-4 space-y-3">
            <Field label="Email" required>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface px-3"><Mail className="h-4 w-4 text-muted-foreground" /></span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="form-input rounded-l-none" placeholder="teammate@company.com" />
              </div>
            </Field>
            <Field label="Role" required>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="form-input">
                <option value="recruiter">Recruiter — post jobs, manage applicants</option>
                <option value="hr_admin">HR Admin — recruiter + edit company</option>
                <option value="super_admin">Super Admin — full access</option>
              </select>
            </Field>
            <button onClick={sendInvite} disabled={sending} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60">
              <UserPlus className="h-4 w-4" /> Create invite
            </button>
            <p className="text-xs text-muted-foreground">You'll get a unique link to share with your teammate. They'll join after signing in.</p>
          </div>
        </section>
      </div>
    </EmployerShell>
  );
}

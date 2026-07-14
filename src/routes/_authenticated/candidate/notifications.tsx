import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/candidate/notifications")({
  head: () => ({ meta: [{ title: "Notifications · JobsKart" }] }),
  component: NotificationsPage,
});

type Notif = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function NotificationsPage() {
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setRows((data as Notif[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", uid).is("read_at", null);
    load();
  };

  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <CandidateShell
      title="Notifications"
      subtitle="Application updates, recruiter messages and job matches — all in one place."
      actions={
        unread > 0 ? (
          <button onClick={markAllRead} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-surface">
            <Check className="h-4 w-4" /> Mark all read
          </button>
        ) : undefined
      }
    >
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Bell className="mb-3 h-7 w-7 text-muted-foreground" />
          <h2 className="text-lg font-semibold">You're all caught up</h2>
          <p className="mt-1 text-sm text-muted-foreground">New job matches and application updates will show here.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          {rows.map((n) => {
            const inner = (
              <div className={`flex items-start gap-3 p-4 ${n.read_at ? "" : "bg-primary-light/40"}`}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} to={n.link} className="block hover:bg-surface/60">{inner}</Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </CandidateShell>
  );
}

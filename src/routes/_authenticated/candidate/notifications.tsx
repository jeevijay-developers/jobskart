import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";
import { resolveNotificationDestination } from "@/lib/notificationDestination";
import { NotificationContextBanner } from "@/components/candidate/NotificationContextBanner";

// Follow-up to Point 16: a notification with no redirect target
// (resolveNotificationDestination -> { kind: "expand" }) sets this param on
// this same page instead of navigating, so the existing banner can show it
// in place without a second box design.
const notificationsSearchSchema = z.object({
  notification: z.string().uuid().optional(),
});
type NotificationsSearch = z.infer<typeof notificationsSearchSchema>;

export const Route = createFileRoute("/_authenticated/candidate/notifications")({
  validateSearch: notificationsSearchSchema,
  head: () => ({ meta: [{ title: "Notifications · JobsKart" }] }),
  component: NotificationsPage,
});

type Notif = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; application_id: string | null };

function NotificationsPage() {
  const navigate = useNavigate();
  // The notification kept in place here (its destination was "expand", e.g.
  // application.status / interview.scheduled — see
  // resolveNotificationDestination) rather than navigated to. Driven by the
  // URL (not local state) so a refresh or a shared link on
  // ?notification=<id> reproduces the same view (requirement 7), and the X
  // button's "remove the param" is the one place that clears it.
  const search = Route.useSearch();
  const expandedId = search.notification ?? null;
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const topRef = useRef<HTMLDivElement | null>(null);
  const scrolledForRef = useRef<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at, application_id")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    // application_id isn't in the generated Supabase types yet (generated
    // file — not hand-edited; regenerate after
    // 20261010200000_notifications_application_id.sql is applied).
    const loaded = (data as unknown as Notif[]) || [];
    const unreadIds = loaded.filter((row) => !row.read_at).map((row) => row.id);
    if (unreadIds.length) {
      const readAt = new Date().toISOString();
      await supabase.from("notifications").update({ read_at: readAt }).in("id", unreadIds);
      setRows(
        loaded.map((row) => (unreadIds.includes(row.id) ? { ...row, read_at: readAt } : row)),
      );
    } else {
      setRows(loaded);
    }
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

  const onClickNotification = (n: Notif) => {
    const dest = resolveNotificationDestination(n);
    if (dest.kind === "navigate") {
      navigate({ to: dest.to as never });
      return;
    }
    // No record id to redirect to for this type (see
    // notificationDestination.ts) — stay here and show it via the same
    // banner every other destination uses, instead of just highlighting.
    navigate({
      from: Route.fullPath,
      search: (prev: NotificationsSearch) => ({ ...prev, notification: n.id }),
      replace: true,
    });
  };

  const dismissBanner = () => {
    navigate({
      from: Route.fullPath,
      search: (prev: NotificationsSearch) => ({ ...prev, notification: undefined }),
      replace: true,
    });
  };

  // Scroll the banner into view once per notification id — covers both a
  // fresh click and a direct/refreshed ?notification=<id> URL, but doesn't
  // re-scroll on every render while it's already showing.
  useEffect(() => {
    if (!expandedId || scrolledForRef.current === expandedId) return;
    scrolledForRef.current = expandedId;
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expandedId]);

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
      <div ref={topRef}>
        <NotificationContextBanner notificationId={search.notification} onDismiss={dismissBanner} />
      </div>
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
            const expanded = expandedId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onClickNotification(n)}
                className={`flex w-full items-start gap-3 p-4 text-left hover:bg-surface/60 ${
                  expanded
                    ? "bg-primary-light/60 ring-1 ring-inset ring-primary/40"
                    : n.read_at
                      ? ""
                      : "bg-primary-light/40"
                }`}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </CandidateShell>
  );
}

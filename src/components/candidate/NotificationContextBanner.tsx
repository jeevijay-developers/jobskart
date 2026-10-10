import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  created_at: string;
};

/**
 * Point 16: "the notification and its description must be visible on the
 * same page" it redirects to. Mounted at the top of any page that can be
 * reached via a notification's ?notification=<id> param (see
 * resolveNotificationDestination). Reusable/generic — the host route owns
 * reading the param from its own typed search, this component just takes
 * the id.
 *
 * Marks the row read using the same mechanism the Notifications page/bell
 * already use (`update({ read_at })` on `notifications`, scoped by RLS to
 * the signed-in user — "Users update own notifications" policy), so the
 * bell's unread count and the Notifications list stay in sync without a
 * separate code path.
 */
export function NotificationContextBanner({
  notificationId,
  onDismiss,
}: {
  notificationId: string | undefined;
  onDismiss: () => void;
}) {
  // undefined = not loaded yet, null = not found / not this user's / error
  // (all handled the same way: show nothing, per the brief).
  const [notif, setNotif] = useState<Notif | null | undefined>(undefined);

  useEffect(() => {
    if (!notificationId) {
      setNotif(undefined);
      return;
    }
    let cancelled = false;
    setNotif(undefined);
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (!cancelled) setNotif(null);
        return;
      }
      // RLS already scopes this to the caller, but the explicit .eq keeps
      // "not yours" as a plain empty result rather than relying only on the
      // policy — same belt-and-suspenders pattern other candidate pages use.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, created_at")
        .eq("id", notificationId)
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotif(null);
        return;
      }
      setNotif(data as Notif);
      // Same read mechanism as the Notifications page / bell — keeps the
      // unread badge in sync, no separate "read" concept introduced.
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId)
        .eq("user_id", uid)
        .is("read_at", null);
    })();
    return () => {
      cancelled = true;
    };
  }, [notificationId]);

  if (!notificationId || !notif) return null;

  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary-light/50 p-4"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Bell className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{notif.title}</p>
        {notif.body && (
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground/80">
            {notif.body}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {new Date(notif.created_at).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

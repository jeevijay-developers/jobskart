import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DISMISS_KEY = "jk_nudge_dismissed_whatsapp";

/**
 * D3 "one-tap nudge": a candidate who already has a WhatsApp number on file
 * but hasn't turned the alerts preference on sees this once per device until
 * dismissed or enabled. enable_whatsapp_alerts() flips both the preference
 * and legal consent and logs a whatsapp_consents row (source=nudge).
 */
export function WhatsappNudgeCard() {
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY)) return;
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data } = await supabase
        .from("candidate_profiles")
        .select("whatsapp_number, notification_prefs")
        .eq("user_id", uid)
        .maybeSingle();
      const p = data as {
        whatsapp_number: string | null;
        notification_prefs: { whatsapp_alerts?: boolean } | null;
      } | null;
      if (!cancelled && p?.whatsapp_number && !p.notification_prefs?.whatsapp_alerts) {
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    window.localStorage.setItem(DISMISS_KEY, "1");
  };

  const enable = async () => {
    setEnabling(true);
    const { error } = await supabase.rpc("enable_whatsapp_alerts" as never);
    setEnabling(false);
    if (error) return toast.error(error.message);
    toast.success("WhatsApp alerts enabled.");
    dismiss();
  };

  if (!visible) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-success/20 bg-gradient-to-r from-success/10 via-success/5 to-transparent p-4 shadow-[var(--shadow-card)]">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
        <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">Get job alerts on WhatsApp</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Instant updates for interviews, offers and matching jobs — no more checking email.
        </p>
        <button
          onClick={enable}
          disabled={enabling}
          className="mt-2 inline-flex h-9 items-center rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-60"
        >
          {enabling ? "Enabling…" : "Enable"}
        </button>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-surface"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, LogOut, Bell, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/settings")({
  head: () => ({ meta: [{ title: "Settings · JobsKart" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState({
    email_alerts: true,
    whatsapp_alerts: false,
    weekly_digest: true,
  });

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setLoading(false); return; }
      const { data } = await supabase.from("candidate_profiles").select("notification_prefs").eq("user_id", uid).maybeSingle();
      const p = (data as { notification_prefs?: typeof prefs } | null)?.notification_prefs;
      if (p) setPrefs({ ...prefs, ...p });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from("candidate_profiles").update({ notification_prefs: prefs }).eq("user_id", uid);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Preferences saved");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav({ to: "/auth", replace: true });
  };

  const Row = ({ icon: Icon, title, desc, k }: { icon: typeof Bell; title: string; desc: string; k: keyof typeof prefs }) => (
    <label className="flex items-start gap-3 border-b border-border p-4 last:border-0">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <input
        type="checkbox"
        checked={prefs[k]}
        onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })}
        className="mt-1 h-5 w-5 rounded border-border text-primary focus:ring-primary"
      />
    </label>
  );

  return (
    <CandidateShell title="Settings" subtitle="Control how JobsKart reaches you and manage your account.">
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4">
          <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            <header className="border-b border-border p-4">
              <h2 className="text-base font-semibold">Notifications</h2>
            </header>
            <Row icon={Bell} title="Email alerts" desc="Get emailed when recruiters shortlist you or send updates." k="email_alerts" />
            <Row icon={MessageCircle} title="WhatsApp alerts" desc="Instant updates for interviews, offers and match jobs." k="whatsapp_alerts" />
            <Row icon={Bell} title="Weekly job digest" desc="A curated list of the best-matching jobs every Monday." k="weekly_digest" />
            <div className="flex justify-end border-t border-border p-4">
              <button onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save preferences
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-base font-semibold">Account</h2>
            <p className="mt-1 text-xs text-muted-foreground">Sign out on this device. Your data is safely stored on your JobsKart profile.</p>
            <button onClick={signOut} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </section>
        </div>
      )}
    </CandidateShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, LogOut, Trash2, Bell, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { SignOutDialog } from "@/components/candidate/SignOutDialog";
import { DeleteAccountDialog } from "@/components/candidate/DeleteAccountDialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/settings")({
  head: () => ({ meta: [{ title: "Settings · JobsKart" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({
    email_alerts: true,
    whatsapp_alerts: false,
    weekly_digest: true,
    interview_prep_reminders: false,
  });
  // Last-saved whatsapp_alerts value, so save() only writes a consent-ledger
  // row when the toggle actually flips, not on every "Save preferences" click.
  const whatsappAlertsSavedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const [{ data }, { data: profileRow }] = await Promise.all([
        supabase
          .from("candidate_profiles")
          .select("notification_prefs")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase.from("profiles").select("email").eq("id", uid).maybeSingle(),
      ]);
      const p = (data as { notification_prefs?: typeof prefs } | null)?.notification_prefs;
      if (p) setPrefs({ ...prefs, ...p });
      whatsappAlertsSavedRef.current = p?.whatsapp_alerts ?? false;
      setEmail((profileRow as { email?: string | null } | null)?.email ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const { error } = await supabase
      .from("candidate_profiles")
      .update({ notification_prefs: prefs } as never)
      .eq("user_id", uid);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (prefs.whatsapp_alerts !== whatsappAlertsSavedRef.current) {
      whatsappAlertsSavedRef.current = prefs.whatsapp_alerts;
      supabase
        .rpc(
          "record_whatsapp_consent" as never,
          {
            _opted_in: prefs.whatsapp_alerts,
            _source: "settings",
          } as never,
        )
        .then(({ error: rpcError }) => {
          if (rpcError) console.warn("Record WhatsApp consent:", rpcError.message);
        });
    }
    toast.success("Preferences saved");
  };

  const Row = ({
    icon: Icon,
    title,
    desc,
    k,
  }: {
    icon: typeof Bell;
    title: string;
    desc: string;
    k: keyof typeof prefs;
  }) => (
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
    <CandidateShell
      title="Settings"
      subtitle="Control how JobsKart reaches you and manage your account."
    >
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4">
          <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            <header className="border-b border-border p-4">
              <h2 className="text-base font-semibold">Notifications</h2>
            </header>
            <Row
              icon={Bell}
              title="Email alerts"
              desc="Get emailed when recruiters shortlist you or send updates."
              k="email_alerts"
            />
            <Row
              icon={MessageCircle}
              title="WhatsApp alerts"
              desc="Instant updates for interviews, offers and match jobs."
              k="whatsapp_alerts"
            />
            <Row
              icon={Bell}
              title="Interview practice reminders"
              desc="One in-app nudge to practise before an upcoming interview. Off by default; never shared with employers."
              k="interview_prep_reminders"
            />
            <Row
              icon={Bell}
              title="Weekly job digest"
              desc="A curated list of the best-matching jobs every Monday."
              k="weekly_digest"
            />
            <div className="flex justify-end border-t border-border p-4">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save preferences
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-base font-semibold">Account</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign out on this device. Your data is safely stored on your JobsKart profile.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => setSignOutOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
              <button
                onClick={() => setDeleteAccountOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" /> Delete account
              </button>
            </div>
          </section>
        </div>
      )}
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
      <DeleteAccountDialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        email={email}
      />
    </CandidateShell>
  );
}

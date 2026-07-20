import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/plans")({
  head: () => ({ meta: [{ title: "Plan Settings · JobsKart Admin" }] }),
  component: Page,
});

type Settings = {
  id: number;
  free_post_enabled: boolean;
  free_response_cap: number;
  free_whatsapp_cap_per_post: number;
  free_whatsapp_rajasthan_only: boolean;
  free_validity_days: number;
  credits_per_unlock: number;
  custom_plan_min_amount: number;
  spam_jobs_per_hour: number;
};

function Page() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("plan_settings").select("*").eq("id", 1).maybeSingle();
      setS((data as unknown) as Settings);
    })();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase.from("plan_settings").update({
      free_post_enabled: s.free_post_enabled,
      free_response_cap: s.free_response_cap,
      free_whatsapp_cap_per_post: s.free_whatsapp_cap_per_post,
      free_whatsapp_rajasthan_only: s.free_whatsapp_rajasthan_only,
      free_validity_days: s.free_validity_days,
      credits_per_unlock: s.credits_per_unlock,
      custom_plan_min_amount: s.custom_plan_min_amount,
      spam_jobs_per_hour: s.spam_jobs_per_hour,
    }).eq("id", 1);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Saved");
  };

  if (!s) return <AdminShell title="Plan Settings"><div className="h-40 animate-pulse rounded-2xl bg-card" /></AdminShell>;

  const num = (k: keyof Settings, label: string, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{label}</span>
      <input type="number" value={s[k] as number}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </label>
  );
  const bool = (k: keyof Settings, label: string, hint?: string) => (
    <label className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
      <input type="checkbox" checked={s[k] as boolean}
        onChange={(e) => setS({ ...s, [k]: e.target.checked })}
        className="mt-0.5 h-4 w-4" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );

  return (
    <AdminShell title="Plan & Free-tier Settings" subtitle="Global rules for free posts, WhatsApp caps, unlock cost, and spam thresholds."
      actions={
        <button onClick={save} disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold">Free plan</h3>
          {bool("free_post_enabled", "Allow free job posting", "Turn off to force paid plans.")}
          {num("free_response_cap", "Response cap per job", "Max applicants shown for free posts.")}
          {num("free_validity_days", "Free-post validity (days)")}
          {num("free_whatsapp_cap_per_post", "WhatsApp alerts per free post")}
          {bool("free_whatsapp_rajasthan_only", "WhatsApp alerts: Rajasthan only", "If on, free WA alerts only send to Rajasthan candidates.")}
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold">Credits & billing</h3>
          {num("credits_per_unlock", "Credits per candidate unlock", "Default: 5.")}
          {num("custom_plan_min_amount", "Custom plan unlocks above (₹)", "Employers who spend this much can request a custom plan.")}
          <h3 className="pt-4 text-sm font-bold">Anti-spam</h3>
          {num("spam_jobs_per_hour", "Spam threshold (jobs/hour)", "Auto-flag accounts above this rate.")}
        </section>
      </div>
    </AdminShell>
  );
}

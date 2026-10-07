import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, MessageCircle, Pause, Play } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp · JobsKart Admin" }] }),
  component: Page,
});

type Template = {
  id: string;
  key: string;
  category: "utility" | "marketing" | "authentication";
  provider_template_id: string;
  language: string;
  status: string;
};

type Settings = {
  id: number;
  marketing_per_7d: number;
  marketing_min_gap_hours: number;
  quiet_start_hour: number;
  quiet_end_hour: number;
  dispatch_batch_size: number;
  enabled: boolean;
};

type StatusCounts = Record<string, number>;

function Page() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);

  const load = async () => {
    const [{ data: t }, { data: s }, { data: msgs }] = await Promise.all([
      supabase.from("whatsapp_templates").select("*").order("category").order("key"),
      supabase.from("whatsapp_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("whatsapp_messages")
        .select("status")
        .gte("queued_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);
    setTemplates((t ?? []) as Template[]);
    setSettings(s as unknown as Settings);
    const tally: StatusCounts = {};
    for (const row of (msgs ?? []) as Array<{ status: string }>) {
      tally[row.status] = (tally[row.status] ?? 0) + 1;
    }
    setCounts(tally);
  };
  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    const { error } = await supabase
      .from("whatsapp_settings")
      .update({
        marketing_per_7d: settings.marketing_per_7d,
        marketing_min_gap_hours: settings.marketing_min_gap_hours,
        quiet_start_hour: settings.quiet_start_hour,
        quiet_end_hour: settings.quiet_end_hour,
        dispatch_batch_size: settings.dispatch_batch_size,
        enabled: settings.enabled,
      } as never)
      .eq("id", 1);
    setSavingSettings(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  };

  const updateTemplate = async (tpl: Template, patch: Partial<Template>) => {
    setSavingTemplateId(tpl.id);
    const { error } = await supabase
      .from("whatsapp_templates")
      .update(patch as never)
      .eq("id", tpl.id);
    setSavingTemplateId(null);
    if (error) return toast.error(error.message);
    setTemplates((prev) => prev?.map((t) => (t.id === tpl.id ? { ...t, ...patch } : t)) ?? null);
  };

  const num = (k: keyof Settings, label: string, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold">{label}</span>
      <input
        type="number"
        value={settings?.[k] as number}
        onChange={(e) => settings && setSettings({ ...settings, [k]: Number(e.target.value) })}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
      />
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </label>
  );

  if (!templates || !settings) {
    return (
      <AdminShell title="WhatsApp">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="WhatsApp"
      subtitle="Template catalog, send caps and the last 24h delivery snapshot. Sending itself goes live once WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets are set — see .env.example."
      actions={
        <button
          onClick={saveSettings}
          disabled={savingSettings}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
        >
          {savingSettings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}{" "}
          Save settings
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-sm font-bold">Template catalog</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            `key` is what code references; `provider_template_id` must match the exact template name
            approved in Meta Business Manager. Pausing a key stops it from being sent without
            touching code.
          </p>
          <div className="mt-4 divide-y divide-border">
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 sm:flex-1">
                  <p className="break-all font-mono text-sm font-semibold text-foreground">{t.key}</p>
                  <p className="text-xs text-muted-foreground">
                    <span
                      className={`mr-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        t.category === "marketing"
                          ? "bg-amber-500/15 text-amber-600"
                          : "bg-primary-light text-primary"
                      }`}
                    >
                      {t.category}
                    </span>
                    {t.language}
                  </p>
                </div>
                <input
                  value={t.provider_template_id}
                  onChange={(e) =>
                    setTemplates(
                      (prev) =>
                        prev?.map((x) =>
                          x.id === t.id ? { ...x, provider_template_id: e.target.value } : x,
                        ) ?? null,
                    )
                  }
                  onBlur={() => updateTemplate(t, { provider_template_id: t.provider_template_id })}
                  placeholder="Meta template name"
                  className="h-9 w-52 shrink-0 rounded-lg border border-border bg-surface px-2.5 text-xs"
                />
                <button
                  onClick={() =>
                    updateTemplate(t, { status: t.status === "paused" ? "approved" : "paused" })
                  }
                  disabled={savingTemplateId === t.id}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50 ${
                    t.status === "paused"
                      ? "bg-success-light text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {t.status === "paused" ? (
                    <>
                      <Play className="h-3.5 w-3.5" /> Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5" /> Pause
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <MessageCircle className="h-4 w-4 text-primary" /> Last 24h
            </h3>
            {!counts || Object.keys(counts).length === 0 ? (
              <p className="text-xs text-muted-foreground">No messages sent yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {Object.entries(counts).map(([status, n]) => (
                  <li key={status} className="flex items-center justify-between">
                    <span className="capitalize text-muted-foreground">{status}</span>
                    <span className="font-semibold text-foreground">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold">Caps & quiet hours</h3>
            <label className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-sm font-semibold">WhatsApp sending enabled</span>
            </label>
            {num("marketing_per_7d", "Marketing messages / 7 days")}
            {num("marketing_min_gap_hours", "Minimum gap between marketing sends (hours)")}
            {num("quiet_start_hour", "Quiet hours start (IST, 24h)")}
            {num("quiet_end_hour", "Quiet hours end (IST, 24h)")}
            {num(
              "dispatch_batch_size",
              "Dispatch batch size",
              "Per sweeper run — size to your WABA messaging tier.",
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}

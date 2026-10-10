import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Trash2, Plus, Mail, MessageCircle, Pause, Play } from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/candidate/alerts")({
  head: () => ({ meta: [{ title: "Job alerts · JobsKart" }] }),
  component: Page,
});

type Alert = {
  id: string;
  name: string;
  query: { keyword?: string; city?: string } | null;
  frequency: string;
  created_at: string;
  whatsapp_enabled: boolean;
  email_enabled: boolean;
  is_active: boolean;
};

function Page() {
  const [items, setItems] = useState<Alert[]>([]);
  const [keyword, setKw] = useState("");
  const [city, setCity] = useState("");
  const [freq, setFreq] = useState("instant");
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Alert | null>(null);
  // D2/D3: WhatsApp pre-checked on a new alert whenever the candidate is
  // already effectively opted in today — mirrors should_send_whatsapp()
  // without a round trip, since all three inputs are already on hand.
  const [effectiveWhatsapp, setEffectiveWhatsapp] = useState(false);
  const [waChannel, setWaChannel] = useState(false);
  const [emailChannel, setEmailChannel] = useState(true);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setLoading(false);
    const [{ data }, { data: profile }] = await Promise.all([
      supabase
        .from("candidate_job_alerts")
        .select(
          "id, name, query, frequency, created_at, whatsapp_enabled, email_enabled, is_active",
        )
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("candidate_profiles")
        .select("whatsapp_number, whatsapp_opt_in, notification_prefs")
        .eq("user_id", u.user.id)
        .maybeSingle(),
    ]);
    setItems((data || []) as unknown as Alert[]);
    const p = profile as {
      whatsapp_number: string | null;
      whatsapp_opt_in: boolean;
      notification_prefs: { whatsapp_alerts?: boolean } | null;
    } | null;
    const effective = !!(
      p?.whatsapp_number &&
      p.whatsapp_opt_in &&
      p.notification_prefs?.whatsapp_alerts
    );
    setEffectiveWhatsapp(effective);
    setWaChannel(effective);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const kw = keyword.trim();
    const ct = city.trim();
    if (!kw && !ct) return toast.error("Add a keyword or city");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const name = [kw, ct].filter(Boolean).join(" · ") || "New alert";
    const { data: inserted, error } = await supabase
      .from("candidate_job_alerts")
      .insert({
        user_id: u.user.id,
        name,
        query: { keyword: kw || null, city: ct || null },
        frequency: freq,
        whatsapp_enabled: waChannel,
        email_enabled: emailChannel,
      } as never)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    toast.success("Alert saved");
    setKw("");
    setCity("");
    load();
    // Fire-and-forget confirmation email — never blocks the alert-creation flow.
    if (inserted) {
      supabase.functions
        .invoke("send-alert-confirmation", { body: { alertId: inserted.id } })
        .catch(() => {});
    }
  };
  const del = async (id: string) => {
    await supabase.from("candidate_job_alerts").delete().eq("id", id);
    load();
  };
  const toggleField = async (
    alert: Alert,
    field: "whatsapp_enabled" | "email_enabled" | "is_active",
  ) => {
    const next = !alert[field];
    setItems((prev) => prev.map((a) => (a.id === alert.id ? { ...a, [field]: next } : a)));
    const { error } = await supabase
      .from("candidate_job_alerts")
      .update({ [field]: next } as never)
      .eq("id", alert.id);
    if (error) {
      toast.error(error.message);
      setItems((prev) => prev.map((a) => (a.id === alert.id ? { ...a, [field]: !next } : a)));
    }
  };

  return (
    <CandidateShell title="Job alerts" subtitle="We'll notify you when matching jobs are posted.">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h3 className="text-sm font-bold uppercase text-muted-foreground">Create alert</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Input
            placeholder="Job title / keyword"
            value={keyword}
            onChange={(e) => setKw(e.target.value)}
          />
          <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <ThemedSelect
            value={freq}
            onChange={(e) => setFreq(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="instant">Instant</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </ThemedSelect>
          <Button onClick={add}>
            <Plus className="mr-2 h-4 w-4" /> Add alert
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            <input
              type="checkbox"
              checked={emailChannel}
              onChange={(e) => setEmailChannel(e.target.checked)}
            />
            <Mail className="h-3.5 w-3.5" /> Email
          </label>
          <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            <input
              type="checkbox"
              checked={waChannel}
              onChange={(e) => setWaChannel(e.target.checked)}
            />
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </label>
          {waChannel && !effectiveWhatsapp && (
            <span className="text-xs text-muted-foreground">
              Enable WhatsApp alerts in Settings to actually receive these on WhatsApp.
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-card" />
        ) : !items.length ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <Bell className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No alerts yet. Create one above.</p>
          </div>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p
                  className={`font-medium ${a.is_active ? "" : "text-muted-foreground line-through"}`}
                >
                  {a.name}
                </p>
                <p className="text-xs text-muted-foreground uppercase">
                  {a.frequency}
                  {!a.is_active && " · paused"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleField(a, "email_enabled")}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${a.email_enabled ? "bg-primary-light text-primary" : "bg-surface text-muted-foreground"}`}
                  title={
                    a.email_enabled
                      ? "Email alerts on — tap to turn off"
                      : "Email alerts off — tap to turn on"
                  }
                >
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button
                  type="button"
                  onClick={() => toggleField(a, "whatsapp_enabled")}
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${a.whatsapp_enabled ? "bg-primary-light text-primary" : "bg-surface text-muted-foreground"}`}
                  title={
                    a.whatsapp_enabled
                      ? "WhatsApp alerts on — tap to turn off"
                      : "WhatsApp alerts off — tap to turn on"
                  }
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleField(a, "is_active")}
                  title={a.is_active ? "Pause this alert" : "Resume this alert"}
                >
                  {a.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingDelete(a)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job alert?</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to delete the alert{pendingDelete ? ` "${pendingDelete.name}"` : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) del(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CandidateShell>
  );
}

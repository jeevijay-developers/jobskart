import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, MessageCircle, Save } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/settings")({
  head: () => ({ meta: [{ title: "Settings · JobsKart" }] }),
  component: Page,
});

/** Numbers are stored as +91XXXXXXXXXX; the form edits the bare 10 digits. */
const to10 = (v: string | null | undefined) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};
const toE164 = (v: string) => (to10(v).length === 10 ? `+91${to10(v)}` : null);

function Page() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [number, setNumber] = useState("");
  const [optIn, setOptIn] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setLoading(false);
      const ms = await fetchMyCompanies(u.user.id);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      setActive(chosen);
      if (chosen) {
        const { data } = await supabase
          .from("employer_members")
          .select("whatsapp_number, whatsapp_opt_in")
          .eq("company_id", chosen.company_id)
          .eq("user_id", u.user.id)
          .maybeSingle();
        const row = data as { whatsapp_number: string | null; whatsapp_opt_in: boolean } | null;
        setNumber(to10(row?.whatsapp_number));
        setOptIn(row?.whatsapp_opt_in ?? false);
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!active) return;
    if (optIn && to10(number).length !== 10) {
      toast.error("Enter a valid 10-digit WhatsApp number.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc(
      "set_my_employer_whatsapp" as never,
      {
        _company_id: active.company_id,
        _number: optIn ? toE164(number) : null,
        _opt_in: optIn,
      } as never,
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  if (loading) {
    return (
      <EmployerShell title="Settings">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </EmployerShell>
    );
  }

  if (!active) {
    return (
      <EmployerShell title="Settings">
        <p className="text-sm text-muted-foreground">Set up a company first.</p>
      </EmployerShell>
    );
  }

  return (
    <EmployerShell
      title="Settings"
      subtitle="Your personal notification preferences for this company."
      actions={
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{" "}
          Save
        </button>
      }
    >
      <section className="max-w-lg rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-success-light text-success">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold">WhatsApp notifications</h2>
            <p className="text-xs text-muted-foreground">
              Get notified here about job expiry and new applications on jobs you posted.
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-semibold">WhatsApp number</span>
          <div className="flex items-center overflow-hidden rounded-lg border border-input bg-background">
            <span className="px-3 text-sm text-muted-foreground">+91</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit number"
              className="h-10 w-full bg-transparent pr-3 text-sm outline-none"
            />
          </div>
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>Send me job expiry reminders and new-application alerts on WhatsApp</span>
        </label>
      </section>
    </EmployerShell>
  );
}

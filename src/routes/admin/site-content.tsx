import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { CONTACT_FALLBACK, type ContactInfo } from "@/lib/site-content";

export const Route = createFileRoute("/admin/site-content")({
  component: Page,
});

const AUDIENCE_FIELDS = [
  { key: "helpline", label: "Helpline number" },
  { key: "helplineHours", label: "Helpline hours" },
  { key: "email", label: "Support email" },
  { key: "whatsapp", label: "WhatsApp number" },
] as const;

const SUBJECT_GROUPS = [
  { key: "job_seeker", label: "Job seeker subjects" },
  { key: "employer", label: "Employer subjects" },
] as const;

function Page() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["site-content", "contact"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_content")
        .select("value")
        .eq("key", "contact")
        .maybeSingle();
      if (error) throw error;
      return { ...CONTACT_FALLBACK, ...((data?.value as Partial<ContactInfo>) ?? {}) };
    },
  });
  const [form, setForm] = useState<ContactInfo>(CONTACT_FALLBACK);
  const [subjectText, setSubjectText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!data) return;
    setForm(data);
    setSubjectText(
      Object.fromEntries(
        SUBJECT_GROUPS.map((g) => [g.key, (data.subjects[g.key] ?? []).join(", ")]),
      ),
    );
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const subjects = Object.fromEntries(
        SUBJECT_GROUPS.map((g) => [
          g.key,
          (subjectText[g.key] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ]),
      ) as ContactInfo["subjects"];
      const { error } = await supabase
        .from("site_content")
        .upsert({ key: "contact", value: { ...form, subjects } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contact details saved");
      qc.invalidateQueries({ queryKey: ["site-content", "contact"] });
      qc.invalidateQueries({ queryKey: ["site-content-public", "contact"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setAudience = (aud: "jobSeeker" | "employer", key: string, value: string) =>
    setForm({ ...form, [aud]: { ...form[aud], [key]: value } });

  return (
    <AdminShell title="Site content" subtitle="Everything shown in the home page Contact Us section">
      <div className="grid max-w-3xl gap-6">
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">General</h3>
          <div>
            <Label>Heading</Label>
            <Input value={form.heading} onChange={(e) => setForm({ ...form, heading: e.target.value })} />
          </div>
          <div>
            <Label>Subheading</Label>
            <Textarea
              rows={2}
              value={form.subheading}
              onChange={(e) => setForm({ ...form, subheading: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <Label>Show "Online Now" badge</Label>
              <p className="text-xs text-muted-foreground">Green pill next to the helpline.</p>
            </div>
            <Switch checked={form.onlineNow} onCheckedChange={(v) => setForm({ ...form, onlineNow: v })} />
          </div>
          <div>
            <Label>Response time note</Label>
            <Input value={form.responseTime} onChange={(e) => setForm({ ...form, responseTime: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Company name (HQ)</Label>
              <Input
                value={form.hq.company}
                onChange={(e) => setForm({ ...form, hq: { ...form.hq, company: e.target.value } })}
              />
            </div>
            <div>
              <Label>HQ address</Label>
              <Input
                value={form.hq.address}
                onChange={(e) => setForm({ ...form, hq: { ...form.hq, address: e.target.value } })}
              />
            </div>
          </div>
        </section>

        {(["jobSeeker", "employer"] as const).map((aud) => (
          <section key={aud} className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {aud === "jobSeeker" ? "For job seekers" : "For employers"}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {AUDIENCE_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <Input
                    value={form[aud][f.key]}
                    onChange={(e) => setAudience(aud, f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Inquiry subjects</h3>
          <p className="text-xs text-muted-foreground">Comma-separated. Shown in the form's subject dropdown.</p>
          {SUBJECT_GROUPS.map((g) => (
            <div key={g.key}>
              <Label>{g.label}</Label>
              <Input
                value={subjectText[g.key] ?? ""}
                onChange={(e) => setSubjectText({ ...subjectText, [g.key]: e.target.value })}
              />
            </div>
          ))}
        </section>

        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save site content
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}

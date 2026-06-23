import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/banners")({
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", subtitle: "", image_url: "", cta_label: "", cta_url: "", audience: "both" });
  const { data } = useQuery({
    queryKey: ["banners-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("promo_banners").select("*").order("sort").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("promo_banners").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Banner created"); setForm({ title: "", subtitle: "", image_url: "", cta_label: "", cta_url: "", audience: "both" }); qc.invalidateQueries({ queryKey: ["banners-admin"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from("promo_banners").update({ is_active: !row.is_active }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["banners-admin"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("promo_banners").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["banners-admin"] }),
  });

  return (
    <AdminShell title="Promo Banners" subtitle="Shown on candidate & employer dashboards">
      <div className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><Label>Subtitle</Label><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></div>
        <div><Label>Image URL</Label><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
        <div><Label>CTA Label</Label><Input value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} /></div>
        <div><Label>CTA URL</Label><Input value={form.cta_url} onChange={(e) => setForm({ ...form, cta_url: e.target.value })} /></div>
        <div>
          <Label>Audience</Label>
          <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="candidate">Candidates</SelectItem>
              <SelectItem value="employer">Employers</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => add.mutate()} disabled={!form.title || add.isPending}>Create banner</Button>
        </div>
      </div>
      <div className="space-y-3">
        {!data?.length ? <p className="text-sm text-muted-foreground">No banners yet.</p> :
          data.map((b: any) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{b.title}</p>
                <p className="text-xs text-muted-foreground">{b.audience} • {b.cta_url || "no link"}</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={b.is_active} onCheckedChange={() => tog.mutate(b)} />
                <Button size="sm" variant="ghost" onClick={() => del.mutate(b.id)}>Delete</Button>
              </div>
            </div>
          ))}
      </div>
    </AdminShell>
  );
}

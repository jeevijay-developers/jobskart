import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/testimonials")({
  component: Page,
});

const EMPTY_FORM = { name: "", role_text: "", quote: "", initials: "", rating: "5", sort: "0" };

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const { data } = useQuery({
    queryKey: ["testimonials-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("home_testimonials")
        .select("*")
        .order("sort")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("home_testimonials").insert({
        name: form.name,
        role_text: form.role_text,
        quote: form.quote,
        initials: form.initials,
        rating: Number(form.rating),
        sort: Number(form.sort) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Testimonial created");
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["testimonials-admin"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase
        .from("home_testimonials")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["testimonials-admin"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("home_testimonials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["testimonials-admin"] }),
  });

  return (
    <AdminShell title="Testimonials" subtitle="Shown in the Real People. Real Jobs. section on the home page">
      <div className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Role / location</Label><Input value={form.role_text} onChange={(e) => setForm({ ...form, role_text: e.target.value })} placeholder="Delivery Rider • Noida, UP" /></div>
        <div className="sm:col-span-2"><Label>Quote</Label><Textarea value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} rows={3} /></div>
        <div><Label>Initials</Label><Input value={form.initials} onChange={(e) => setForm({ ...form, initials: e.target.value.toUpperCase().slice(0, 2) })} placeholder="SV" /></div>
        <div>
          <Label>Rating</Label>
          <Select value={form.rating} onValueChange={(v) => setForm({ ...form, rating: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[5, 4, 3, 2, 1].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} star{n > 1 ? "s" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Sort order</Label><Input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: e.target.value })} /></div>
        <div className="sm:col-span-2">
          <Button onClick={() => add.mutate()} disabled={!form.name || !form.quote || !form.initials || add.isPending}>
            Create testimonial
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {!data?.length ? (
          <p className="text-sm text-muted-foreground">No testimonials yet.</p>
        ) : (
          data.map((t: any) => (
            <div key={t.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{t.name} <span className="font-normal text-muted-foreground">· {t.role_text}</span></p>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">"{t.quote}"</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.rating}★ • sort {t.sort}</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={t.is_active} onCheckedChange={() => tog.mutate(t)} />
                <Button size="sm" variant="ghost" onClick={() => del.mutate(t.id)}>Delete</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </AdminShell>
  );
}

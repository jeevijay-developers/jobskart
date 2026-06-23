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

export const Route = createFileRoute("/_authenticated/admin/learning")({
  component: Page,
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
}

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", cover_url: "", content_url: "", kind: "article", category: "" });
  const { data } = useQuery({
    queryKey: ["learning-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("learning_resources").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("learning_resources").insert({ ...form, slug: slugify(form.title) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Created"); setForm({ title: "", description: "", cover_url: "", content_url: "", kind: "article", category: "" }); qc.invalidateQueries({ queryKey: ["learning-admin"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: async (row: any) => { const { error } = await supabase.from("learning_resources").update({ is_published: !row.is_published }).eq("id", row.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["learning-admin"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("learning_resources").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["learning-admin"] }),
  });

  return (
    <AdminShell title="Learning" subtitle="Articles and videos for candidates">
      <div className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><Label>Cover image URL</Label><Input value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} /></div>
        <div><Label>Content URL (video/article)</Label><Input value={form.content_url} onChange={(e) => setForm({ ...form, content_url: e.target.value })} /></div>
        <div>
          <Label>Kind</Label>
          <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="article">Article</SelectItem>
              <SelectItem value="video">Video</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Button onClick={() => add.mutate()} disabled={!form.title || !form.content_url || add.isPending}>Create</Button>
        </div>
      </div>
      <div className="space-y-3">
        {!data?.length ? <p className="text-sm text-muted-foreground">No resources yet.</p> :
          data.map((l: any) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{l.title}</p>
                <p className="text-xs text-muted-foreground">{l.kind} • {l.category || "uncategorized"}</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={l.is_published} onCheckedChange={() => tog.mutate(l)} />
                <Button size="sm" variant="ghost" onClick={() => del.mutate(l.id)}>Delete</Button>
              </div>
            </div>
          ))}
      </div>
    </AdminShell>
  );
}

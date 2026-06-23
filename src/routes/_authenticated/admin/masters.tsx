import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/masters")({
  component: Page,
});

const tables = [
  { key: "cities", label: "Cities" },
  { key: "skills_master", label: "Skills" },
  { key: "industries", label: "Industries" },
  { key: "job_categories", label: "Job Categories" },
] as const;

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function TableSection({ table }: { table: typeof tables[number]["key"] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["master", table],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from(table).select("*").order("name");
      if (error) throw error;
      return data as any[];
    },
  });
  const add = useMutation({
    mutationFn: async (n: string) => {
      const { error } = await (supabase as any).from(table).insert({ name: n, slug: slugify(n) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Added"); setName(""); qc.invalidateQueries({ queryKey: ["master", table] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await (supabase as any).from(table).update({ is_active: !row.is_active }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["master", table] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["master", table] }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New name" className="max-w-xs" />
        <Button onClick={() => name.trim() && add.mutate(name.trim())} disabled={add.isPending}>Add</Button>
      </div>
      <div className="rounded-2xl border border-border bg-card">
        {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> :
          !data?.length ? <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p> :
          data.map((row: any) => (
            <div key={row.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.slug}</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={row.is_active} onCheckedChange={() => toggle.mutate(row)} />
                <Button size="sm" variant="ghost" onClick={() => confirm("Delete?") && del.mutate(row.id)}>Delete</Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function Page() {
  return (
    <AdminShell title="Master Data" subtitle="Cities, skills, industries, categories">
      <Tabs defaultValue="cities">
        <TabsList className="mb-4 flex w-full flex-wrap justify-start">
          {tables.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {tables.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <TableSection table={t.key} />
          </TabsContent>
        ))}
      </Tabs>
    </AdminShell>
  );
}

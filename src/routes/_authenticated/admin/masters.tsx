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

type NameTable = "cities" | "skills_master" | "industries" | "job_categories" | "languages_master";
type ColSpec = {
  table: string;
  label: string;
  primary: string;           // primary label column (e.g. name, title, label)
  extra?: {
    key: string;
    label: string;
    type: "text" | "select";
    options?: string[];
    default?: string;
  };
  hasSlug?: boolean;
};

const SPECS: ColSpec[] = [
  { table: "cities", label: "Cities", primary: "name", hasSlug: true },
  { table: "skills_master", label: "Skills", primary: "name", hasSlug: true },
  { table: "industries", label: "Industries", primary: "name", hasSlug: true },
  { table: "job_categories", label: "Job Categories", primary: "name", hasSlug: true },
  { table: "job_titles_master", label: "Job Titles", primary: "title" },
  {
    table: "candidate_assets_master",
    label: "Candidate Assets",
    primary: "label",
    hasSlug: true,
    extra: {
      key: "category",
      label: "Category",
      type: "select",
      options: ["general", "field", "desk"],
      default: "general",
    },
  },
  { table: "languages_master", label: "Languages", primary: "name" },
];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function TableSection({ spec }: { spec: ColSpec }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [extraVal, setExtraVal] = useState(spec.extra?.default ?? "");

  const queryKey = ["master", spec.table];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(spec.table)
        .select("*")
        .order(spec.primary);
      if (error) throw error;
      return data as any[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const v = value.trim();
      if (!v) throw new Error("Enter a value");
      const row: Record<string, unknown> = { [spec.primary]: v };
      if (spec.hasSlug) row.slug = slugify(v);
      if (spec.extra) row[spec.extra.key] = extraVal || spec.extra.default;
      const { error } = await (supabase as any).from(spec.table).insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added");
      setValue("");
      setExtraVal(spec.extra?.default ?? "");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await (supabase as any)
        .from(spec.table)
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from(spec.table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`New ${spec.label.toLowerCase()}`}
          className="max-w-xs"
        />
        {spec.extra?.type === "select" && (
          <select
            value={extraVal}
            onChange={(e) => setExtraVal(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {spec.extra.options!.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
        <Button onClick={() => add.mutate()} disabled={add.isPending || !value.trim()}>Add</Button>
      </div>
      <div className="rounded-2xl border border-border bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : !data?.length ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          data.map((row: any) => (
            <div key={row.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{row[spec.primary]}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {spec.hasSlug && row.slug ? row.slug : ""}
                  {spec.extra ? ` · ${row[spec.extra.key] ?? ""}` : ""}
                  {row.is_custom ? " · custom" : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={!!row.is_active} onCheckedChange={() => toggle.mutate(row)} />
                <Button size="sm" variant="ghost" onClick={() => confirm("Delete?") && del.mutate(row.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LaunchStateAction() {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState("Rajasthan");
  const run = async () => {
    if (!confirm(`Mark all cities in "${state}" as launched?`)) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("admin_launch_state", { _state: state });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`Launched ${data ?? 0} cities in ${state}`);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
      <span className="text-xs font-semibold text-muted-foreground">Bulk launch:</span>
      <Input value={state} onChange={(e) => setState(e.target.value)} className="h-9 max-w-[180px]" placeholder="State" />
      <Button size="sm" onClick={run} disabled={busy}>{busy ? "Launching…" : `Launch ${state}`}</Button>
    </div>
  );
}

function Page() {
  return (
    <AdminShell title="Master Data" subtitle="Cities, skills, industries, job titles, assets & languages">
      <LaunchStateAction />
      <Tabs defaultValue={SPECS[0].table}>
        <TabsList className="mb-4 flex w-full flex-wrap justify-start">
          {SPECS.map((s) => (
            <TabsTrigger key={s.table} value={s.table}>{s.label}</TabsTrigger>
          ))}
        </TabsList>
        {SPECS.map((s) => (
          <TabsContent key={s.table} value={s.table}>
            <TableSection spec={s} />
          </TabsContent>
        ))}
      </Tabs>
    </AdminShell>
  );
}

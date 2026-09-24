import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
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
          <ThemedSelect
            value={extraVal}
            onChange={(e) => setExtraVal(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {spec.extra.options!.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </ThemedSelect>
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

// Curated market pay bands that back the JobWizard salary suggestion. The
// generic TableSection can't express the multi-number band row, so this gets
// its own CRUD + a "Recompute" button that re-aggregates computed bands from
// real postings (refresh_computed_salary_bands()).
const EXP_BUCKETS = ["any", "fresher", "experienced"];
const BAND_PAY_TYPES = ["any", "fixed", "fixed_incentive", "incentive_only"];

function SalaryBandsSection() {
  const qc = useQueryClient();
  const queryKey = ["master", "salary_bands"];
  const emptyForm = {
    title_key: "", category: "", city: "", experience_bucket: "any", pay_type: "any",
    min_salary: "", p25: "", median_salary: "", p75: "", max_salary: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [sourceFilter, setSourceFilter] = useState<"all" | "admin" | "computed">("all");

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("salary_bands")
        .select("*")
        .order("title_key")
        .order("city")
        .limit(500);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data as any[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      const min = num(form.min_salary), p25 = num(form.p25), med = num(form.median_salary);
      const p75 = num(form.p75), max = num(form.max_salary);
      if (!form.title_key.trim()) throw new Error("Title key is required");
      if (med == null || Number.isNaN(med)) throw new Error("Median salary is required");
      const row = {
        title_key: slugify(form.title_key),
        category: form.category.trim() || null,
        city: form.city.trim() || null,
        state: null,
        experience_bucket: form.experience_bucket,
        pay_type: form.pay_type,
        min_salary: min ?? med,
        p25: p25 ?? med,
        median_salary: med,
        p75: p75 ?? med,
        max_salary: max ?? med,
        sample_count: 0,
        source: "admin",
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("salary_bands").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Band added");
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.message),
  });

  const recompute = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("refresh_computed_salary_bands");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast.success(`Recomputed ${n ?? 0} market bands from live postings`);
      qc.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("salary_bands").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).filter((r: any) => sourceFilter === "all" || r.source === sourceFilter);
  const set = (k: keyof typeof emptyForm) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
          {recompute.isPending ? "Recomputing…" : "Recompute market bands"}
        </Button>
        <ThemedSelect
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All sources</option>
          <option value="admin">Admin</option>
          <option value="computed">Computed</option>
        </ThemedSelect>
        <span className="text-xs text-muted-foreground">{rows.length} band{rows.length === 1 ? "" : "s"}</span>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">Add admin band</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input value={form.title_key} onChange={set("title_key")} placeholder="Title key (e.g. Delivery Executive)" />
          <Input value={form.category} onChange={set("category")} placeholder="Category (optional)" />
          <Input value={form.city} onChange={set("city")} placeholder="City (optional)" />
          <ThemedSelect value={form.experience_bucket} onChange={(e) => setForm((f) => ({ ...f, experience_bucket: e.target.value }))} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            {EXP_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </ThemedSelect>
          <ThemedSelect value={form.pay_type} onChange={(e) => setForm((f) => ({ ...f, pay_type: e.target.value }))} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            {BAND_PAY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </ThemedSelect>
          <Input type="number" value={form.min_salary} onChange={set("min_salary")} placeholder="Min" />
          <Input type="number" value={form.p25} onChange={set("p25")} placeholder="p25" />
          <Input type="number" value={form.median_salary} onChange={set("median_salary")} placeholder="Median *" />
          <Input type="number" value={form.p75} onChange={set("p75")} placeholder="p75" />
          <Input type="number" value={form.max_salary} onChange={set("max_salary")} placeholder="Max" />
        </div>
        <Button className="mt-3" size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add band"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-bold uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Title</th><th className="p-3">City</th><th className="p-3">Bucket</th>
                <th className="p-3">Pay</th><th className="p-3">Range (₹)</th><th className="p-3">n</th>
                <th className="p-3">Source</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3 font-medium">{r.title_key}</td>
                  <td className="p-3">{r.city ?? "—"}</td>
                  <td className="p-3">{r.experience_bucket}</td>
                  <td className="p-3">{r.pay_type}</td>
                  <td className="p-3 tabular-nums">{Number(r.min_salary).toLocaleString("en-IN")}–{Number(r.max_salary).toLocaleString("en-IN")}</td>
                  <td className="p-3 tabular-nums">{r.sample_count}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.source === "computed" ? "bg-primary-light text-primary" : "bg-surface text-muted-foreground"}`}>
                      {r.source}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => confirm("Delete band?") && del.mutate(r.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
          <TabsTrigger value="salary_bands">Salary Bands</TabsTrigger>
        </TabsList>
        {SPECS.map((s) => (
          <TabsContent key={s.table} value={s.table}>
            <TableSection spec={s} />
          </TabsContent>
        ))}
        <TabsContent value="salary_bands">
          <SalaryBandsSection />
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}

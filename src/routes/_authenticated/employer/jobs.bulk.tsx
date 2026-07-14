import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, Download, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Button } from "@/components/ui/button";
import { downloadBulkJobTemplate, parseBulkJobsFile, type BulkJobRow } from "@/lib/jd-bulk-template";
import { bulkCreateJobs } from "@/lib/bulk-jobs.functions";
import { getActiveCompanyId, fetchMyCompanies } from "@/lib/employer";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/employer/jobs/bulk")({
  head: () => ({ meta: [{ title: "Bulk post jobs · JobsKart" }] }),
  component: BulkPage,
});

function BulkPage() {
  const [rows, setRows] = useState<BulkJobRow[]>([]);
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(bulkCreateJobs);
  const nav = useNavigate();

  const onFile = async (f: File) => {
    try {
      const parsed = await parseBulkJobsFile(f);
      if (!parsed.length) return toast.error("No valid rows found");
      setRows(parsed);
      toast.success(`Parsed ${parsed.length} jobs`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      let cid = getActiveCompanyId();
      if (!cid) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Sign in required");
        const ms = await fetchMyCompanies(u.user.id);
        cid = ms[0]?.company_id ?? null;
      }
      if (!cid) throw new Error("Complete company onboarding first");
      const res = await upload({ data: { company_id: cid, rows } });
      toast.success(`${res.count} jobs published`);
      nav({ to: "/employer/jobs" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to upload");
    } finally { setBusy(false); }
  };

  return (
    <EmployerShell title="Bulk post jobs" subtitle="Upload an Excel sheet — publish up to 200 jobs in one go.">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <FileSpreadsheet className="h-8 w-8 text-primary" />
          <h3 className="mt-3 font-bold">1. Download template</h3>
          <p className="mt-1 text-sm text-muted-foreground">Excel with sample rows + allowed values.</p>
          <Button variant="outline" onClick={downloadBulkJobTemplate} className="mt-4 w-full">
            <Download className="mr-2 h-4 w-4" /> Download .xlsx
          </Button>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <Upload className="h-8 w-8 text-primary" />
          <h3 className="mt-3 font-bold">2. Upload filled sheet</h3>
          <p className="mt-1 text-sm text-muted-foreground">We'll parse and preview before publishing.</p>
          <label className="mt-4 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm hover:bg-surface">
            <Upload className="h-4 w-4" /> Choose file
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <CheckCircle2 className="h-8 w-8 text-primary" />
          <h3 className="mt-3 font-bold">3. Publish</h3>
          <p className="mt-1 text-sm text-muted-foreground">All jobs go live instantly.</p>
          <Button onClick={submit} disabled={!rows.length || busy} className="mt-4 w-full">
            {busy ? "Publishing…" : `Publish ${rows.length} jobs`}
          </Button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-bold uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Title</th><th className="p-3">City</th><th className="p-3">Salary</th>
                <th className="p-3">Exp</th><th className="p-3">Skills</th><th className="p-3">Openings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="p-3 font-medium">{r.title}</td>
                  <td className="p-3">{r.city}</td>
                  <td className="p-3 tabular-nums">₹{r.min_salary?.toLocaleString("en-IN") || "—"}–{r.max_salary?.toLocaleString("en-IN") || "—"}</td>
                  <td className="p-3">{r.min_experience_years ?? 0}–{r.max_experience_years ?? "any"} y</td>
                  <td className="p-3 text-muted-foreground">{r.skills}</td>
                  <td className="p-3 tabular-nums">{r.openings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EmployerShell>
  );
}

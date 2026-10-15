import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, FileSpreadsheet, CheckCircle2, ArrowLeft } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Button } from "@/components/ui/button";
import { downloadBulkJobTemplate, parseBulkJobsFile, validateBulkRow, type BulkJobRow } from "@/lib/jd-bulk-template";
import { bulkCreateJobs, getBulkPostAllowance } from "@/lib/bulk-jobs.functions";
import { computeJobQuality, jobQualityLabel } from "@/lib/jobQuality";
import { getActiveCompanyId, fetchMyCompanies } from "@/lib/employer";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/employer/jobs/bulk")({
  head: () => ({ meta: [{ title: "Bulk post jobs · JobsKart" }] }),
  component: BulkPage,
});

// Same copy mapTierError() uses for live_jobs_max_reached on the single Post
// Job flow (src/lib/jobs.functions.ts) — kept identical here rather than a
// second hardcoded string, so the two flows never say different things for
// the same limit.
const LIVE_JOBS_LIMIT_MESSAGE =
  "You've reached your plan's live job limit. Close a job or upgrade to post more.";

function BulkPage() {
  const [rows, setRows] = useState<BulkJobRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [cid, setCid] = useState<string | null>(null);
  // null = not loaded yet; undefined remaining = unlimited.
  const [allowance, setAllowance] = useState<{ remaining: number | null } | null>(null);
  const upload = useServerFn(bulkCreateJobs);
  const getAllowance = useServerFn(getBulkPostAllowance);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      let id = getActiveCompanyId();
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const ms = await fetchMyCompanies(u.user.id);
          id = ms[0]?.company_id ?? null;
        }
      }
      setCid(id);
      if (id) {
        try {
          const a = await getAllowance({ data: { company_id: id } });
          setAllowance(a);
        } catch {
          // Non-fatal for the page — Publish still re-checks server-side via
          // bulkCreateJobs; this only powers the preview's up-front chips.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same rubric the wizard uses live and the DB persists on insert — shown
  // per row here so consultancies can fix weak spreadsheets before upload.
  const rowQuality = (r: BulkJobRow) =>
    computeJobQuality({
      title: r.title, city: r.city, job_type: r.job_type, work_mode: r.work_mode,
      min_salary: r.min_salary, max_salary: r.max_salary, pay_type: r.pay_type || "fixed",
      education: r.education || null, openings: r.openings,
      skills: r.skills ? r.skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
      description: r.description || null,
    });
  const lowQualityCount = rows.filter((r) => rowQuality(r) < 40).length;
  const invalidCount = rows.filter((r) => validateBulkRow(r)).length;

  const onFile = async (f: File) => {
    try {
      const parsed = await parseBulkJobsFile(f);
      if (!parsed.length) return toast.error("No valid rows found");
      setRows(parsed);
      const invalid = parsed.filter((r) => validateBulkRow(r)).length;
      toast.success(
        invalid > 0
          ? `Parsed ${parsed.length} jobs — ${invalid} have errors and won't be published`
          : `Parsed ${parsed.length} jobs`,
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to parse file");
    }
  };

  const validRows = rows.filter((r) => !validateBulkRow(r));
  // Up-front sizing shown in the preview, before Publish is clicked — the
  // server (bulkCreateJobs) recomputes this itself as the real authority;
  // this mirrors it only so the chips/button/limit message are accurate
  // without waiting for a round trip on every keystroke of the preview.
  const remaining = allowance?.remaining ?? null; // null = unlimited or not loaded yet
  const allowedCount =
    allowance === null ? validRows.length : remaining === null ? validRows.length : Math.min(validRows.length, remaining);
  const skippedForLimitCount = validRows.length - allowedCount;
  const limitFull = allowance !== null && remaining === 0;
  // Valid rows beyond the allowed count, in sheet order — identity-based so
  // the table below can mark exactly those rows "Skipped" without re-deriving
  // the slice per row.
  const rowsSkippedForLimit = new Set(validRows.slice(allowedCount));

  const submit = async () => {
    if (!validRows.length) return toast.error("Fix the row errors before publishing.");
    if (limitFull) return toast.error(LIVE_JOBS_LIMIT_MESSAGE);
    setBusy(true);
    try {
      let activeCid = cid;
      if (!activeCid) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Sign in required");
        const ms = await fetchMyCompanies(u.user.id);
        activeCid = ms[0]?.company_id ?? null;
      }
      if (!activeCid) throw new Error("Complete company onboarding first");
      const res = await upload({ data: { company_id: activeCid, rows: validRows } });
      const parts = [`${res.count} went live`];
      if (res.skippedLimit > 0) parts.push(`${res.skippedLimit} skipped (plan limit reached)`);
      if (res.drafts > 0) parts.push(`${res.drafts} stayed as drafts${res.failure ? ` — ${res.failure}` : ""}`);
      if (res.count > 0 && res.skippedLimit === 0 && res.drafts === 0) {
        toast.success(`${res.count} jobs published`);
      } else {
        toast.error(parts.join(", "));
      }
      nav({ to: "/employer/jobs" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to upload");
    } finally { setBusy(false); }
  };

  return (
    <EmployerShell
      title="Bulk post jobs"
      subtitle="Upload an Excel sheet — publish up to 200 jobs in one go."
      headerLeft={
        <Link
          to="/employer/jobs"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Jobs
        </Link>
      }
    >
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
          <Button
            onClick={submit}
            disabled={!validRows.length || !allowedCount || busy}
            className="mt-4 w-full"
          >
            {busy ? "Publishing…" : `Publish ${allowedCount} jobs`}
          </Button>
        </div>
      </div>

      {limitFull && rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning-light px-4 py-3 text-sm text-warning">
          <span>{LIVE_JOBS_LIMIT_MESSAGE}</span>
          <Link to="/employer/credits" className="font-semibold underline">
            View Credits & plan →
          </Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-foreground">
            {rows.length} rows
          </span>
          <span className="rounded-full border border-success/30 bg-success-light px-3 py-1 text-success">
            {allowedCount} will go live
          </span>
          {skippedForLimitCount > 0 && (
            <span className="rounded-full border border-warning/30 bg-warning-light px-3 py-1 text-warning">
              {skippedForLimitCount} skipped — plan limit reached
            </span>
          )}
          {invalidCount > 0 && (
            <span className="rounded-full border border-destructive/30 bg-destructive-light px-3 py-1 text-destructive">
              {invalidCount} need fixes
            </span>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
          {invalidCount > 0 && (
            <p className="border-b border-border bg-destructive-light px-4 py-2.5 text-xs font-medium text-destructive">
              {invalidCount} of {rows.length} rows have errors and won't be published — see the Status column below.
            </p>
          )}
          {lowQualityCount > 0 && (
            <p className="border-b border-border bg-warning-light px-4 py-2.5 text-xs font-medium text-warning">
              {lowQualityCount} of {rows.length} rows score below 40/100 on job quality — consider adding pay
              ranges, at least 3 skills, and fuller descriptions before publishing.
            </p>
          )}
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-bold uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Title</th><th className="p-3">City</th><th className="p-3">Salary</th>
                <th className="p-3">Exp</th><th className="p-3">Skills</th><th className="p-3">Openings</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const reason = validateBulkRow(r);
                const skippedForLimit = !reason && rowsSkippedForLimit.has(r);
                const q = rowQuality(r);
                const { label, color } = jobQualityLabel(q);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="p-3 font-medium">{r.title}</td>
                    <td className="p-3">{r.city}</td>
                    <td className="p-3 tabular-nums">₹{r.min_salary?.toLocaleString("en-IN") || "—"}–{r.max_salary?.toLocaleString("en-IN") || "—"}</td>
                    <td className="p-3">{r.min_experience_years ?? 0}–{r.max_experience_years ?? "any"} y</td>
                    <td className="p-3 text-muted-foreground">{r.skills}</td>
                    <td className="p-3 tabular-nums">{r.openings}</td>
                    <td className="p-3">
                      {reason ? (
                        <span className="text-xs font-semibold text-destructive">{reason}</span>
                      ) : skippedForLimit ? (
                        <span className="text-xs font-semibold text-warning">
                          Skipped · Plan limit reached
                        </span>
                      ) : (
                        <span className={`text-xs font-semibold ${color}`}>{label} · {q}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </EmployerShell>
  );
}

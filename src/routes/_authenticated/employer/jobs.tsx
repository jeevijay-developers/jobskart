import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Copy, Eye, Pause, Play, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { formatSalary, jobTypeLabel } from "@/lib/format";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/jobs")({
  head: () => ({ meta: [{ title: "Manage Jobs · JobsKart" }] }),
  component: EmployerJobs,
});

type Job = {
  id: string;
  title: string;
  city: string | null;
  status: string;
  job_type: string;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  applications_count: number | null;
  views_count: number | null;
  created_at: string;
};

const STATUSES = ["all", "active", "paused", "closed", "draft"] as const;

function EmployerJobs() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    let cid = getActiveCompanyId();
    if (!cid) {
      const ms = await fetchMyCompanies(user.user.id);
      cid = ms[0]?.company_id ?? null;
    }
    if (!cid) { setJobs([]); setAllJobs([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, city, status, job_type, min_salary, max_salary, salary_period, applications_count, views_count, created_at")
      .eq("company_id", cid)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setAllJobs((data || []) as Job[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // client-side filter so counts always render
  useEffect(() => {
    let res = allJobs;
    if (statusFilter !== "all") res = res.filter((j) => j.status === statusFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      res = res.filter((j) => j.title.toLowerCase().includes(t));
    }
    setJobs(res);
  }, [allJobs, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allJobs.length };
    for (const s of ["active", "paused", "closed", "draft"]) {
      c[s] = allJobs.filter((j) => j.status === s).length;
    }
    return c;
  }, [allJobs]);

  const setStatus = async (id: string, status: "active" | "paused" | "closed") => {
    const { error } = await supabase.from("jobs").update({ status } as never).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Job ${status}.`);
    load();
  };
  const duplicate = async (id: string) => {
    const orig = allJobs.find((j) => j.id === id);
    if (!orig) return;
    const { data: full, error: fErr } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (fErr || !full) return toast.error(fErr?.message || "Could not load job");
    const f = full as Record<string, unknown>;
    delete f.id; delete f.created_at; delete f.updated_at; delete f.slug;
    delete f.applications_count; delete f.views_count; delete f.quality_score;
    f.title = `${orig.title} (copy)`;
    f.status = "draft";
    const { error } = await supabase.from("jobs").insert(f as never);
    if (error) return toast.error(error.message);
    toast.success("Job duplicated as draft.");
    load();
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this job permanently?")) return;
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Job deleted.");
    load();
  };

  return (
    <EmployerShell
      title="Jobs"
      subtitle="Post, pause, or close your job listings."
      actions={
        <Link to="/employer/jobs/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
          <Plus className="h-4 w-4" /> Post a job
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title…"
          className="form-input h-10 max-w-xs flex-1"
        />
        <div className="flex gap-1.5 overflow-x-auto">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${
                statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-foreground/30"
              }`}
            >
              {s}
              <span className={`tabular-nums ${statusFilter === s ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                ({counts[s] ?? 0})
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-card" />)}</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-10 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-bold">No jobs yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Post your first job in 3 minutes.</p>
          <Link to="/employer/jobs/new" className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" /> Post a job
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{j.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      j.status === "active" ? "bg-success-light text-success" :
                      j.status === "paused" ? "bg-warning-light text-warning" :
                      "bg-surface text-muted-foreground"
                    }`}>{j.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {jobTypeLabel(j.job_type)} · {j.city || "Multiple cities"} · {formatSalary(j.min_salary, j.max_salary, j.salary_period || "monthly")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">Posted {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/employer/jobs/$jobId/applicants"
                    params={{ jobId: j.id }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-surface"
                  >
                    <Users className="h-4 w-4" /> {j.applications_count || 0} applicants
                  </Link>
                  <Link
                    to="/jobs/$jobId"
                    params={{ jobId: j.id }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface"
                  >
                    <Eye className="h-4 w-4" /> {j.views_count || 0}
                  </Link>
                  {j.status === "active" ? (
                    <button onClick={() => setStatus(j.id, "paused")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface">
                      <Pause className="h-4 w-4" /> Pause
                    </button>
                  ) : j.status === "paused" ? (
                    <button onClick={() => setStatus(j.id, "active")} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-surface">
                      <Play className="h-4 w-4" /> Resume
                    </button>
                  ) : null}
                  <button onClick={() => remove(j.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </EmployerShell>
  );
}

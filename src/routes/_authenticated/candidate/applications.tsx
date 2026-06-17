import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Loader2, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo, formatSalary } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/candidate/applications")({
  head: () => ({ meta: [{ title: "My Applications · JobsKart" }] }),
  component: ApplicationsPage,
});

const STATUSES = ["all", "applied", "shortlisted", "interview", "hired", "rejected", "withdrawn"] as const;
type StatusTab = (typeof STATUSES)[number];

const statusStyle: Record<string, string> = {
  applied: "bg-primary-light text-primary",
  shortlisted: "bg-amber/10 text-amber",
  interview: "bg-amber/10 text-amber",
  hired: "bg-success-light text-success",
  rejected: "bg-destructive/10 text-destructive",
  withdrawn: "bg-surface text-muted-foreground",
};

type Row = {
  id: string;
  status: string;
  created_at: string;
  jobs: {
    id: string;
    title: string;
    city: string | null;
    min_salary: number | null;
    max_salary: number | null;
    salary_period: string | null;
    companies: { name: string } | null;
  } | null;
};

function ApplicationsPage() {
  const [tab, setTab] = useState<StatusTab>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const { data, error } = await supabase
      .from("applications")
      .select("id, status, created_at, jobs (id, title, city, min_salary, max_salary, salary_period, companies (name))")
      .eq("candidate_id", uid)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as unknown as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => (tab === "all" ? rows : rows.filter((r) => r.status === tab)), [rows, tab]);

  const withdraw = async (id: string) => {
    if (!confirm("Withdraw this application?")) return;
    const { error } = await supabase.from("applications").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Application withdrawn");
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  return (
    <CandidateShell title="My applications" subtitle="Track every job you've applied to in one place.">
      <div className="mb-5 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
        {STATUSES.map((s) => {
          const count = s === "all" ? rows.length : rows.filter((r) => r.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors ${
                tab === s ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
              }`}
            >
              {s} {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Briefcase className="mb-3 h-7 w-7 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No applications yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Browse jobs and apply to start tracking responses.</p>
          <Link to="/jobs" className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Browse jobs
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/jobs/$jobId" params={{ jobId: a.jobs?.id || "" }} className="text-base font-semibold text-foreground hover:text-primary">
                    {a.jobs?.title || "Job removed"}
                  </Link>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusStyle[a.status] || "bg-surface text-muted-foreground"}`}>
                    {a.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.jobs?.companies?.name || "Confidential"}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-foreground/70">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {a.jobs?.city || "—"}
                  </span>
                  <span>{formatSalary(a.jobs?.min_salary, a.jobs?.max_salary, a.jobs?.salary_period || "monthly")}</span>
                  <span>Applied {timeAgo(a.created_at)}</span>
                </div>
              </div>
              {a.status !== "withdrawn" && a.status !== "hired" && (
                <button
                  onClick={() => withdraw(a.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface"
                >
                  <X className="h-3.5 w-3.5" /> Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </CandidateShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";
import {
  CheckCircle2,
  Filter,
  Inbox,
  RefreshCw,
  Sparkle,
  XCircle,
  Calendar,
  ArrowUpRight,
  Download,
  AlertTriangle,
} from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { recommendShortlist } from "@/lib/ai-shortlist.functions";
import { buildDownloadDataset } from "@/lib/downloads.functions";

export const Route = createFileRoute("/_authenticated/employer/responses")({
  head: () => ({ meta: [{ title: "Responses · JobsKart Employer" }] }),
  component: ResponsesPage,
});

const STATUSES = [
  { v: "applied", label: "New", tone: "bg-primary-light text-primary" },
  { v: "shortlisted", label: "Shortlisted", tone: "bg-success-light text-success" },
  { v: "interview", label: "Interview", tone: "bg-warning-light text-warning" },
  { v: "hired", label: "Hired", tone: "bg-success text-success-foreground" },
  { v: "rejected", label: "Rejected", tone: "bg-surface text-muted-foreground" },
] as const;

type Row = {
  id: string;
  status: string;
  created_at: string;
  candidate_id: string;
  jobs: { id: string; title: string } | null;
  profiles: { full_name: string | null; city: string | null; avatar_url: string | null; mobile: string | null } | null;
};

type AiRow = {
  application_id: string;
  candidate_id: string;
  score: number;
  reasons: string[];
  summary: string | null;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
};

function ResponsesPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobFilter, setJobFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"inbox" | "ai">("inbox");
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [expiringCount, setExpiringCount] = useState(0);

  const recommend = useServerFn(recommendShortlist);
  const buildDownload = useServerFn(buildDownloadDataset);

  const doDownload = async () => {
    if (!cid) return;
    setDownloading(true);
    try {
      const { rows: dl, todayCount } = await buildDownload({ data: { companyId: cid, kind: "responses", jobId: jobFilter || undefined } });
      const ws = XLSX.utils.json_to_sheet(dl);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Responses");
      XLSX.writeFile(wb, `jobskart-responses-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Downloaded ${dl.length} rows · ${todayCount}/300 today`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloading(false); }
  };

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
      if (!id) { setLoading(false); return; }
      setCid(id);
      const { data: js } = await supabase.from("jobs").select("id, title").eq("company_id", id).order("created_at", { ascending: false });
      setJobs(js || []);
    })();
  }, []);

  const load = async () => {
    if (!cid) return;
    setLoading(true);
    let qy = supabase
      .from("applications")
      .select("id, status, created_at, candidate_id, jobs!inner (id, title, company_id), profiles!applications_candidate_id_fkey (full_name, city, avatar_url, mobile)")
      .eq("jobs.company_id", cid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (jobFilter) qy = qy.eq("job_id", jobFilter);
    if (statusFilter) qy = qy.eq("status", statusFilter as never);
    const { data } = await qy;
    setRows((data || []) as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => { if (cid) load(); /* eslint-disable-next-line */ }, [cid, jobFilter, statusFilter]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      (r.profiles?.full_name || "").toLowerCase().includes(needle) ||
      (r.jobs?.title || "").toLowerCase().includes(needle) ||
      (r.profiles?.city || "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const setStatus = async (ids: string[], status: string) => {
    setRows((p) => p.map((r) => (ids.includes(r.id) ? { ...r, status } : r)));
    const { error } = await supabase.from("applications").update({ status } as never).in("id", ids);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(`Marked ${ids.length} as ${status}`);
    setSelected(new Set());
  };

  const loadAi = async (refresh = false) => {
    if (!jobFilter) {
      toast.error("Pick a job to get AI recommendations.");
      return;
    }
    setAiLoading(true);
    try {
      const data = await recommend({ data: { jobId: jobFilter, refresh } });
      setAiRows(data as AiRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally { setAiLoading(false); }
  };

  useEffect(() => {
    if (tab === "ai" && jobFilter) loadAi(false);
    // eslint-disable-next-line
  }, [tab, jobFilter]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <EmployerShell
      title="Responses"
      subtitle="One inbox for every candidate across your jobs."
      actions={
        <button onClick={load} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      }
    >
      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab("inbox")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === "inbox" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Inbox className="h-4 w-4" /> Inbox <span className="rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums">{filtered.length}</span>
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === "ai" ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Sparkle className="h-4 w-4" /> AI shortlist
        </button>
      </div>

      <section className="mb-4 grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          className="form-input h-10" placeholder="Search candidate, job, or city…"
        />
        <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} className="form-input h-10">
          <option value="">All jobs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
        {tab === "inbox" ? (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="form-input h-10">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        ) : (
          <button onClick={() => loadAi(true)} disabled={!jobFilter || aiLoading} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary-light px-3 text-sm font-semibold text-primary disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? "animate-spin" : ""}`} /> Re-rank
          </button>
        )}
      </section>

      {tab === "inbox" ? (
        <>
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light p-3">
              <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button key={s.v} onClick={() => setStatus([...selected], s.v)} className="rounded-md bg-card px-2.5 py-1 text-xs font-semibold hover:bg-surface">{s.label}</button>
                ))}
              </div>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:underline">Clear</button>
            </div>
          )}

          {loading ? (
            <div className="h-64 animate-pulse rounded-2xl bg-card" />
          ) : filtered.length === 0 ? (
            <EmptyResponses />
          ) : (
            <ul className="space-y-2">
              {filtered.map((r) => {
                const tone = STATUSES.find((s) => s.v === r.status)?.tone ?? "bg-surface text-muted-foreground";
                return (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)] sm:p-4">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 shrink-0 accent-primary" />
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                      {(r.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.profiles?.full_name || "Candidate"}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.jobs?.title} {r.profiles?.city ? `· ${r.profiles.city}` : ""}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</p>
                    </div>
                    <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase sm:inline-block ${tone}`}>{r.status}</span>
                    <div className="hidden shrink-0 gap-1 sm:flex">
                      <button onClick={() => setStatus([r.id], "shortlisted")} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-success hover:bg-success-light" title="Shortlist">
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                      <button onClick={() => setStatus([r.id], "interview")} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-warning hover:bg-warning-light" title="Interview">
                        <Calendar className="h-4 w-4" />
                      </button>
                      <button onClick={() => setStatus([r.id], "rejected")} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-surface" title="Reject">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                    <Link to="/employer/jobs/$jobId/applicants" params={{ jobId: r.jobs?.id || "" }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card hover:bg-surface" title="Open">
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          {!jobFilter ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
              <Filter className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-semibold">Pick a job above to see AI-ranked candidates.</p>
            </div>
          ) : aiLoading && aiRows.length === 0 ? (
            <div className="h-64 animate-pulse rounded-2xl bg-card" />
          ) : aiRows.length === 0 ? (
            <EmptyResponses label="No applicants yet on this job." />
          ) : (
            <ul className="space-y-2">
              {aiRows.map((r, i) => (
                <li key={r.application_id} className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                      {(r.full_name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-foreground/5 text-[10px] font-bold tabular-nums text-muted-foreground">#{i + 1}</span>
                        <p className="truncate text-sm font-semibold">{r.full_name || "Candidate"}</p>
                        <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-black tabular-nums ${
                          r.score >= 75 ? "bg-success text-success-foreground" :
                          r.score >= 50 ? "bg-primary text-primary-foreground" :
                          "bg-surface text-muted-foreground"
                        }`}>{r.score}/100</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.city} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</p>
                      {r.summary && <p className="mt-2 text-sm text-foreground/80">{r.summary}</p>}
                      {r.reasons.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {r.reasons.slice(0, 4).map((reason, idx) => (
                            <li key={idx} className="flex gap-1.5"><span className="text-primary">•</span>{reason}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button onClick={() => setStatus([r.application_id], "shortlisted")} className="inline-flex h-8 items-center gap-1 rounded-lg bg-success px-2.5 text-xs font-semibold text-success-foreground hover:opacity-90">
                          <CheckCircle2 className="h-3 w-3" /> Shortlist
                        </button>
                        <button onClick={() => setStatus([r.application_id], "interview")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-warning bg-warning-light px-2.5 text-xs font-semibold text-warning">
                          <Calendar className="h-3 w-3" /> Interview
                        </button>
                        <button onClick={() => setStatus([r.application_id], "rejected")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground hover:bg-surface">
                          <XCircle className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </EmployerShell>
  );
}

function EmptyResponses({ label = "No responses match these filters." }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">Once candidates apply, they'll show up here in real time.</p>
    </div>
  );
}

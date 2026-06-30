import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Mail, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/jobs/$jobId/applicants")({
  head: () => ({ meta: [{ title: "Applicants · JobsKart" }] }),
  component: ApplicantsPage,
});

type Application = {
  id: string;
  status: string;
  created_at: string;
  cover_note: string | null;
  candidate_id: string;
  profiles: { full_name: string | null; email: string | null; mobile: string | null; avatar_url: string | null; city: string | null } | null;
  candidate_profiles: { profile_slug: string | null } | null;
};

const COLUMNS = [
  { id: "applied", label: "Applied", tone: "bg-primary-light text-primary" },
  { id: "shortlisted", label: "Shortlisted", tone: "bg-success-light text-success" },
  { id: "interview", label: "Interview", tone: "bg-warning-light text-warning" },
  { id: "hired", label: "Hired", tone: "bg-success text-success-foreground" },
  { id: "rejected", label: "Rejected", tone: "bg-surface text-muted-foreground" },
] as const;

function ApplicantsPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<{ title: string; status: string } | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [active, setActive] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [jRes, aRes] = await Promise.all([
      supabase.from("jobs").select("title, status").eq("id", jobId).single(),
      supabase.from("applications").select("id, status, created_at, cover_note, candidate_id, profiles!applications_candidate_id_fkey (full_name, email, mobile, avatar_url, city)").eq("job_id", jobId).order("created_at", { ascending: false }),
    ]);
    setJob(jRes.data as { title: string; status: string } | null);
    const rows = (aRes.data || []) as Array<Omit<Application, "candidate_profiles">>;
    const ids = Array.from(new Set(rows.map((r) => r.candidate_id)));
    let slugMap: Record<string, string | null> = {};
    if (ids.length) {
      const { data: cps } = await supabase
        .from("candidate_profiles")
        .select("user_id, profile_slug")
        .in("user_id", ids);
      slugMap = Object.fromEntries((cps || []).map((c) => [c.user_id, c.profile_slug]));
    }
    setApps(rows.map((r) => ({ ...r, candidate_profiles: { profile_slug: slugMap[r.candidate_id] ?? null } })) as Application[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [jobId]);

  const move = async (appId: string, status: string) => {
    setApps((p) => p.map((a) => (a.id === appId ? { ...a, status } : a)));
    const { error } = await supabase.from("applications").update({ status } as never).eq("id", appId);
    if (error) { toast.error(error.message); load(); }
  };

  return (
    <EmployerShell
      title={job?.title ?? "Applicants"}
      subtitle={`${apps.length} applicant${apps.length === 1 ? "" : "s"}`}
      actions={
        <Link to="/employer/jobs" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
          <ArrowLeft className="h-4 w-4" /> All jobs
        </Link>
      }
    >
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const items = apps.filter((a) => a.status === col.id);
            return (
              <div key={col.id} className="flex w-72 shrink-0 flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold">{col.label}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${col.tone}`}>{items.length}</span>
                </div>
                <div className="flex-1 space-y-2 rounded-xl border border-border bg-surface p-2">
                  {items.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">Drop candidates here</p>
                  ) : items.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setActive(a)}
                      className="block w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary/40"
                    >
                      <div className="flex items-center gap-2">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-light text-xs font-semibold text-primary">
                          {(a.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{a.profiles?.full_name || "Candidate"}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{a.profiles?.city || ""}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">Applied {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-foreground/40" onClick={() => setActive(null)} />
          <aside className="w-full max-w-md overflow-y-auto bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-light text-base font-semibold text-primary">
                  {(active.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold">{active.profiles?.full_name || "Candidate"}</h3>
                  <p className="text-xs text-muted-foreground">{active.profiles?.city}</p>
                </div>
              </div>
              <button onClick={() => setActive(null)} className="rounded-lg p-2 hover:bg-surface"><X className="h-5 w-5" /></button>
            </div>

            <div className="mt-5 space-y-2 text-sm">
              {active.profiles?.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {active.profiles.email}</p>}
              {active.profiles?.mobile && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {active.profiles.mobile}</p>}
            </div>

            {active.cover_note && (
              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cover note</p>
                <p className="mt-2 rounded-lg border border-border bg-surface p-3 text-sm">{active.cover_note}</p>
              </div>
            )}

            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Move to</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {COLUMNS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { move(active.id, c.id); setActive({ ...active, status: c.id }); }}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold ${active.status === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-surface"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {active.candidate_profiles?.profile_slug ? (
              <Link
                to="/u/$slug"
                params={{ slug: active.candidate_profiles.profile_slug }}
                className="mt-6 block rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm font-semibold text-foreground hover:bg-card"
              >
                View full profile
              </Link>
            ) : (
              <p className="mt-6 rounded-lg border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                Candidate has not published a public profile yet
              </p>
            )}
          </aside>
        </div>
      )}
    </EmployerShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpDown, Users } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ApplicantCard } from "@/components/employer/ApplicantCard";
import { ApplicantReviewPanel } from "@/components/employer/ApplicantReviewPanel";
import { supabase } from "@/integrations/supabase/client";
import { APPLICANT_STATUSES, applicantStatusLabel } from "@/lib/applicantStatus";

export const Route = createFileRoute("/_authenticated/employer/jobs/$jobId/applicants")({
  head: () => ({ meta: [{ title: "Applicants · JobsKart" }] }),
  component: ApplicantsPage,
});

type Application = {
  id: string;
  status: string;
  created_at: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  candidate_id: string;
  profiles: { full_name: string | null; email: string | null; mobile: string | null; avatar_url: string | null; city: string | null } | null;
  candidate_profiles: {
    profile_slug: string | null;
    headline: string | null;
    last_role: string | null;
    years_experience: number | null;
    experience_status: string | null;
    skills: string[] | null;
  } | null;
  education: { level: string; institute: string | null } | null;
};

const TABS = [{ id: "all", label: "All" }, ...APPLICANT_STATUSES] as const;
type Tab = (typeof TABS)[number]["id"];

function emptyStateCopy(tab: Tab) {
  switch (tab) {
    case "all":
      return { title: "No applicants yet", body: "Applications will show up here as candidates apply." };
    case "applied":
      return { title: "Nothing new to review", body: "New applications land here first." };
    case "shortlisted":
      return { title: "No one shortlisted yet", body: "Move promising applicants here to keep track of them." };
    case "interview":
      return { title: "No interviews in progress", body: "Applicants you're interviewing will show up here." };
    case "hired":
      return { title: "No hires yet", body: "Once you mark someone hired, they'll appear here." };
    case "rejected":
      return { title: "No rejections", body: "Applicants you pass on will be listed here." };
  }
}

function ApplicantsPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<{ title: string; status: string } | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [reviewing, setReviewing] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    const [jRes, aRes] = await Promise.all([
      supabase.from("jobs").select("title, status").eq("id", jobId).single(),
      supabase
        .from("applications")
        .select(
          "id, status, created_at, cover_note, expected_salary, available_from, candidate_id, profiles!candidate_id (full_name, email, mobile, avatar_url, city)",
        )
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
    ]);
    if (jRes.error) toast.error(jRes.error.message);
    if (aRes.error) toast.error(aRes.error.message);
    setJob(jRes.data as { title: string; status: string } | null);

    const rows = ((aRes.data || []) as unknown) as Array<Omit<Application, "candidate_profiles" | "education">>;
    const ids = Array.from(new Set(rows.map((r) => r.candidate_id)));

    let cpMap: Record<string, Application["candidate_profiles"]> = {};
    const eduMap: Record<string, Application["education"]> = {};
    if (ids.length) {
      const [cpRes, eduRes] = await Promise.all([
        supabase
          .from("candidate_profiles")
          .select("user_id, profile_slug, headline, last_role, years_experience, experience_status, skills")
          .in("user_id", ids),
        supabase
          .from("candidate_education")
          .select("user_id, level, institute, year_of_passing")
          .in("user_id", ids)
          .order("year_of_passing", { ascending: false, nullsFirst: false }),
      ]);
      cpMap = Object.fromEntries((cpRes.data || []).map((c) => [c.user_id, c]));
      for (const e of eduRes.data || []) {
        if (!eduMap[e.user_id]) eduMap[e.user_id] = { level: e.level, institute: e.institute };
      }
    }

    setApps(
      rows.map((r) => ({
        ...r,
        candidate_profiles: cpMap[r.candidate_id] ?? null,
        education: eduMap[r.candidate_id] ?? null,
      })) as Application[],
    );
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [jobId]);

  const updateStatus = async (ids: string[], status: string) => {
    setApps((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, status } : a)));
    setReviewing((r) => (r && ids.includes(r.id) ? { ...r, status } : r));
    const { error } = await supabase.from("applications").update({ status } as never).in("id", ids);
    if (error) { toast.error(error.message); load(); return; }
    toast.success(ids.length > 1 ? `Moved ${ids.length} to ${applicantStatusLabel(status)}` : `Marked as ${applicantStatusLabel(status)}`);
    setSelectedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    for (const s of APPLICANT_STATUSES) c[s.id] = apps.filter((a) => a.status === s.id).length;
    return c;
  }, [apps]);

  const visible = useMemo(() => {
    const filtered = tab === "all" ? apps : apps.filter((a) => a.status === tab);
    const sorted = [...filtered].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === "newest" ? -diff : diff;
    });
    return sorted;
  }, [apps, tab, sortOrder]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const empty = emptyStateCopy(tab);
  // Mobile tabs: Hired/Rejected stay revealed once the user has moved into
  // that part of the pipeline, not just while Interview itself is active —
  // otherwise clicking Hired or Rejected would immediately hide its own row.
  const showInterviewSubTabs = tab === "interview" || tab === "hired" || tab === "rejected";

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
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* Mobile: primary tabs fill the container width in a 4-col grid;
                Interview reveals a second 2-col row (Hired/Rejected) below,
                inside this same container. Desktop (sm:) reverts to the
                original single-row flex-wrap layout with all six tabs. */}
            <div className="w-full rounded-xl border border-border bg-card p-1 sm:flex sm:w-auto sm:flex-wrap sm:gap-1">
              <div className="grid grid-cols-4 gap-1 sm:contents">
                {TABS.filter((t) => t.id !== "hired" && t.id !== "rejected").map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-3 ${
                      tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
                    }`}
                  >
                    {t.label} {counts[t.id] > 0 && <span className="ml-1 opacity-80">({counts[t.id]})</span>}
                  </button>
                ))}
              </div>
              <div className={`${showInterviewSubTabs ? "mt-1 grid grid-cols-2 gap-1" : "hidden"} sm:contents sm:mt-0`}>
                {TABS.filter((t) => t.id === "hired" || t.id === "rejected").map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-3 ${
                      tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
                    }`}
                  >
                    {t.label} {counts[t.id] > 0 && <span className="ml-1 opacity-80">({counts[t.id]})</span>}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
            >
              <ArrowUpDown className="h-3.5 w-3.5" /> {sortOrder === "newest" ? "Newest first" : "Oldest first"}
            </button>
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light p-3">
              <span className="text-xs font-semibold text-primary">{selectedIds.size} selected</span>
              <div className="flex flex-wrap gap-1.5">
                {APPLICANT_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => updateStatus([...selectedIds], s.id)}
                    className="rounded-md bg-card px-2.5 py-1 text-xs font-semibold hover:bg-surface"
                  >
                    Move to {s.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-muted-foreground hover:underline">
                Clear
              </button>
            </div>
          )}

          {visible.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Users className="mb-3 h-7 w-7 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">{empty.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{empty.body}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {visible.map((a) => (
                <ApplicantCard
                  key={a.id}
                  applicant={a}
                  selected={selectedIds.has(a.id)}
                  onToggleSelect={() => toggleSelect(a.id)}
                  onStatusChange={(status) => updateStatus([a.id], status)}
                  onView={() => setReviewing(a)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {reviewing && (
        <ApplicantReviewPanel
          applicant={reviewing}
          onClose={() => setReviewing(null)}
          onStatusChange={(status) => updateStatus([reviewing.id], status)}
        />
      )}
    </EmployerShell>
  );
}

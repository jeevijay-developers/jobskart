import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ApplicantCard } from "@/components/employer/ApplicantCard";
import { ApplicantReviewPanel, type ReviewApplicant } from "@/components/employer/ApplicantReviewPanel";
import { supabase } from "@/integrations/supabase/client";
import { getActiveCompanyId, fetchMyCompanies } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/interviews")({
  head: () => ({ meta: [{ title: "Interviews · JobsKart" }] }),
  component: Page,
});

// Same shape (and same columns) the job applicants page fetches — this page
// just adds job_id and jobs.title, since it spans every job for the company
// instead of one, and is pre-filtered to status = "interview".
type Application = {
  id: string;
  status: string;
  created_at: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  candidate_id: string;
  job_id: string;
  jobs: { title: string } | null;
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

function Page() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<Application | null>(null);
  // ApplicantCard always renders a select checkbox; this page has no bulk
  // action bar, so selection is just local UI state (no-op beyond toggling).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    let cid = getActiveCompanyId();
    if (!cid) {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const ms = await fetchMyCompanies(u.user.id);
        cid = ms[0]?.company_id ?? null;
      }
    }
    if (!cid) { setApps([]); setLoading(false); return; }

    // Same data source as the job applicants page (the applications table,
    // status set by "Move to Interview" there) — scoped across every job for
    // this company instead of a single job, and filtered to status=interview.
    const { data, error } = await supabase
      .from("applications")
      .select(
        "id, status, created_at, cover_note, expected_salary, available_from, candidate_id, job_id, jobs!inner (title, company_id), profiles!candidate_id (full_name, email, mobile, avatar_url, city)",
      )
      .eq("jobs.company_id", cid)
      .eq("status", "interview")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);

    const rows = ((data || []) as unknown) as Array<Omit<Application, "candidate_profiles" | "education">>;
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

  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: string) => {
    // Moving a card off "interview" (e.g. to Hired/Rejected) means it no
    // longer belongs on this page, so drop it locally right away.
    if (status !== "interview") setApps((prev) => prev.filter((a) => a.id !== id));
    setReviewing((r) => (r && r.id === id ? { ...r, status } : r));
    const { error } = await supabase.from("applications").update({ status } as never).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
  };

  const toReviewApplicant = (a: Application): ReviewApplicant => ({
    id: a.id,
    candidate_id: a.candidate_id,
    status: a.status,
    created_at: a.created_at,
    cover_note: a.cover_note,
    expected_salary: a.expected_salary,
    available_from: a.available_from,
    profiles: a.profiles,
    candidate_profiles: a.candidate_profiles
      ? {
          profile_slug: a.candidate_profiles.profile_slug ?? null,
          headline: a.candidate_profiles.headline,
          last_role: a.candidate_profiles.last_role,
          skills: a.candidate_profiles.skills,
        }
      : null,
  });

  return (
    <EmployerShell title="Interviews" subtitle="Applicants currently in your interview pipeline">
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      ) : !apps.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No interviews scheduled yet. Schedule from an applicant's card.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {apps.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
              <Link
                to="/employer/jobs/$jobId/applicants"
                params={{ jobId: a.job_id }}
                className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-primary"
              >
                <span className="truncate">{a.jobs?.title || "Job"}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </Link>
              <ApplicantCard
                applicant={a}
                selected={selectedIds.has(a.id)}
                onToggleSelect={() =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                    return next;
                  })
                }
                onStatusChange={(status) => updateStatus(a.id, status)}
                onView={() => setReviewing(a)}
              />
            </div>
          ))}
        </div>
      )}

      {reviewing && (
        <ApplicantReviewPanel
          applicant={toReviewApplicant(reviewing)}
          onClose={() => setReviewing(null)}
          onStatusChange={(status) => updateStatus(reviewing.id, status)}
        />
      )}
    </EmployerShell>
  );
}

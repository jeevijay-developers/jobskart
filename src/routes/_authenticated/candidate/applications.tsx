import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Eye, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo, formatSalary } from "@/lib/format";
import { InterviewInfo, type Interview } from "@/components/candidate/InterviewInfo";
import { ViewApplicationDialog } from "@/components/candidate/ViewApplicationDialog";

export const Route = createFileRoute("/_authenticated/candidate/applications")({
  head: () => ({ meta: [{ title: "My Applications · JobsKart" }] }),
  component: ApplicationsPage,
});

const TOP_TABS = ["all", "shortlisted", "interview"] as const;
type TopTab = (typeof TOP_TABS)[number];
const TOP_TAB_LABELS: Record<TopTab, string> = {
  all: "All",
  shortlisted: "Shortlisted",
  interview: "Interview",
};

// Hired and Rejected are outcomes that follow the interview stage, so they live as
// sub-filters inside the Interview tab rather than as their own top-level tabs.
const INTERVIEW_SUB_TABS = ["in_progress", "hired", "rejected"] as const;
type InterviewSubTab = (typeof INTERVIEW_SUB_TABS)[number];
const INTERVIEW_SUB_TAB_LABELS: Record<InterviewSubTab, string> = {
  in_progress: "In progress",
  hired: "Hired",
  rejected: "Rejected",
};
const INTERVIEW_SUB_TAB_STATUS: Record<InterviewSubTab, string> = {
  in_progress: "interview",
  hired: "hired",
  rejected: "rejected",
};

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
  expected_salary: number | null;
  available_from: string | null;
  cover_note: string | null;
  jobs: {
    id: string;
    title: string;
    city: string | null;
    min_salary: number | null;
    max_salary: number | null;
    salary_period: string | null;
    companies: { name: string } | null;
  } | null;
  interviews: Interview[] | null;
};

function ApplicationsPage() {
  const [tab, setTab] = useState<TopTab>("all");
  const [interviewSubTab, setInterviewSubTab] = useState<InterviewSubTab>("in_progress");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    setUserId(uid);
    const { data, error } = await supabase
      .from("applications")
      .select(
        "id, status, created_at, expected_salary, available_from, cover_note, jobs (id, title, city, min_salary, max_salary, salary_period, companies (name)), interviews (id, scheduled_at, duration_min, mode, provider, status, location, meeting_url, notes)",
      )
      .eq("candidate_id", uid)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as unknown as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Counts per underlying status, regardless of how tabs group them — "All" always
  // aggregates every status (including Applied and Withdrawn, which have no
  // dedicated top-level tab of their own).
  const counts = useMemo(() => {
    const c = { all: rows.length, shortlisted: 0, interview: 0, hired: 0, rejected: 0 };
    for (const r of rows) {
      if (r.status === "shortlisted") c.shortlisted++;
      else if (r.status === "interview") c.interview++;
      else if (r.status === "hired") c.hired++;
      else if (r.status === "rejected") c.rejected++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "shortlisted") return rows.filter((r) => r.status === "shortlisted");
    const wantedStatus = INTERVIEW_SUB_TAB_STATUS[interviewSubTab];
    return rows.filter((r) => r.status === wantedStatus);
  }, [rows, tab, interviewSubTab]);

  return (
    <CandidateShell
      title="My applications"
      subtitle="Track every job you've applied to in one place."
    >
      <div
        className={`flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 ${tab === "interview" ? "mb-2" : "mb-5"}`}
      >
        {TOP_TABS.map((t) => {
          const count =
            t === "all"
              ? counts.all
              : t === "shortlisted"
                ? counts.shortlisted
                : counts.interview + counts.hired + counts.rejected;
          return (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === "interview") setInterviewSubTab("in_progress");
              }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/70 hover:bg-surface"
              }`}
            >
              {TOP_TAB_LABELS[t]} {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
            </button>
          );
        })}
      </div>

      {tab === "interview" && (
        <div className="mb-5 flex flex-wrap gap-1.5 pl-1">
          {INTERVIEW_SUB_TABS.map((s) => {
            const count = counts[s === "in_progress" ? "interview" : s];
            return (
              <button
                key={s}
                onClick={() => setInterviewSubTab(s)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  interviewSubTab === s
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border bg-card text-foreground/70 hover:border-primary/40"
                }`}
              >
                {INTERVIEW_SUB_TAB_LABELS[s]}{" "}
                {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Briefcase className="mb-3 h-7 w-7 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No applications yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse jobs and apply to start tracking responses.
          </p>
          <Link
            to="/jobs"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            Browse jobs
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: a.jobs?.id || "" }}
                      className="text-base font-semibold text-foreground hover:text-primary"
                    >
                      {a.jobs?.title || "Job removed"}
                    </Link>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusStyle[a.status] || "bg-surface text-muted-foreground"}`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {a.jobs?.companies?.name || "Confidential"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-foreground/70">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {a.jobs?.city || "—"}
                    </span>
                    <span>
                      {formatSalary(
                        a.jobs?.min_salary,
                        a.jobs?.max_salary,
                        a.jobs?.salary_period || "monthly",
                      )}
                    </span>
                    <span>Applied {timeAgo(a.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setReviewing(a)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface"
                >
                  <Eye className="h-3.5 w-3.5" /> View application
                </button>
              </div>

              {a.interviews && a.interviews.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {a.interviews.length > 1 ? "Interviews" : "Interview"}
                  </p>
                  {[...a.interviews]
                    .sort(
                      (x, y) =>
                        new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime(),
                    )
                    .map((iv) => (
                      <InterviewInfo key={iv.id} interview={iv} />
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reviewing && userId && (
        <ViewApplicationDialog
          open={!!reviewing}
          onClose={() => setReviewing(null)}
          userId={userId}
          application={reviewing}
          jobTitle={reviewing.jobs?.title || "Job removed"}
        />
      )}
    </CandidateShell>
  );
}

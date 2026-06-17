import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/saved")({
  head: () => ({ meta: [{ title: "Saved Jobs · JobsKart" }] }),
  component: SavedJobsPage,
});

function SavedJobsPage() {
  const [jobs, setJobs] = useState<JobCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      const { data } = await supabase
        .from("saved_jobs")
        .select(
          "job_id, jobs (id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified))",
        )
        .eq("user_id", uid)
        .order("created_at", { ascending: false });

      type R = { jobs: JobCardData | null };
      const list = ((data as unknown as R[]) || []).map((r) => r.jobs).filter((j): j is JobCardData => !!j);
      setJobs(list);
      setLoading(false);
    })();
  }, []);

  return (
    <CandidateShell title="Saved jobs" subtitle="Jobs you've bookmarked to apply later.">
      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Bookmark className="mb-3 h-7 w-7 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No saved jobs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tap the bookmark icon on any job to save it for later.</p>
          <Link to="/jobs" className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Browse jobs
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} />
          ))}
        </div>
      )}
    </CandidateShell>
  );
}

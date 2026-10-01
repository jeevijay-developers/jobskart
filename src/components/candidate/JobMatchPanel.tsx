import { useEffect, useMemo, useState } from "react";
import { Target, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeJobMatch, type MatchJob } from "@/lib/resumeBuilder/jobMatch";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";

// "Tailor to this job": pick a job you applied to or saved on JobsKart and see
// how well this resume covers its required skills. Suggestions only — nothing
// is edited automatically, so keywords are never stuffed in for you.
export function JobMatchPanel({ resume }: { resume: ResumeSchema }) {
  const [jobs, setJobs] = useState<MatchJob[]>([]);
  const [jobId, setJobId] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const cols = "id, title, skills, certifications";
      const [apps, saved] = await Promise.all([
        supabase.from("applications").select(`job_id, jobs (${cols})`).eq("candidate_id", u.user.id).limit(30),
        supabase.from("saved_jobs").select(`job_id, jobs (${cols})`).eq("user_id", u.user.id).limit(30),
      ]);
      const map = new Map<string, MatchJob>();
      for (const row of [...(apps.data ?? []), ...(saved.data ?? [])] as unknown as { jobs: MatchJob | null }[]) {
        if (row.jobs) map.set(row.jobs.id, row.jobs);
      }
      setJobs([...map.values()]);
    })();
  }, []);

  const job = jobs.find((j) => j.id === jobId);
  const result = useMemo(() => (job ? computeJobMatch(resume, job) : null), [resume, job]);

  if (jobs.length === 0) {
    return <p className="text-xs text-muted-foreground">Apply to or save a job on JobsKart to see how well your resume matches it.</p>;
  }

  const tone = !result ? "" : result.score >= 70 ? "text-success" : result.score >= 40 ? "text-warning" : "text-destructive";
  return (
    <div className="space-y-3">
      <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="form-input h-9 w-full text-sm">
        <option value="">Choose a job…</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>{j.title}</option>
        ))}
      </select>
      {result && job && (
        <>
          <div className="flex items-center gap-3">
            <Target className={`h-5 w-5 ${tone}`} />
            <p className={`text-2xl font-bold ${tone}`}>{result.score}%</p>
            <p className="text-xs text-muted-foreground">
              {(job.skills?.length ?? 0) + (job.certifications?.length ?? 0) === 0
                ? "This job lists no specific skills."
                : `${result.matched.length} of ${result.matched.length + result.missing.length} required skills found`}
            </p>
          </div>
          {result.matched.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.matched.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> {k}
                </span>
              ))}
            </div>
          )}
          {result.missing.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-foreground">Missing from your resume</p>
              <div className="flex flex-wrap gap-1.5">
                {result.missing.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                    <AlertCircle className="h-3 w-3" /> {k}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                If you genuinely have these skills, add them on your{" "}
                <a href="/candidate/profile" className="font-medium text-primary hover:underline">Profile</a> or mention them in your summary or experience.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

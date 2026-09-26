import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck, Briefcase, GraduationCap, IndianRupee, MapPin, Rocket, Share2 } from "lucide-react";
import { formatExperience, formatSalary, jobTypeLabel, timeAgo, workModeLabel } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useSavedJob } from "@/hooks/use-saved-job";
import { useShareJob } from "@/hooks/use-share-job";
import { ApplyDialog } from "@/components/candidate/ApplyDialog";
import { Badge } from "@/components/ui/badge";

export type JobCardData = {
  id: string;
  title: string;
  city: string | null;
  state: string | null;
  locality: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  job_type: string;
  work_mode: string;
  min_experience_years: number | null;
  max_experience_years: number | null;
  education: string | null;
  skills: string[] | null;
  created_at: string;
  pay_type?: string | null;
  avg_incentive_monthly?: number | null;
  company_id?: string;
  companies?: { name: string; is_verified: boolean | null } | null;
  // Set only by the "Recommended" sort (feed_jobs RPC) — transparently shows
  // candidates why a job is prominent, never a hidden ranking boost.
  boosted?: boolean;
};

export function JobCard({
  job,
  onApplied,
  variant = "full",
}: {
  job: JobCardData;
  onApplied?: () => void | Promise<void>;
  /**
   * "discovery": for result sets already guaranteed apply-eligible (the
   * candidate feed RPC excludes applied jobs before they ever reach the
   * client) — skips the per-card `applications` lookup entirely, so a page
   * of N cards doesn't fire N requests just to learn what the feed already
   * knows. "full" (default) is for contexts where a card can legitimately
   * already be applied to (Saved Jobs, a company's public job list, similar
   * jobs) and still needs to show that state.
   */
  variant?: "discovery" | "full";
}) {
  const navigate = useNavigate();
  const location = [job.locality, job.city].filter(Boolean).join(", ") || job.city || "India";

  const [userId, setUserId] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const { saved, toggle: toggleSaved } = useSavedJob(job.id, userId);
  const { share } = useShareJob();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.session?.user.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (variant === "discovery" || !userId) {
      setApplied(false);
      return;
    }
    supabase
      .from("applications")
      .select("id")
      .eq("job_id", job.id)
      .eq("candidate_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setApplied(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, userId, variant]);

  const requireAuth = () => {
    navigate({ to: "/auth", search: { tab: "candidate" } as never });
  };

  const handleApplyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return requireAuth();
    if (applied) return;
    setApplyOpen(true);
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return requireAuth();
    toggleSaved();
  };

  const handleShareClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    share(job, userId);
  };

  return (
    <div className="group rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="truncate text-base font-bold text-foreground group-hover:text-primary">{job.title}</h3>
                {job.boosted && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    <Rocket className="h-3 w-3" /> Boosted
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(job.created_at)}</span>
              </div>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {job.companies?.name || "Confidential employer"}
                {job.companies?.is_verified ? <span className="ml-1.5 text-xs text-success">✓ Verified</span> : null}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <span className="flex items-center gap-1.5 font-semibold tabular-nums text-foreground">
              <IndianRupee className="h-3.5 w-3.5 text-primary" />
              {formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")}
              {job.pay_type === "fixed_incentive" && job.avg_incentive_monthly
                ? ` + up to ₹${job.avg_incentive_monthly.toLocaleString("en-IN")} incentive`
                : ""}
            </span>
            <span className="flex items-center gap-1.5 text-foreground/80">
              <MapPin className="h-3.5 w-3.5 text-primary" /> {location}
            </span>
            <span className="flex items-center gap-1.5 text-foreground/80">
              <Briefcase className="h-3.5 w-3.5 text-primary" />
              {formatExperience(job.min_experience_years, job.max_experience_years)}
            </span>
            {/* Hidden on mobile so a job card scans in a single pass — at most 3 meta items there. */}
            <span className="hidden items-center gap-1.5 text-foreground/80 sm:flex">
              <GraduationCap className="h-3.5 w-3.5 text-primary" /> {job.education || "Any qualification"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge variant="info" className="rounded-full px-2.5 py-1 text-xs">{jobTypeLabel(job.job_type)}</Badge>
            <Badge variant="muted" className="rounded-full px-2.5 py-1 text-xs">{workModeLabel(job.work_mode)}</Badge>
            {(job.skills || []).slice(0, 3).map((s) => (
              <span key={s} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                {s}
              </span>
            ))}
          </div>
        </Link>

        <div className="flex shrink-0 gap-2 sm:w-36 sm:flex-col">
          <button
            type="button"
            onClick={handleApplyClick}
            disabled={applied}
            className="h-10 min-w-0 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
          >
            <span className="truncate">{applied ? "Applied" : "Apply Now"}</span>
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            aria-label={saved ? "Unsave job" : "Save job"}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border text-sm font-semibold sm:w-auto sm:px-4 ${
              saved ? "border-primary text-primary" : "border-border text-foreground hover:bg-surface"
            }`}
          >
            {saved ? <BookmarkCheck className="h-4 w-4 shrink-0" /> : <Bookmark className="h-4 w-4 shrink-0" />}
            <span className="hidden sm:inline">{saved ? "Saved" : "Save Job"}</span>
          </button>
          <button
            type="button"
            onClick={handleShareClick}
            aria-label="Share job"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-surface sm:w-auto sm:px-4"
          >
            <Share2 className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>

      {userId && job.company_id && (
        <ApplyDialog
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          userId={userId}
          job={{
            id: job.id,
            company_id: job.company_id,
            title: job.title,
            min_salary: job.min_salary,
            max_salary: job.max_salary,
          }}
          onApplied={() => {
            setApplied(true);
            setApplyOpen(false);
            void onApplied?.();
          }}
        />
      )}
    </div>
  );
}

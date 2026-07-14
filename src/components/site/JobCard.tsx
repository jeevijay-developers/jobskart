import { Link } from "@tanstack/react-router";
import { Briefcase, GraduationCap, IndianRupee, MapPin } from "lucide-react";
import { formatExperience, formatSalary, jobTypeLabel, timeAgo, workModeLabel } from "@/lib/format";

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
  companies?: { name: string; is_verified: boolean | null } | null;
};

export function JobCard({ job }: { job: JobCardData }) {
  const location = [job.locality, job.city].filter(Boolean).join(", ") || job.city || "India";
  return (
    <Link
      to="/jobs/$jobId"
      params={{ jobId: job.id }}
      className="group block rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">{job.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {job.companies?.name || "Confidential employer"}
            {job.companies?.is_verified ? <span className="ml-1.5 text-xs text-success">✓ Verified</span> : null}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(job.created_at)}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <span className="flex items-center gap-1.5 text-foreground/80">
          <IndianRupee className="h-3.5 w-3.5 text-primary" />
          {formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")}
        </span>
        <span className="flex items-center gap-1.5 text-foreground/80">
          <MapPin className="h-3.5 w-3.5 text-primary" /> {location}
        </span>
        <span className="flex items-center gap-1.5 text-foreground/80">
          <Briefcase className="h-3.5 w-3.5 text-primary" />
          {formatExperience(job.min_experience_years, job.max_experience_years)}
        </span>
        <span className="flex items-center gap-1.5 text-foreground/80">
          <GraduationCap className="h-3.5 w-3.5 text-primary" /> {job.education || "Any qualification"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">{jobTypeLabel(job.job_type)}</span>
        <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-foreground/70">{workModeLabel(job.work_mode)}</span>
        {(job.skills || []).slice(0, 3).map((s) => (
          <span key={s} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
            {s}
          </span>
        ))}
      </div>
    </Link>
  );
}

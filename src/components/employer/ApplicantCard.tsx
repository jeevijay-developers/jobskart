import { Briefcase, Clock, Eye, GraduationCap, MapPin } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { applicantStatusLabel, applicantStatusTone } from "@/lib/applicantStatus";
import { ApplicantStatusMenu } from "./ApplicantStatusMenu";

export type ApplicantCardData = {
  id: string;
  status: string;
  created_at: string;
  profiles: { full_name: string | null; city: string | null } | null;
  candidate_profiles: {
    headline: string | null;
    last_role: string | null;
    years_experience: number | null;
    experience_status: string | null;
    skills: string[] | null;
  } | null;
  education: { level: string; institute: string | null } | null;
};

type Props = {
  applicant: ApplicantCardData;
  selected: boolean;
  onToggleSelect: () => void;
  onStatusChange: (status: string) => void;
  onView: () => void;
  matchScore?: number | null;
  tags?: string[];
};

export function ApplicantCard({ applicant: a, selected, onToggleSelect, onStatusChange, onView, matchScore, tags }: Props) {
  const cp = a.candidate_profiles;
  const experienceLabel = cp
    ? cp.experience_status === "fresher"
      ? "Fresher"
      : cp.experience_status === "student"
        ? "Student"
        : `${cp.years_experience || 0} yr${cp.years_experience === 1 ? "" : "s"} exp`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-2 h-4 w-4 shrink-0 rounded border-border accent-primary"
          aria-label={`Select ${a.profiles?.full_name || "candidate"}`}
        />
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
          {(a.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onView} className="truncate text-sm font-semibold text-foreground hover:text-primary">
              {a.profiles?.full_name || "Candidate"}
            </button>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${applicantStatusTone(a.status)}`}>
              {applicantStatusLabel(a.status)}
            </span>
            {typeof matchScore === "number" && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                matchScore >= 80 ? "bg-success-light text-success" : matchScore >= 60 ? "bg-warning-light text-warning" : "bg-surface text-muted-foreground"
              }`}>
                {matchScore}% Match
              </span>
            )}
            {(tags ?? []).slice(0, 3).map((t) => (
              <span key={t} className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-medium text-primary">{t}</span>
            ))}
          </div>
          {(cp?.headline || cp?.last_role) && (
            <p className="truncate text-xs text-muted-foreground">{cp?.headline || cp?.last_role}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/70">
            {a.profiles?.city && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {a.profiles.city}
              </span>
            )}
            {experienceLabel && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> {experienceLabel}
              </span>
            )}
            {a.education && (
              <span className="flex items-center gap-1">
                <GraduationCap className="h-3 w-3" /> {a.education.level}
                {a.education.institute ? ` · ${a.education.institute}` : ""}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Applied {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
            </span>
          </div>
          {cp?.skills && cp.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {cp.skills.slice(0, 5).map((s) => (
                <span key={s} className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-foreground/70">
                  {s}
                </span>
              ))}
              {cp.skills.length > 5 && (
                <span className="text-[10px] text-muted-foreground">+{cp.skills.length - 5} more</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ApplicantStatusMenu value={a.status} onChange={onStatusChange} />
          <button
            onClick={onView}
            aria-label={`View ${a.profiles?.full_name || "candidate"}`}
            title="View"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border hover:bg-surface"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

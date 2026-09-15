import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mail, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCandidateResume, type ResumeFile } from "@/lib/candidateResume";
import { ApplicationFormFields } from "@/components/candidate/ApplicationFormFields";
import { ApplicantStatusMenu } from "./ApplicantStatusMenu";

type Experience = {
  id: string;
  job_title: string;
  company_name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
};

type Education = {
  id: string;
  level: string;
  institute: string | null;
  board_or_university: string | null;
  year_of_passing: number | null;
};

export type ReviewApplicant = {
  id: string;
  candidate_id: string;
  status: string;
  created_at: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  profiles: { full_name: string | null; email: string | null; mobile: string | null; city: string | null } | null;
  candidate_profiles: {
    profile_slug: string | null;
    headline: string | null;
    last_role: string | null;
    skills: string[] | null;
  } | null;
};

type Props = {
  applicant: ReviewApplicant;
  onClose: () => void;
  onStatusChange: (status: string) => void;
};

function formatMonthYear(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function ApplicantReviewPanel({ applicant: a, onClose, onStatusChange }: Props) {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [resume, setResume] = useState<ResumeFile | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [viewingResume, setViewingResume] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingDetails(true);
      const [expRes, eduRes, resumeFile] = await Promise.all([
        supabase
          .from("candidate_experiences")
          .select("id, job_title, company_name, start_date, end_date, is_current")
          .eq("user_id", a.candidate_id)
          .order("start_date", { ascending: false }),
        supabase
          .from("candidate_education")
          .select("id, level, institute, board_or_university, year_of_passing")
          .eq("user_id", a.candidate_id)
          .order("year_of_passing", { ascending: false, nullsFirst: false }),
        getCandidateResume(a.candidate_id),
      ]);
      if (cancelled) return;
      setExperiences((expRes.data || []) as Experience[]);
      setEducation((eduRes.data || []) as Education[]);
      setResume(resumeFile);
      setLoadingDetails(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [a.candidate_id]);

  const viewResume = async () => {
    if (!resume) return;
    setViewingResume(true);
    const { data, error } = await supabase.storage.from("candidate-docs").createSignedUrl(resume.path, 3600);
    setViewingResume(false);
    if (error) return toast.error(error.message);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const cp = a.candidate_profiles;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-foreground/40" onClick={onClose} />
      <aside className="w-full max-w-md overflow-y-auto bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-primary-light text-base font-semibold text-primary">
              {(a.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-bold">{a.profiles?.full_name || "Candidate"}</h3>
              {(cp?.headline || cp?.last_role) && (
                <p className="text-xs text-muted-foreground">{cp?.headline || cp?.last_role}</p>
              )}
              <p className="text-xs text-muted-foreground">{a.profiles?.city}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-surface">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</p>
          <ApplicantStatusMenu value={a.status} onChange={onStatusChange} className="w-full" />
        </div>

        <div className="mt-5 space-y-2 text-sm">
          {a.profiles?.email && (
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" /> {a.profiles.email}
            </p>
          )}
          {a.profiles?.mobile && (
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" /> {a.profiles.mobile}
            </p>
          )}
        </div>

        {cp?.skills && cp.skills.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Skills</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cp.skills.map((s) => (
                <span key={s} className="rounded-full bg-surface px-2.5 py-1 text-xs text-foreground/80">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {!loadingDetails && experiences.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Experience</p>
            <div className="mt-2 space-y-2">
              {experiences.map((e) => (
                <div key={e.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
                  <p className="font-medium">
                    {e.job_title} · {e.company_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMonthYear(e.start_date)} – {e.is_current ? "Present" : formatMonthYear(e.end_date)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loadingDetails && education.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Education</p>
            <div className="mt-2 space-y-2">
              {education.map((e) => (
                <div key={e.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
                  <p className="font-medium">{e.level}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.institute, e.board_or_university, e.year_of_passing].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Submitted application</p>
          <ApplicationFormFields
            readOnly
            resumeLabel={resume?.name || ""}
            onViewResume={resume ? viewResume : undefined}
            viewingResume={viewingResume}
            expectedSalary={a.expected_salary != null ? String(a.expected_salary) : ""}
            availableFrom={a.available_from || ""}
            coverNote={a.cover_note || ""}
          />
        </div>

        {cp?.profile_slug ? (
          <Link
            to="/u/$slug"
            params={{ slug: cp.profile_slug }}
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
  );
}

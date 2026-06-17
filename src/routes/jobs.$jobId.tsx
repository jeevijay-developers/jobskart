import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  GraduationCap,
  IndianRupee,
  Loader2,
  MapPin,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";
import { formatExperience, formatSalary, jobTypeLabel, timeAgo, workModeLabel } from "@/lib/format";

export const Route = createFileRoute("/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job · JobsKart" }] }),
  component: JobDetailPage,
});

type JobDetail = {
  id: string;
  company_id: string;
  title: string;
  description: string;
  city: string | null;
  state: string | null;
  locality: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  fixed_pay: boolean | null;
  incentives_text: string | null;
  job_type: string;
  work_mode: string;
  shift: string | null;
  min_experience_years: number | null;
  max_experience_years: number | null;
  education: string | null;
  english_level: string | null;
  skills: string[] | null;
  perks: string[] | null;
  openings: number | null;
  walkin: boolean | null;
  walkin_details: string | null;
  created_at: string;
  expires_at: string | null;
  companies: { name: string; is_verified: boolean | null; industry: string | null; primary_city: string | null; description: string | null } | null;
};

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"overview" | "company">("overview");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, company_id, title, description, city, state, locality, min_salary, max_salary, salary_period, fixed_pay, incentives_text, job_type, work_mode, shift, min_experience_years, max_experience_years, education, english_level, skills, perks, openings, walkin, walkin_details, created_at, expires_at, companies (name, is_verified, industry, primary_city, description)",
        )
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Job not found");
        setLoading(false);
        return;
      }
      setJob(data as unknown as JobDetail);

      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      setUserId(uid);
      if (uid) {
        const [{ data: app }, { data: sav }] = await Promise.all([
          supabase.from("applications").select("id").eq("job_id", jobId).eq("candidate_id", uid).maybeSingle(),
          supabase.from("saved_jobs").select("id").eq("job_id", jobId).eq("user_id", uid).maybeSingle(),
        ]);
        if (cancelled) return;
        setApplied(!!app);
        setSaved(!!sav);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const handleApply = async () => {
    if (!userId) {
      navigate({ to: "/auth", search: { tab: "candidate" } });
      return;
    }
    if (!job) return;
    setApplying(true);
    const { error } = await supabase.from("applications").insert({
      job_id: job.id,
      candidate_id: userId,
      company_id: job.company_id,
    });
    setApplying(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setApplied(true);
    toast.success("Application sent!");
  };

  const toggleSave = async () => {
    if (!userId) {
      navigate({ to: "/auth", search: { tab: "candidate" } });
      return;
    }
    if (!job) return;
    if (saved) {
      await supabase.from("saved_jobs").delete().eq("job_id", job.id).eq("user_id", userId);
      setSaved(false);
      toast.success("Removed from saved");
    } else {
      const { error } = await supabase.from("saved_jobs").insert({ job_id: job.id, user_id: userId });
      if (error) {
        toast.error(error.message);
        return;
      }
      setSaved(true);
      toast.success("Saved");
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="flex min-h-screen flex-col bg-surface">
        <Navbar />
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-foreground">Job unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">This job may have been closed or removed.</p>
          <Link to="/jobs" className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Browse all jobs
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const location = [job.locality, job.city, job.state].filter(Boolean).join(", ");

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>

        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="bg-gradient-to-br from-primary-light to-card p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{job.title}</h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-foreground/80">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="font-medium">{job.companies?.name || "Confidential employer"}</span>
                  {job.companies?.is_verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-xs font-semibold text-success">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">Posted {timeAgo(job.created_at)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={toggleSave}
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-surface"
                >
                  {saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                  {saved ? "Saved" : "Save"}
                </button>
                <button
                  onClick={handleApply}
                  disabled={applied || applying}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-success disabled:text-white"
                >
                  {applying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : applied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Applied
                    </>
                  ) : (
                    "Apply now"
                  )}
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={IndianRupee} label="Salary" value={formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")} />
              <Stat icon={MapPin} label="Location" value={location || "India"} />
              <Stat icon={Briefcase} label="Experience" value={formatExperience(job.min_experience_years, job.max_experience_years)} />
              <Stat icon={Users} label="Openings" value={`${job.openings ?? 1}`} />
            </div>
          </div>

          <div className="flex gap-1 border-b border-border px-2 sm:px-6">
            {(["overview", "company"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                  tab === t ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "company" ? "About company" : "Job overview"}
                {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>

          <div className="p-6 sm:p-8">
            {tab === "overview" ? (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  <Pill>{jobTypeLabel(job.job_type)}</Pill>
                  <Pill>{workModeLabel(job.work_mode)}</Pill>
                  {job.shift ? <Pill>{`${job.shift} shift`}</Pill> : null}
                  {job.fixed_pay ? <Pill tone="success">Fixed pay</Pill> : null}
                </div>

                <Block title="Job description">
                  <p className="whitespace-pre-line text-sm leading-6 text-foreground/80">{job.description || "No description provided."}</p>
                </Block>

                <div className="grid gap-6 sm:grid-cols-2">
                  <Block title="Requirements">
                    <ul className="space-y-2 text-sm text-foreground/80">
                      <Req icon={GraduationCap} label="Education" value={job.education || "Any"} />
                      <Req icon={Briefcase} label="Experience" value={formatExperience(job.min_experience_years, job.max_experience_years)} />
                      {job.english_level ? <Req icon={CheckCircle2} label="English" value={job.english_level} /> : null}
                    </ul>
                  </Block>
                  {(job.skills?.length || 0) > 0 && (
                    <Block title="Skills required">
                      <div className="flex flex-wrap gap-1.5">
                        {job.skills!.map((s) => (
                          <span key={s} className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
                            {s}
                          </span>
                        ))}
                      </div>
                    </Block>
                  )}
                </div>

                {(job.perks?.length || 0) > 0 && (
                  <Block title="Perks & benefits">
                    <div className="flex flex-wrap gap-2">
                      {job.perks!.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-medium text-success">
                          <CheckCircle2 className="h-3 w-3" /> {p}
                        </span>
                      ))}
                    </div>
                  </Block>
                )}

                {job.walkin && (
                  <Block title="Walk-in details">
                    <p className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-foreground/80">
                      <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                      {job.walkin_details || "Walk-in interview available. Contact employer for details."}
                    </p>
                  </Block>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">{job.companies?.name || "Confidential employer"}</h2>
                {job.companies?.industry ? <p className="text-sm text-muted-foreground">{job.companies.industry} · {job.companies.primary_city || ""}</p> : null}
                <p className="text-sm leading-6 text-foreground/80">{job.companies?.description || "Company details coming soon."}</p>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof IndianRupee; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "success" }) {
  const cls = tone === "success" ? "bg-success-light text-success" : "bg-surface text-foreground/80";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}
function Req({ icon: Icon, label, value }: { icon: typeof IndianRupee; label: string; value: string }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <span>
        <span className="text-muted-foreground">{label}: </span>
        <span className="font-medium text-foreground">{value}</span>
      </span>
    </li>
  );
}

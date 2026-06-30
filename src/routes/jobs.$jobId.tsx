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
  Clock,
  Flag,
  Gift,
  GraduationCap,
  IndianRupee,
  Languages,
  Loader2,
  MapPin,
  Moon,
  Share2,
  Sparkles,
  Sun,
  Sunrise,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { ApplyDialog } from "@/components/candidate/ApplyDialog";
import { ReportJobDialog } from "@/components/candidate/ReportJobDialog";
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
  category: string | null;
  companies: {
    name: string;
    is_verified: boolean | null;
    industry: string | null;
    primary_city: string | null;
    description: string | null;
    logo_url: string | null;
  } | null;
};

function JobDetailPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [tab, setTab] = useState<"overview" | "company">("overview");
  const [applyOpen, setApplyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [applicantCount, setApplicantCount] = useState<number>(0);
  const [similar, setSimilar] = useState<JobCardData[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      window.scrollTo({ top: 0 });
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, company_id, title, description, city, state, locality, min_salary, max_salary, salary_period, fixed_pay, incentives_text, job_type, work_mode, shift, min_experience_years, max_experience_years, education, english_level, skills, perks, openings, walkin, walkin_details, created_at, expires_at, category, companies (name, is_verified, industry, primary_city, description, logo_url)",
        )
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Job not found");
        setLoading(false);
        return;
      }
      const jobData = data as unknown as JobDetail;
      setJob(jobData);
      if (typeof document !== "undefined") {
        document.title = `${jobData.title} · ${jobData.companies?.name || "JobsKart"}`;
      }

      const [{ count }, { data: sess }, { data: sim }] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("job_id", jobId),
        supabase.auth.getSession(),
        supabase
          .from("jobs")
          .select(
            "id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)",
          )
          .eq("status", "active")
          .neq("id", jobId)
          .eq(jobData.category ? "category" : "job_type", jobData.category || jobData.job_type)
          .limit(4),
      ]);
      if (cancelled) return;
      setApplicantCount(count || 0);
      setSimilar((sim || []) as unknown as JobCardData[]);

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

  const handleApply = () => {
    if (!userId) {
      navigate({ to: "/auth", search: { tab: "candidate" } });
      return;
    }
    if (!job || applied) return;
    setApplyOpen(true);
  };

  const handleApplied = () => {
    setApplied(true);
    setApplicantCount((c) => c + 1);
  };

  const toggleSave = async () => {
    if (!job) return;
    if (!userId) {
      toast.info("Sign in to save this job to your list");
      navigate({
        to: "/auth",
        search: { tab: "candidate", redirect: `/jobs/${job.id}` } as never,
      });
      return;
    }
    if (savingBookmark) return;
    const next = !saved;
    setSaved(next); // optimistic
    setSavingBookmark(true);
    try {
      if (next) {
        const { error } = await supabase
          .from("saved_jobs")
          .insert({ job_id: job.id, user_id: userId });
        // Ignore duplicate-key (already saved in another tab)
        if (error && !/duplicate key|unique/i.test(error.message)) throw error;
        toast.success("Saved to your list", {
          action: { label: "View saved", onClick: () => navigate({ to: "/candidate/saved" as never }) },
        });
      } else {
        const { error } = await supabase
          .from("saved_jobs")
          .delete()
          .eq("job_id", job.id)
          .eq("user_id", userId);
        if (error) throw error;
        toast.success("Removed from saved");
      }
    } catch (err) {
      setSaved(!next); // revert
      toast.error(err instanceof Error ? err.message : "Could not update saved jobs");
    } finally {
      setSavingBookmark(false);
    }
  };


  const handleShare = async () => {
    if (!job) return;
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = `${job.title} at ${job.companies?.name || "a top company"} · ${formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")}`;
    if (typeof navigator !== "undefined" && (navigator as Navigator).share) {
      try {
        await (navigator as Navigator).share({ title: job.title, text, url });
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy link");
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
  const initials = (job.companies?.name || "JK")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const expires = job.expires_at ? new Date(job.expires_at) : null;
  const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">
        <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
              <div className="bg-gradient-to-br from-primary-light to-card p-5 sm:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-card text-base font-bold text-primary sm:h-16 sm:w-16 sm:text-lg">
                      {job.companies?.logo_url ? (
                        <img src={job.companies.logo_url} alt={job.companies.name} className="h-full w-full object-cover" />
                      ) : (
                        initials
                      )}
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl lg:text-3xl">{job.title}</h1>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground/80">
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">{job.companies?.name || "Confidential employer"}</span>
                        {job.companies?.is_verified ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-0.5 text-xs font-semibold text-success">
                            <CheckCircle2 className="h-3 w-3" /> Verified
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Posted {timeAgo(job.created_at)}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {applicantCount} applicant{applicantCount === 1 ? "" : "s"}</span>
                        {daysLeft != null && daysLeft >= 0 ? (
                          <>
                            <span>·</span>
                            <span className={daysLeft <= 3 ? "text-amber font-medium" : ""}>
                              {daysLeft === 0 ? "Closes today" : `${daysLeft}d left to apply`}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <div className="hidden shrink-0 gap-2 sm:flex">
                    <button
                      onClick={handleShare}
                      title="Share"
                      className="grid h-11 w-11 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={toggleSave}
                      disabled={savingBookmark}
                      aria-pressed={saved}
                      aria-label={saved ? "Remove from saved jobs" : "Save this job"}
                      className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-60"
                    >
                      {savingBookmark ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : saved ? (
                        <BookmarkCheck className="h-4 w-4 text-primary" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                      {saved ? "Saved" : "Save"}
                    </button>
                    <button
                      onClick={handleApply}
                      disabled={applied}
                      className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-success disabled:text-white"
                    >
                      {false ? (
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

              <div className="p-5 sm:p-7">
                {tab === "overview" ? (
                  <div className="space-y-6">
                    <div className="flex flex-wrap gap-2">
                      <Pill>{jobTypeLabel(job.job_type)}</Pill>
                      <Pill>{workModeLabel(job.work_mode)}</Pill>
                      {job.shift ? <Pill>{`${job.shift} shift`}</Pill> : null}
                      {job.fixed_pay ? <Pill tone="success">Fixed pay</Pill> : null}
                      {job.incentives_text ? <Pill tone="success">+ Incentives</Pill> : null}
                    </div>

                    <Block title="Job description">
                      <p className="whitespace-pre-line text-sm leading-6 text-foreground/80">
                        {job.description || "No description provided."}
                      </p>
                      {job.incentives_text ? (
                        <p className="mt-3 rounded-lg border border-success/20 bg-success-light/40 p-3 text-sm text-foreground/80">
                          <span className="font-semibold text-success">Incentives: </span>
                          {job.incentives_text}
                        </p>
                      ) : null}
                    </Block>

                    <Block title="Job requirements">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ReqCard
                          icon={Briefcase}
                          label="Experience"
                          value={formatExperience(job.min_experience_years, job.max_experience_years)}
                          hint={(job.min_experience_years ?? 0) === 0 ? "Freshers welcome" : "Relevant experience"}
                        />
                        <ReqCard
                          icon={GraduationCap}
                          label="Education"
                          value={job.education || "Any qualification"}
                        />
                        <ReqCard
                          icon={Languages}
                          label="English"
                          value={job.english_level || "Not required"}
                        />
                        <ReqCard
                          icon={Users}
                          label="Openings"
                          value={`${job.openings ?? 1} position${(job.openings ?? 1) > 1 ? "s" : ""}`}
                        />
                      </div>
                    </Block>

                    <Block title="Skills required">
                      {(job.skills?.length || 0) > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {job.skills!.map((s) => (
                            <span
                              key={s}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary-light px-3 py-1.5 text-xs font-medium text-primary"
                            >
                              <Target className="h-3 w-3" /> {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No specific skills listed — employer is open to candidates with relevant aptitude.</p>
                      )}
                    </Block>

                    <Block title="Shift & work schedule">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <ShiftCard icon={shiftIcon(job.shift)} label="Shift" value={job.shift ? `${job.shift}` : "Flexible"} />
                        <ShiftCard icon={Clock} label="Job type" value={jobTypeLabel(job.job_type)} />
                        <ShiftCard icon={MapPin} label="Work mode" value={workModeLabel(job.work_mode)} />
                      </div>
                    </Block>

                    <Block title="Benefits & perks">
                      {(job.perks?.length || 0) > 0 || job.fixed_pay || job.incentives_text ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {job.fixed_pay ? (
                            <Benefit icon={Wallet} text="Fixed monthly pay" />
                          ) : null}
                          {job.incentives_text ? (
                            <Benefit icon={Sparkles} text={`Incentives: ${job.incentives_text}`} />
                          ) : null}
                          {(job.perks || []).map((p) => (
                            <Benefit key={p} icon={Gift} text={p} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No additional benefits listed.</p>
                      )}
                    </Block>


                    {job.walkin && (
                      <Block title="Walk-in details">
                        <p className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-foreground/80">
                          <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                          {job.walkin_details || "Walk-in interview available. Contact employer for details."}
                        </p>
                      </Block>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                      <span>Job ID: {job.id.slice(0, 8).toUpperCase()}</span>
                      <button
                        type="button"
                        onClick={() => setReportOpen(true)}
                        className="inline-flex items-center gap-1.5 transition hover:text-destructive"
                      >
                        <Flag className="h-3.5 w-3.5" /> Report this job
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface text-base font-bold text-primary">
                        {job.companies?.logo_url ? (
                          <img src={job.companies.logo_url} alt={job.companies.name} className="h-full w-full object-cover" />
                        ) : (
                          initials
                        )}
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">{job.companies?.name || "Confidential employer"}</h2>
                        {job.companies?.industry || job.companies?.primary_city ? (
                          <p className="text-sm text-muted-foreground">
                            {[job.companies?.industry, job.companies?.primary_city].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-foreground/80">{job.companies?.description || "Company details coming soon."}</p>
                  </div>
                )}
              </div>
            </div>

            {similar.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-lg font-bold text-foreground">Similar jobs you may like</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {similar.map((s) => (
                    <JobCard key={s.id} job={s} />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick summary</p>
                <div className="mt-3 space-y-3 text-sm">
                  <Side icon={IndianRupee} label="Salary" value={formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")} />
                  <Side icon={MapPin} label="Location" value={location || "India"} />
                  <Side icon={Briefcase} label="Type" value={`${jobTypeLabel(job.job_type)} · ${workModeLabel(job.work_mode)}`} />
                  <Side icon={GraduationCap} label="Education" value={job.education || "Any"} />
                  <Side icon={Users} label="Openings" value={`${job.openings ?? 1}`} />
                </div>
                <button
                  onClick={handleApply}
                  disabled={applied}
                  className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-success disabled:text-white"
                >
                  {false ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : applied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" /> Applied
                    </>
                  ) : (
                    "Apply now"
                  )}
                </button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={toggleSave}
                    disabled={savingBookmark}
                    aria-pressed={saved}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-60"
                  >
                    {savingBookmark ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : saved ? (
                      <BookmarkCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <Bookmark className="h-4 w-4" />
                    )}
                    {saved ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={handleShare}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-surface"
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-gradient-to-br from-primary-light to-card p-5">
                <p className="text-sm font-semibold text-foreground">Tips to get hired faster</p>
                <ul className="mt-2 space-y-1.5 text-xs text-foreground/80">
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Complete your profile to 100%</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Upload an updated resume</li>
                  <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Apply within 24 hours of posting</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Mobile sticky apply bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <button
            onClick={toggleSave}
            disabled={savingBookmark}
            aria-pressed={saved}
            aria-label={saved ? "Saved" : "Save"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground disabled:opacity-60"
            title={saved ? "Saved" : "Save"}
          >
            {savingBookmark ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saved ? (
              <BookmarkCheck className="h-4 w-4 text-primary" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={handleShare}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground"
            title="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            onClick={handleApply}
            disabled={applied}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm disabled:bg-success disabled:text-white"
          >
            {false ? (
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

      {userId && job && (
        <ApplyDialog
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          userId={userId}
          job={{ id: job.id, company_id: job.company_id, title: job.title, min_salary: job.min_salary, max_salary: job.max_salary }}
          onApplied={handleApplied}
        />
      )}

      {job && (
        <ReportJobDialog jobId={job.id} open={reportOpen} onOpenChange={setReportOpen} />
      )}

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
function ReqCard({ icon: Icon, label, value, hint }: { icon: typeof IndianRupee; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30 hover:bg-primary-light/30">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}
function ShiftCard({ icon: Icon, label, value }: { icon: typeof IndianRupee; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-surface p-3 text-center">
      <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-primary-light text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold capitalize text-foreground">{value}</p>
    </div>
  );
}
function Benefit({ icon: Icon, text }: { icon: typeof IndianRupee; text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-success/20 bg-success-light/40 p-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span className="text-sm text-foreground/85">{text}</span>
    </div>
  );
}
function shiftIcon(shift: string | null) {
  const s = (shift || "").toLowerCase();
  if (s.includes("night")) return Moon;
  if (s.includes("morning") || s.includes("early")) return Sunrise;
  if (s.includes("day")) return Sun;
  return Clock;
}
function Side({ icon: Icon, label, value }: { icon: typeof IndianRupee; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

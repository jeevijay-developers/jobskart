import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark, Briefcase, Calendar, CheckCircle2, FileText, Sparkles, TrendingUp } from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";
import { strengthLabel } from "@/lib/profileStrength";

export const Route = createFileRoute("/_authenticated/candidate/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · JobsKart" }] }),
  component: CandidateDashboard,
});

type Activity = { id: string; type: "applied" | "saved" | "status"; title: string; meta: string; at: string };

function CandidateDashboard() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [strength, setStrength] = useState(0);
  const [counts, setCounts] = useState({ applied: 0, saved: 0, shortlisted: 0, interview: 0, views: 0 });
  const [recommended, setRecommended] = useState<JobCardData[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const { data: cand } = await supabase.from("candidate_profiles").select("*").eq("user_id", uid).maybeSingle();
      if (cand && !cand.onboarding_completed && (cand.profile_strength || 0) < 50) {
        navigate({ to: "/onboarding/candidate" });
        return;
      }

      const [{ data: profile }, apps, saved, jobs, exp] = await Promise.all([
        supabase.from("profiles").select("full_name, city").eq("id", uid).maybeSingle(),
        supabase.from("applications").select("id, status, created_at, job_id, jobs(title, companies(name))").eq("candidate_id", uid).order("created_at", { ascending: false }).limit(8),
        supabase.from("saved_jobs").select("id, created_at, job_id, jobs(title, companies(name))").eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
        supabase.from("jobs").select("id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)").eq("status", "active").order("created_at", { ascending: false }).limit(8),
        supabase.from("candidate_experiences").select("id", { head: true, count: "exact" }).eq("user_id", uid),
      ]);

      setName(profile?.full_name || "there");
      setStrength(cand?.profile_strength || 0);
      setCounts({
        applied: apps.data?.length || 0,
        saved: saved.data?.length || 0,
        shortlisted: apps.data?.filter((a) => a.status === "shortlisted").length || 0,
        interview: apps.data?.filter((a) => a.status === "interview").length || 0,
        views: cand?.profile_views || 0,
      });

      // Recommended: filter by skill overlap if available
      let recs: JobCardData[] = (jobs.data as unknown as JobCardData[]) || [];
      if (cand?.skills?.length) {
        const skills = cand.skills.map((s: string) => s.toLowerCase());
        recs = recs.map((j) => ({ j, score: (j.skills || []).filter((s) => skills.includes(s.toLowerCase())).length }))
          .sort((a, b) => b.score - a.score).map((x) => x.j);
      }
      setRecommended(recs.slice(0, 4));

      const a: Activity[] = [];
      apps.data?.forEach((x) => a.push({ id: `a-${x.id}`, type: "applied", title: (x.jobs as { title?: string })?.title || "Job", meta: `Status: ${x.status}`, at: x.created_at }));
      saved.data?.forEach((x) => a.push({ id: `s-${x.id}`, type: "saved", title: (x.jobs as { title?: string })?.title || "Job", meta: "Saved", at: x.created_at }));
      a.sort((x, y) => +new Date(y.at) - +new Date(x.at));
      setActivity(a.slice(0, 6));

      // Missing items
      const miss: string[] = [];
      if (!cand?.headline) miss.push("Add a headline");
      if (!cand?.resume_url) miss.push("Upload your resume");
      if ((cand?.skills?.length || 0) < 3) miss.push("Add at least 3 skills");
      if (!exp.count) miss.push("Add work experience");
      if (cand?.kyc_status !== "verified") miss.push("Verify your identity");
      if (!cand?.expected_salary) miss.push("Add expected salary");
      setMissing(miss);
    })();
  }, [navigate]);

  const sLabel = strengthLabel(strength);

  return (
    <CandidateShell title={`Welcome back, ${name.split(" ")[0]} 👋`} subtitle="Track your search, applications and recommendations in one place.">
      {/* Hero strength */}
      {strength < 80 && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary-light via-card to-card p-5 shadow-[var(--shadow-card)]">
          <Ring value={strength} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Your profile is <span className={sLabel.color}>{sLabel.label.toLowerCase()}</span></p>
            <p className="text-xs text-muted-foreground">Complete profiles get 3× more responses from employers.</p>
          </div>
          <Link to="/candidate/profile" className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
            Complete profile <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Applications" value={counts.applied} icon={FileText} to="/candidate/applications" />
        <Stat label="Shortlisted" value={counts.shortlisted} icon={CheckCircle2} to="/candidate/applications" />
        <Stat label="Interviews" value={counts.interview} icon={Calendar} to="/candidate/applications" />
        <Stat label="Saved" value={counts.saved} icon={Bookmark} to="/candidate/saved" />
        <Stat label="Profile views" value={counts.views} icon={TrendingUp} to="/candidate/profile" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Recommended */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Recommended for you</h2>
            <Link to="/jobs" className="text-sm font-semibold text-primary hover:underline">View all</Link>
          </div>
          {recommended.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <Briefcase className="mb-3 h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No jobs to show yet. Check back soon.</p>
            </div>
          ) : (
            <div className="grid gap-4">{recommended.map((j) => <JobCard key={j.id} job={j} />)}</div>
          )}
        </div>

        {/* Side: checklist + activity */}
        <div className="space-y-6">
          {missing.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">Finish your profile</h3></div>
              <ul className="mt-3 space-y-2">
                {missing.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm text-foreground/80">
                    <span className="grid h-5 w-5 place-items-center rounded-full border border-border bg-surface"><span className="h-2 w-2 rounded-full bg-amber-500" /></span>
                    {m}
                  </li>
                ))}
              </ul>
              <Link to="/candidate/profile" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                Continue <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Apply to your first job!</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    {a.type === "applied" ? <FileText className="mt-0.5 h-4 w-4 text-primary" /> : <Bookmark className="mt-0.5 h-4 w-4 text-primary" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.meta} · {new Date(a.at).toLocaleDateString()}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </CandidateShell>
  );
}

function Stat({ label, value, icon: Icon, to }: { label: string; value: number; icon: typeof Briefcase; to: string }) {
  return (
    <Link to={to} className="group rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-light text-primary"><Icon className="h-4 w-4" /></span>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}

function Ring({ value }: { value: number }) {
  const r = 28; const c = 2 * Math.PI * r; const off = c - (value / 100) * c;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 70 70" className="h-20 w-20 -rotate-90">
        <circle cx="35" cy="35" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
        <circle cx="35" cy="35" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-primary">{value}%</span>
    </div>
  );
}

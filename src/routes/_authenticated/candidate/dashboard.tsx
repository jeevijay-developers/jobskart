import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Bookmark, Briefcase, FileText, Sparkles, TrendingUp } from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · JobsKart" }] }),
  component: CandidateDashboard,
});

function CandidateDashboard() {
  const [name, setName] = useState("");
  const [strength, setStrength] = useState(40);
  const [counts, setCounts] = useState({ applied: 0, saved: 0 });
  const [recommended, setRecommended] = useState<JobCardData[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const [{ data: profile }, { data: cand }, { count: appCount }, { count: savedCount }, { data: jobs }] = await Promise.all([
        supabase.from("profiles").select("full_name, city, mobile, avatar_url").eq("id", uid).maybeSingle(),
        supabase.from("candidate_profiles").select("last_role, skills, years_experience, bio").eq("user_id", uid).maybeSingle(),
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("candidate_id", uid),
        supabase.from("saved_jobs").select("id", { count: "exact", head: true }).eq("user_id", uid),
        supabase
          .from("jobs")
          .select(
            "id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)",
          )
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(4),
      ]);

      setName(profile?.full_name || "there");
      setCounts({ applied: appCount || 0, saved: savedCount || 0 });
      setRecommended((jobs as unknown as JobCardData[]) || []);

      let s = 25;
      if (profile?.full_name) s += 10;
      if (profile?.mobile) s += 10;
      if (profile?.city) s += 10;
      if (cand?.last_role) s += 15;
      if ((cand?.skills?.length || 0) > 0) s += 20;
      if (cand?.years_experience != null) s += 5;
      if (cand?.bio) s += 5;
      setStrength(Math.min(s, 100));

    })();
  }, []);

  return (
    <CandidateShell title={`Welcome back, ${name.split(" ")[0]} 👋`} subtitle="Track your search, applications and recommendations in one place.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={counts.applied} icon={FileText} to="/candidate/applications" />
        <StatCard label="Saved jobs" value={counts.saved} icon={Bookmark} to="/candidate/saved" />
        <StatCard label="Profile views" value={0} icon={TrendingUp} to="/candidate/profile" />
        <StatCard label="Recommended" value={recommended.length} icon={Sparkles} to="/jobs" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Profile strength</h2>
            <span className="text-sm font-bold text-primary">{strength}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${strength}%` }} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {strength < 70
              ? "Complete your profile to get 3× more responses from employers."
              : "Great profile! Keep it updated to stand out."}
          </p>
          <Link
            to="/candidate/profile"
            className="mt-4 inline-flex h-10 items-center gap-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            Improve profile <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Recommended for you</h2>
            <Link to="/jobs" className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
          {recommended.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-10 text-center">
              <Briefcase className="mb-3 h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No jobs to show yet. Check back soon.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {recommended.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </div>
      </div>
    </CandidateShell>
  );
}

function StatCard({ label, value, icon: Icon, to }: { label: string; value: number; icon: typeof Briefcase; to: string }) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-light text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <p className="mt-4 text-2xl font-bold text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </Link>
  );
}

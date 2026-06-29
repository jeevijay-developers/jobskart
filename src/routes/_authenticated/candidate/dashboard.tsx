import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Briefcase,
  Calendar,
  CheckCircle2,
  FileText,
  ListChecks,
  TrendingUp,
  X,
  Search,
  Upload,
  UserRound,
  GraduationCap,
  BookOpen,
  PlayCircle,
  BadgeCheck,
  Eye,
  PartyPopper,
  ShieldCheck,
  Award,
} from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";
import { strengthLabel, computeBadge } from "@/lib/profileStrength";
import { upsertNudgeShown } from "@/lib/candidate.functions";

export const Route = createFileRoute("/_authenticated/candidate/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · JobsKart" }] }),
  component: CandidateDashboard,
});

type Activity = {
  id: string;
  type: "applied" | "saved" | "status";
  title: string;
  meta: string;
  at: string;
};

type LearningRow = {
  id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  kind: string;
  category: string | null;
};

type RecJob = JobCardData & { matchedSkills?: string[] };

const RECENT_DAYS = 7;
const isRecent = (iso: string) =>
  Date.now() - new Date(iso).getTime() < RECENT_DAYS * 24 * 60 * 60 * 1000;

function CandidateDashboard() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [strength, setStrength] = useState(0);
  const [counts, setCounts] = useState({
    applied: 0,
    saved: 0,
    shortlisted: 0,
    interview: 0,
    views: 0,
    appliedWeek: 0,
    savedWeek: 0,
  });
  const [recommended, setRecommended] = useState<RecJob[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [learning, setLearning] = useState<LearningRow[]>([]);
  const [hasResume, setHasResume] = useState(false);
  const [badge, setBadge] = useState<{ tier: string; color: string }>({
    tier: "Bronze",
    color: "bg-orange-500/15 text-orange-700",
  });
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const { data: cand } = await supabase
        .from("candidate_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (cand && !cand.onboarding_completed && (cand.profile_strength || 0) < 50) {
        navigate({ to: "/onboarding/candidate" });
        return;
      }

      const [{ data: profile }, apps, saved, jobs, expRes, eduRes, learn] = await Promise.all([
        supabase.from("profiles").select("full_name, city, mobile_verified").eq("id", uid).maybeSingle(),
        supabase
          .from("applications")
          .select("id, status, created_at, job_id, jobs(title, companies(name))")
          .eq("candidate_id", uid)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("saved_jobs")
          .select("id, created_at, job_id, jobs(title, companies(name))")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("jobs")
          .select(
            "id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)",
          )
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(12),
        supabase.from("candidate_experiences").select("id", { head: true, count: "exact" }).eq("user_id", uid),
        supabase.from("candidate_education").select("id", { head: true, count: "exact" }).eq("user_id", uid),
        supabase
          .from("learning_resources")
          .select("id, title, slug, cover_url, kind, category")
          .eq("is_published", true)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      setName(profile?.full_name || "there");
      setCity(profile?.city || cand?.preferred_cities?.[0] || "");
      setStrength(cand?.profile_strength || 0);
      setHasResume(!!cand?.resume_url);
      setVerified(!!profile?.mobile_verified);

      const appsList = apps.data || [];
      const savedList = saved.data || [];
      setCounts({
        applied: appsList.length,
        saved: savedList.length,
        shortlisted: appsList.filter((a) => a.status === "shortlisted").length,
        interview: appsList.filter((a) => a.status === "interview").length,
        views: cand?.profile_views || 0,
        appliedWeek: appsList.filter((a) => isRecent(a.created_at)).length,
        savedWeek: savedList.filter((s) => isRecent(s.created_at)).length,
      });

      // Recommended with matched skills
      let recs: RecJob[] = (jobs.data as unknown as JobCardData[]) || [];
      const mySkills: string[] = (cand?.skills ?? []).map((s: string) => s.toLowerCase());
      if (mySkills.length) {
        recs = recs
          .map((j) => {
            const matched = (j.skills || []).filter((s) => mySkills.includes(s.toLowerCase()));
            return { j: { ...j, matchedSkills: matched.slice(0, 2) }, score: matched.length };
          })
          .sort((a, b) => b.score - a.score)
          .map((x) => x.j);
      }
      setRecommended(recs.slice(0, 4));

      const a: Activity[] = [];
      appsList.slice(0, 8).forEach((x) =>
        a.push({
          id: `a-${x.id}`,
          type: "applied",
          title: (x.jobs as { title?: string })?.title || "Job",
          meta: `Status: ${x.status}`,
          at: x.created_at,
        }),
      );
      savedList.slice(0, 5).forEach((x) =>
        a.push({
          id: `s-${x.id}`,
          type: "saved",
          title: (x.jobs as { title?: string })?.title || "Job",
          meta: "Saved",
          at: x.created_at,
        }),
      );
      a.sort((x, y) => +new Date(y.at) - +new Date(x.at));
      setActivity(a.slice(0, 6));

      // Missing items
      const miss: string[] = [];
      if (!cand?.headline) miss.push("Add a headline");
      if (!cand?.resume_url) miss.push("Upload your resume");
      if ((cand?.skills?.length || 0) < 3) miss.push("Add at least 3 skills");
      if (!expRes.count && cand?.experience_status === "experienced") miss.push("Add work experience");
      if (cand?.kyc_status !== "verified") miss.push("Verify your identity");
      if (!cand?.expected_salary && cand?.experience_status !== "student") miss.push("Add expected salary");
      setMissing(miss);

      setBadge(
        computeBadge({
          strength: cand?.profile_strength || 0,
          mobileVerified: !!profile?.mobile_verified,
          hasResume: !!cand?.resume_url,
          experiencesCount: expRes.count || 0,
          educationCount: eduRes.count || 0,
          skillsCount: cand?.skills?.length || 0,
        }),
      );

      setLearning((learn.data as LearningRow[]) || []);
    })();
  }, [navigate]);

  const firstName = name.split(" ")[0] || "there";

  return (
    <CandidateShell title="" subtitle="">
      <NudgeBanner strength={strength} missing={missing} />

      {/* Hero band */}
      <HeroBand
        firstName={firstName}
        city={city}
        strength={strength}
        badge={badge}
        verified={verified}
      />

      {/* Quick actions */}
      <QuickActions hasResume={hasResume} strength={strength} />

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Applications"
          value={counts.applied}
          delta={counts.appliedWeek}
          icon={FileText}
          to="/candidate/applications"
        />
        <Stat
          label="Shortlisted"
          value={counts.shortlisted}
          icon={CheckCircle2}
          to="/candidate/applications"
        />
        <Stat
          label="Interviews"
          value={counts.interview}
          icon={Calendar}
          to="/candidate/applications"
        />
        <Stat
          label="Saved"
          value={counts.saved}
          delta={counts.savedWeek}
          icon={Bookmark}
          to="/candidate/saved"
        />
        <Stat
          label="Profile views"
          value={counts.views}
          icon={Eye}
          to="/candidate/profile"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-foreground sm:text-lg">
                Recommended for you
              </h2>
              <Link
                to="/jobs"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {recommended.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="No matches yet"
                body="Add a few skills to your profile so we can match you to relevant jobs."
                ctaLabel="Search jobs"
                ctaTo="/jobs"
              />
            ) : (
              <div className="grid gap-4">
                {recommended.map((j) => (
                  <div key={j.id} className="relative">
                    <JobCard job={j} />
                    {j.matchedSkills && j.matchedSkills.length > 0 && (
                      <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-success-foreground ring-1 ring-success/30">
                        <CheckCircle2 className="h-3 w-3" /> Matches: {j.matchedSkills.join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Learning corner */}
          {learning.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
                  <BookOpen className="h-4 w-4 text-primary" /> Learning corner
                </h2>
                <span className="text-xs text-muted-foreground">Boost your career</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {learning.slice(0, 2).map((l) => (
                  <a
                    key={l.id}
                    href={`/learning/${l.slug}`}
                    className="group block overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-card-hover)]"
                  >
                    <div className="relative aspect-[16/9] overflow-hidden bg-primary-light">
                      {l.cover_url ? (
                        <img
                          src={l.cover_url}
                          alt={l.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-primary/40">
                          {l.kind === "video" ? (
                            <PlayCircle className="h-10 w-10" strokeWidth={1.5} />
                          ) : (
                            <BookOpen className="h-10 w-10" strokeWidth={1.5} />
                          )}
                        </div>
                      )}
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-foreground">
                        {l.kind === "video" ? (
                          <>
                            <PlayCircle className="h-3 w-3" /> Video
                          </>
                        ) : (
                          <>
                            <BookOpen className="h-3 w-3" /> Article
                          </>
                        )}
                      </span>
                    </div>
                    <div className="p-4">
                      {l.category && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                          {l.category}
                        </p>
                      )}
                      <h3 className="mt-1 line-clamp-2 text-sm font-bold text-foreground group-hover:text-primary">
                        {l.title}
                      </h3>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Side column */}
        <div className="space-y-6">
          {missing.length > 0 && (
            <ChecklistCard items={missing} />
          )}

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-bold text-foreground">Recent activity</h3>
            {activity.length === 0 ? (
              <div className="mt-4 grid place-items-center rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center">
                <PartyPopper className="mb-2 h-6 w-6 text-muted-foreground" strokeWidth={1.75} />
                <p className="text-xs text-muted-foreground">
                  No activity yet. Apply to your first job!
                </p>
              </div>
            ) : (
              <ol className="mt-4 space-y-4">
                {activity.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 text-sm">
                    <div className="relative flex flex-col items-center">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-card ${
                          a.type === "applied"
                            ? "bg-primary text-primary-foreground"
                            : "bg-amber-500/15 text-amber-700"
                        }`}
                      >
                        {a.type === "applied" ? (
                          <FileText className="h-3.5 w-3.5" strokeWidth={2.5} />
                        ) : (
                          <Bookmark className="h-3.5 w-3.5" strokeWidth={2.5} />
                        )}
                      </span>
                      {i < activity.length - 1 && (
                        <span className="mt-1 h-full w-px flex-1 bg-border" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-1">
                      <p className="truncate font-semibold text-foreground">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.meta} · {new Date(a.at).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Tips card */}
          <div className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-light via-card to-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" strokeWidth={2.25} />
              <h3 className="text-sm font-bold text-foreground">Pro tip</h3>
            </div>
            <p className="mt-2 text-xs text-foreground/80">
              Candidates with a <strong>verified profile + uploaded resume</strong> get shortlisted{" "}
              <span className="font-bold text-primary">3× more often</span>. Finish your profile to
              stand out.
            </p>
            <Link
              to="/candidate/profile"
              className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
            >
              Polish my profile <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </CandidateShell>
  );
}

/* ---------- Hero band ---------- */

function HeroBand({
  firstName,
  city,
  strength,
  badge,
  verified,
}: {
  firstName: string;
  city: string;
  strength: number;
  badge: { tier: string; color: string };
  verified: boolean;
}) {
  const sLabel = strengthLabel(strength);
  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary-light via-card to-card p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${badge.color}`}
            >
              <Award className="h-3 w-3" strokeWidth={2.5} />
              {badge.tier}
            </span>
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-success-foreground">
                <BadgeCheck className="h-3 w-3" strokeWidth={2.5} /> Verified
              </span>
            )}
            {city && (
              <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground/70 ring-1 ring-border">
                <ShieldCheck className="h-3 w-3" /> {city}
              </span>
            )}
          </div>
          <h1 className="mt-3 truncate text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Welcome back, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your profile is{" "}
            <span className={`font-bold ${sLabel.color}`}>{sLabel.label.toLowerCase()}</span> —
            {strength < 80
              ? " complete a few more fields to unlock 3× more recruiter views."
              : " keep applying to get hired faster."}
          </p>
        </div>
        <Ring value={strength} />
      </div>
    </div>
  );
}

/* ---------- Quick actions ---------- */

function QuickActions({ hasResume, strength }: { hasResume: boolean; strength: number }) {
  const actions = [
    { icon: Search, label: "Search jobs", to: "/jobs" as const, show: true },
    {
      icon: Upload,
      label: hasResume ? "Update resume" : "Upload resume",
      to: "/candidate/profile?section=resume" as const,
      show: true,
      accent: !hasResume,
    },
    {
      icon: UserRound,
      label: "Complete profile",
      to: "/candidate/profile" as const,
      show: strength < 80,
      accent: strength < 60,
    },
    { icon: GraduationCap, label: "Education", to: "/candidate/profile?section=education" as const, show: true },
    { icon: Bookmark, label: "Saved jobs", to: "/candidate/saved" as const, show: true },
  ].filter((a) => a.show);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          className={`group flex items-center gap-3 rounded-2xl border p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 ${
            a.accent
              ? "border-primary/40 bg-primary text-primary-foreground hover:bg-primary-dark"
              : "border-border bg-card text-foreground hover:border-primary/40"
          }`}
        >
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
              a.accent ? "bg-white/15 text-primary-foreground" : "bg-primary/10 text-primary"
            }`}
          >
            <a.icon className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <span className="text-sm font-bold leading-tight">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

/* ---------- Stat ---------- */

function Stat({
  label,
  value,
  icon: Icon,
  to,
  delta,
}: {
  label: string;
  value: number;
  icon: typeof Briefcase;
  to: string;
  delta?: number;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-light text-primary">
          <Icon className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
      </div>
      <p className="mt-3 text-2xl font-extrabold text-foreground tabular-nums">{value}</p>
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        {typeof delta === "number" && delta > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground">
            <TrendingUp className="h-2.5 w-2.5" /> +{delta}
          </span>
        )}
      </div>
    </Link>
  );
}

/* ---------- Checklist ---------- */

function ChecklistCard({ items }: { items: string[] }) {
  const totalGoal = 6;
  const done = Math.max(0, totalGoal - items.length);
  const pct = Math.round((done / totalGoal) * 100);
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Finish your profile</h3>
        </div>
        <span className="text-xs font-bold text-muted-foreground tabular-nums">
          {done}/{totalGoal}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-4 space-y-2.5">
        {items.map((m) => (
          <li
            key={m}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-surface"
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border bg-card">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="min-w-0 flex-1 truncate">{m}</span>
          </li>
        ))}
      </ul>
      <Link
        to="/candidate/profile"
        className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-dark"
      >
        Continue <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/* ---------- Empty state ---------- */

function EmptyState({
  icon: Icon,
  title,
  body,
  ctaLabel,
  ctaTo,
}: {
  icon: typeof Briefcase;
  title: string;
  body: string;
  ctaLabel: string;
  ctaTo: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-light text-primary">
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <p className="mt-4 text-base font-bold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      <Link
        to={ctaTo}
        className="mt-5 inline-flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-dark"
      >
        {ctaLabel} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/* ---------- Ring ---------- */

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <div className="relative h-20 w-20 shrink-0 sm:h-24 sm:w-24">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="text-lg font-extrabold text-primary tabular-nums sm:text-xl">{value}%</p>
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Profile
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Nudge banner (unchanged behavior) ---------- */

type NudgeKind = "profile_completion" | "verification_awareness" | "digilocker";
const DISMISS_KEY = "jk_nudge_dismissed";

function NudgeBanner({ strength, missing }: { strength: number; missing: string[] }) {
  const [hidden, setHidden] = useState(true);
  const [kind, setKind] = useState<NudgeKind | null>(null);

  useEffect(() => {
    let next: NudgeKind | null = null;
    if (strength < 70 && missing.length > 0) next = "profile_completion";
    else if (missing.includes("Verify your identity")) next = "verification_awareness";
    else if (strength >= 70) next = "digilocker";

    if (!next) return;

    const dismissed =
      typeof window !== "undefined"
        ? window.localStorage.getItem(`${DISMISS_KEY}_${next}`)
        : null;
    if (dismissed) return;

    setKind(next);
    setHidden(false);
    upsertNudgeShown({ data: { kind: next } }).catch(() => undefined);
  }, [strength, missing]);

  if (hidden || !kind) return null;

  const copy: Record<NudgeKind, { title: string; body: string; cta: string; to: string }> = {
    profile_completion: {
      title: "Stand out to recruiters",
      body: "Profiles above 70% completion get 3× more recruiter views. Finish a few quick fields now.",
      cta: "Complete profile",
      to: "/candidate/profile",
    },
    verification_awareness: {
      title: "Get verified — boost employer trust",
      body: "Verified candidates are shortlisted 2× more often. It only takes a minute.",
      cta: "Verify identity",
      to: "/candidate/profile",
    },
    digilocker: {
      title: "Add verified documents",
      body: "Coming soon: link DigiLocker to auto-share verified IDs and certificates with employers.",
      cta: "Learn more",
      to: "/candidate/profile",
    },
  };

  const c = copy[kind];

  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 shadow-[var(--shadow-card)]">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
        <BadgeCheck className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{c.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{c.body}</p>
      </div>
      <Link
        to={c.to}
        className="hidden h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary-dark sm:inline-flex"
      >
        {c.cta} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
          try {
            window.localStorage.setItem(`${DISMISS_KEY}_${kind}`, "1");
          } catch {
            /* ignore */
          }
        }}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

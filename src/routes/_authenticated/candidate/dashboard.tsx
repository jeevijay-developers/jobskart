import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Calendar,
  CheckCircle2,
  FileText,
  ListChecks,
  X,
  BookOpen,
  PlayCircle,
  BadgeCheck,
  Eye,
  Loader2,
} from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { SectionCard } from "@/components/candidate/primitives";
import { WhatsappNudgeCard } from "@/components/candidate/WhatsappNudgeCard";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { Pagination } from "@/components/site/Pagination";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { computeProfileStrength, strengthLabel } from "@/lib/profileStrength";
import { upsertNudgeShown } from "@/lib/candidate.functions";
import { useBackToHome } from "@/hooks/use-back-to-home";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { fetchCandidateJobFeed } from "@/lib/job-feed";

export const Route = createFileRoute("/_authenticated/candidate/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · JobsKart" }] }),
  component: CandidateDashboard,
});

type LearningRow = {
  id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  kind: string;
  category: string | null;
};

const RECENT_DAYS = 7;
const isRecent = (iso: string) =>
  Date.now() - new Date(iso).getTime() < RECENT_DAYS * 24 * 60 * 60 * 1000;

const REC_JOBS_PAGE_SIZE = 14;

function CandidateDashboard() {
  const navigate = useNavigate();
  useBackToHome();
  const [name, setName] = useState("");
  const [strength, setStrength] = useState(0);
  const [counts, setCounts] = useState({
    applied: 0,
    shortlisted: 0,
    interview: 0,
    views: 0,
    appliedWeek: 0,
  });
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<"recommended" | "top">("recommended");
  const [missing, setMissing] = useState<string[]>([]);
  const [learning, setLearning] = useState<LearningRow[]>([]);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;
      setCandidateId(uid);

      const { data: cand } = await supabase
        .from("candidate_profiles")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (cand && !cand.onboarding_completed && (cand.profile_strength || 0) < 50) {
        navigate({ to: "/onboarding/candidate" });
        return;
      }

      const [{ data: profile }, apps, expRes, eduRes, langRes, learn] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, mobile, city, avatar_url, mobile_verified")
          .eq("id", uid)
          .maybeSingle(),
        supabase
          .from("applications")
          .select("id, status, created_at, job_id, jobs(title, companies(name))")
          .eq("candidate_id", uid)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("candidate_experiences")
          .select("id", { head: true, count: "exact" })
          .eq("user_id", uid),
        supabase
          .from("candidate_education")
          .select("id", { head: true, count: "exact" })
          .eq("user_id", uid),
        supabase
          .from("candidate_languages")
          .select("id", { head: true, count: "exact" })
          .eq("user_id", uid),
        supabase
          .from("learning_resources")
          .select("id, title, slug, cover_url, kind, category")
          .eq("is_published", true)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      setName(profile?.full_name || "there");
      // Same source of truth as /candidate/profile's `strengthInput` +
      // computeProfileStrength (src/lib/profileStrength.ts) — computed live
      // from the current profile/experience/education/language rows instead
      // of trusting the stored candidate_profiles.profile_strength column,
      // which only gets refreshed as a side effect of visiting the profile
      // page and can go stale (the cause of the two pages showing different
      // percentages for the same candidate).
      setStrength(
        computeProfileStrength({
          full_name: profile?.full_name,
          mobile: profile?.mobile,
          city: profile?.city,
          avatar_url: profile?.avatar_url,
          headline: cand?.headline,
          last_role: cand?.last_role,
          bio: cand?.bio,
          skills: cand?.skills,
          years_experience: cand?.years_experience,
          preferred_job_types: cand?.preferred_job_types,
          preferred_cities: cand?.preferred_cities,
          expected_salary: cand?.expected_salary,
          resume_url: cand?.resume_url,
          experiences_count: expRes.count ?? 0,
          education_count: eduRes.count ?? 0,
          languages_count: langRes.count ?? 0,
          kyc_verified: cand?.kyc_status === "verified",
        }),
      );
      setVerified(!!profile?.mobile_verified);

      const appsList = apps.data || [];
      setCounts({
        applied: appsList.length,
        shortlisted: appsList.filter((a) => a.status === "shortlisted").length,
        interview: appsList.filter((a) => a.status === "interview").length,
        views: cand?.profile_views || 0,
        appliedWeek: appsList.filter((a) => isRecent(a.created_at)).length,
      });

      // Missing items
      const miss: string[] = [];
      if (!cand?.headline) miss.push("Add a headline");
      if (!cand?.resume_url) miss.push("Upload your resume");
      if ((cand?.skills?.length || 0) < 3) miss.push("Add at least 3 skills");
      if (!expRes.count && cand?.experience_status === "experienced")
        miss.push("Add work experience");
      if (cand?.kyc_status !== "verified") miss.push("Verify your identity");
      if (!cand?.expected_salary && cand?.experience_status !== "student")
        miss.push("Add expected salary");
      setMissing(miss);

      setLearning((learn.data as LearningRow[]) || []);
    })();
  }, [navigate]);

  const refreshApplicationTotals = async () => {
    if (!candidateId) return;
    const weekStart = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [all, recent] = await Promise.all([
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId),
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .gte("created_at", weekStart),
    ]);
    if (all.error || recent.error) return;
    setCounts((current) => ({
      ...current,
      applied: all.count ?? current.applied,
      appliedWeek: recent.count ?? current.appliedWeek,
    }));
  };

  const firstName = name.split(" ")[0] || "there";

  // Server-side candidate feed (feed_jobs_for_candidate): excludes jobs the
  // candidate already applied to before ranking/pagination, so this replaces
  // the old "fetch 60 then client-sort by skill match" — a partial server
  // page can't be re-sorted client-side without breaking pagination/totals.
  const {
    page: recPage,
    setPage: setRecPage,
    rows: recommendedPage,
    total: recommendedTotal,
    totalPages: recommendedTotalPages,
    isLoading: recommendedLoading,
    error: recommendedError,
    refetch: refetchRecommended,
  } = usePaginatedQuery<JobCardData>({
    queryKey: ["candidate-dashboard", "recommended", candidateId, feedMode],
    pageSize: REC_JOBS_PAGE_SIZE,
    fetchPage: async ({ from, to }) => {
      const { rows, total, error } = await fetchCandidateJobFeed(
        {},
        "recommended",
        from,
        to,
        feedMode,
      );
      if (error) throw new Error(error);
      return { rows, total };
    },
    enabled: !!candidateId,
  });

  // Best-effort impression logging so the recommendation engine's future
  // tuning has a record of what was actually shown, not just applied-to.
  // Never blocks rendering — failures are swallowed silently.
  useEffect(() => {
    if (!candidateId || recommendedLoading || !recommendedPage.length) return;
    supabase
      .from("job_impressions")
      .insert(
        recommendedPage.map((j, i) => ({
          candidate_user_id: candidateId,
          job_id: j.id,
          source: feedMode,
          position: (recPage - 1) * REC_JOBS_PAGE_SIZE + i,
        })) as never,
      )
      .then(
        () => {},
        () => {},
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log once per page load, not on every candidateId/recPage re-render
  }, [recommendedPage, recommendedLoading]);

  const recommendedHeading = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-foreground sm:text-lg">
          {feedMode === "recommended" ? "Recommended for you" : "Top jobs on JobsKart"}
        </h2>
        {recommendedTotal > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {recommendedTotal}{" "}
            {feedMode === "recommended" ? (recommendedTotal === 1 ? "match" : "matches") : "jobs"}
          </span>
        )}
      </div>
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setFeedMode("recommended")}
          className={`rounded-md px-3 py-1.5 transition-colors ${feedMode === "recommended" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Recommended
        </button>
        <button
          type="button"
          onClick={() => setFeedMode("top")}
          className={`rounded-md px-3 py-1.5 transition-colors ${feedMode === "top" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Top jobs
        </button>
      </div>
    </div>
  );

  const recommendedContent = (
    <section>
      {recommendedLoading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : recommendedError ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-base font-bold text-foreground">
            Couldn&apos;t load your recommendations
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Something went wrong on our side. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => void refetchRecommended()}
            className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-dark"
          >
            Try again
          </button>
        </div>
      ) : recommendedTotal === 0 && feedMode === "recommended" ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-light text-primary">
            <Briefcase className="h-6 w-6" strokeWidth={2} />
          </span>
          <p className="mt-4 text-base font-bold text-foreground">No close matches yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Your skills and role don&apos;t line up with what&apos;s posted right now — or
            you&apos;ve already applied to everything that fits. Add more skills to your profile, or
            see everything that&apos;s open.
          </p>
          <button
            type="button"
            onClick={() => setFeedMode("top")}
            className="mt-5 inline-flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-dark"
          >
            See top jobs <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : recommendedTotal === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs right now"
          body="Nothing active matches your filters at the moment — or you may have already applied to everything that's open."
          ctaLabel="Search jobs"
          ctaTo="/jobs"
        />
      ) : (
        <>
          <div className="grid gap-4">
            {recommendedPage.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                variant="discovery"
                detailBasePath="/candidate/jobs"
                onApplied={() => {
                  void refreshApplicationTotals();
                  void refetchRecommended();
                }}
              />
            ))}
          </div>
          {recommendedTotalPages > 1 && (
            <Pagination
              page={recPage}
              totalPages={recommendedTotalPages}
              onChange={setRecPage}
              ariaLabel="Recommended jobs pagination"
              className="mt-6"
            />
          )}
        </>
      )}
    </section>
  );

  const learningContent = learning.length > 0 && (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <BookOpen className="h-4 w-4 text-primary" /> Learning corner
        </h2>
        <span className="text-xs text-muted-foreground">Boost your career</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {learning.slice(0, 2).map((l) => (
          <Link
            key={l.id}
            to="/candidate/learning-corner/$slug"
            params={{ slug: l.slug }}
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
          </Link>
        ))}
      </div>
    </section>
  );

  return (
    <CandidateShell title="" subtitle="">
      <WhatsappNudgeCard />
      <NudgeBanner strength={strength} missing={missing} />

      {/* Hero band */}
      <HeroBand firstName={firstName} strength={strength} verified={verified} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 min-[1180px]:grid-cols-4">
        <StatCard
          label="Applications"
          value={counts.applied}
          delta={counts.appliedWeek}
          icon={FileText}
          to="/candidate/applications"
        />
        <StatCard
          label="Shortlisted"
          value={counts.shortlisted}
          tone="success"
          icon={CheckCircle2}
          to="/candidate/applications"
          search={{ tab: "shortlisted" }}
        />
        <StatCard
          label="Interviews"
          value={counts.interview}
          tone="warning"
          icon={Calendar}
          to="/candidate/applications"
          search={{ tab: "interview" }}
        />
        <StatCard
          label="Profile views"
          value={counts.views}
          tone="muted"
          icon={Eye}
          to="/candidate/profile"
        />
      </div>

      {missing.length > 0 ? (
        <div className="mt-6 grid min-w-0 items-start gap-x-6 min-[1180px]:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="min-w-0 min-[1180px]:col-start-1 min-[1180px]:row-start-1">
            {recommendedHeading}
          </div>
          <div className="min-w-0 min-[1180px]:col-start-1 min-[1180px]:row-start-2">
            {recommendedContent}
          </div>
          <div className="mt-6 min-w-0 min-[1180px]:col-start-2 min-[1180px]:row-start-2 min-[1180px]:mt-0">
            <ChecklistCard items={missing} />
          </div>
          {learningContent && (
            <div className="mt-6 min-w-0 min-[1180px]:col-start-1 min-[1180px]:row-start-3">
              {learningContent}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 min-w-0">
          {recommendedHeading}
          {recommendedContent}
          {learningContent && <div className="mt-6">{learningContent}</div>}
        </div>
      )}
    </CandidateShell>
  );
}

/* ---------- Hero band ---------- */

function HeroBand({
  firstName,
  strength,
  verified,
}: {
  firstName: string;
  strength: number;
  verified: boolean;
}) {
  const sLabel = strengthLabel(strength);
  return (
    <Link
      to="/candidate/profile"
      search={{ highlight: "incomplete" } as never}
      className="group relative mb-6 block overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary-light via-card to-card p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:gap-6">
        <div className="min-w-0">
          {verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-success-foreground">
              <BadgeCheck className="h-3 w-3" strokeWidth={2.5} /> Verified
            </span>
          )}
          <h1 className="mt-3 break-words text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
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
    </Link>
  );
}

/* ---------- Checklist ---------- */

function ChecklistCard({ items }: { items: string[] }) {
  const totalGoal = 6;
  const done = Math.max(0, totalGoal - items.length);
  const pct = Math.round((done / totalGoal) * 100);
  return (
    <SectionCard
      size="compact"
      icon={ListChecks}
      title="Finish your profile"
      action={
        <span className="text-xs font-bold text-muted-foreground tabular-nums">
          {done}/{totalGoal}
        </span>
      }
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
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
    </SectionCard>
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

type NudgeKind = "profile_completion" | "verification_awareness" | "documents";
const DISMISS_KEY = "jk_nudge_dismissed";

function NudgeBanner({ strength, missing }: { strength: number; missing: string[] }) {
  const [hidden, setHidden] = useState(true);
  const [kind, setKind] = useState<NudgeKind | null>(null);

  useEffect(() => {
    let next: NudgeKind | null = null;
    if (strength < 70 && missing.length > 0) next = "profile_completion";
    else if (missing.includes("Verify your identity")) next = "verification_awareness";
    else if (strength >= 70) next = "documents";

    if (!next) return;

    const dismissed =
      typeof window !== "undefined" ? window.localStorage.getItem(`${DISMISS_KEY}_${next}`) : null;
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
    documents: {
      title: "Upload your documents",
      body: "Add your ID, resume and certificates once — employers can verify you in seconds.",
      cta: "Add documents",
      to: "/candidate/documents",
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

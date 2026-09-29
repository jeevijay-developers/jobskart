import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUpDown,
  Ban,
  Flame,
  LayoutGrid,
  List,
  Lock,
  Mail,
  MapPin,
  MoreVertical,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ApplicantCard } from "@/components/employer/ApplicantCard";
import { ApplicantReviewPanel } from "@/components/employer/ApplicantReviewPanel";
import { ScheduleInterviewModal } from "@/components/employer/ScheduleInterviewModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { APPLICANT_STATUSES, applicantStatusLabel } from "@/lib/applicantStatus";
import { mapCrmError, moveStage, type ApplicationStatus } from "@/lib/crm.functions";

type ApplicantsSearch = { source?: "applied" | "recommended" };

export const Route = createFileRoute("/_authenticated/employer/jobs/$jobId/applicants")({
  validateSearch: (search: Record<string, unknown>): ApplicantsSearch => ({
    source: search.source === "recommended" ? "recommended" : undefined,
  }),
  head: () => ({ meta: [{ title: "Applicants · JobsKart" }] }),
  // Remount per job: this route stays mounted across job-to-job navigation
  // (same route match, params updated in place), so without a `key` all
  // job-scoped state (source tab, applicants, recommended list, filters)
  // would leak from the previously viewed job into the newly viewed one.
  component: () => {
    const { jobId } = Route.useParams();
    return <ApplicantsPage key={jobId} />;
  },
});

type Application = {
  id: string;
  status: string;
  created_at: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  candidate_id: string;
  profiles: {
    full_name: string | null;
    email: string | null;
    mobile: string | null;
    avatar_url: string | null;
    city: string | null;
  } | null;
  candidate_profiles: {
    profile_slug: string | null;
    headline: string | null;
    last_role: string | null;
    years_experience: number | null;
    experience_status: string | null;
    skills: string[] | null;
  } | null;
  education: { level: string; institute: string | null } | null;
};

type RecommendedCandidate = {
  user_id: string;
  profile_slug: string | null;
  headline: string | null;
  last_role: string | null;
  years_experience: number | null;
  skills: string[] | null;
  preferred_cities: string[] | null;
  preferred_work_mode: string | null;
  city: string | null;
  match_score: number;
  match_breakdown: Record<string, number> | null;
  tags: string[];
  is_unlocked: boolean;
  full_name: string | null;
  avatar_url: string | null;
  total_count: number;
};

// ─── Source Switcher ────────────────────────────────────────────────────────
type Source = "applied" | "recommended";

const TABS = [{ id: "all", label: "All" }, ...APPLICANT_STATUSES] as const;
type Tab = (typeof TABS)[number]["id"];

function emptyStateCopy(tab: Tab) {
  switch (tab) {
    case "all":
      return { title: "No applicants yet", body: "Applications will show up here as candidates apply." };
    case "applied":
      return { title: "Nothing new to review", body: "New applications land here first." };
    case "shortlisted":
      return { title: "No one shortlisted yet", body: "Move promising applicants here to keep track of them." };
    case "interview":
      return { title: "No interviews in progress", body: "Applicants you're interviewing will show up here." };
    case "hired":
      return { title: "No hires yet", body: "Once you mark someone hired, they'll appear here." };
    case "rejected":
      return { title: "No rejections", body: "Applicants you pass on will be listed here." };
  }
}

// ─── Tag Badge ───────────────────────────────────────────────────────────────
function TagBadge({ tag }: { tag: string }) {
  if (tag === "Hot Profile") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3e0] px-2 py-0.5 text-[10px] font-bold text-orange-600">
        <Flame className="h-3 w-3" /> Hot
      </span>
    );
  }
  if (tag === "Nearby Candidate") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
        <MapPin className="h-3 w-3" /> Nearby
      </span>
    );
  }
  if (tag === "Recently Active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
        <Zap className="h-3 w-3" /> Active
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      {tag}
    </span>
  );
}

// ─── Match Score Ring ─────────────────────────────────────────────────────────
function MatchScoreRing({ score, onClick }: { score: number; onClick?: () => void }) {
  const color = score >= 75 ? "text-emerald-600" : score >= 50 ? "text-warning" : "text-muted-foreground";
  const ring = score >= 75 ? "bg-emerald-50 ring-emerald-200" : score >= 50 ? "bg-warning-light ring-warning/30" : "bg-surface ring-border";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ring-2 ${ring} ${onClick ? "cursor-pointer hover:ring-4 transition-[box-shadow]" : ""}`}
      title={onClick ? "See why this candidate matched" : undefined}
    >
      <span className={`text-sm font-black ${color}`}>{score}</span>
    </Tag>
  );
}

// ─── Match Explanation Modal ───────────────────────────────────────────────────
const BREAKDOWN_MAX: Record<string, number> = {
  skills: 60,
  location: 20,
  experience: 15,
  salary: 5,
};
const BREAKDOWN_LABEL: Record<string, string> = {
  skills: "Skills overlap",
  location: "Location compatibility",
  experience: "Experience match",
  salary: "Salary overlap",
  activity: "Recently active bonus",
  intent: "Hiring-intent bonus",
  proximity: "Proximity bonus",
};

function MatchExplanationModal({
  candidate,
  onClose,
}: {
  candidate: RecommendedCandidate;
  onClose: () => void;
}) {
  const breakdown = candidate.match_breakdown ?? {};
  const baseRows = ["skills", "location", "experience", "salary"].filter((k) => k in breakdown);
  const bonusRows = ["activity", "intent", "proximity"].filter((k) => (breakdown[k] ?? 0) > 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Why {candidate.match_score}% match?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
          {baseRows.map((key) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{BREAKDOWN_LABEL[key]}</span>
              <span className="font-semibold text-foreground">
                {breakdown[key]}/{BREAKDOWN_MAX[key]} pts
              </span>
            </div>
          ))}
          {bonusRows.length > 0 && (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              {bonusRows.map((key) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{BREAKDOWN_LABEL[key]}</span>
                  <span className="font-semibold text-success">+{breakdown[key]} pts</span>
                </div>
              ))}
            </div>
          )}
          {candidate.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
              {candidate.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recommended Candidate Card ───────────────────────────────────────────────
function RecommendedCard({
  candidate,
  onInvite,
  onDismiss,
  onUnlock,
  onExplain,
  inviting,
}: {
  candidate: RecommendedCandidate;
  onInvite: (id: string) => void;
  onDismiss: (id: string) => void;
  onUnlock: (id: string) => void;
  onExplain: (candidate: RecommendedCandidate) => void;
  inviting: boolean;
}) {
  const name = candidate.full_name ?? "Candidate";
  const isAnonymous = !candidate.is_unlocked;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-start gap-3">
        {/* Avatar / Match Score */}
        <div className="flex flex-col items-center gap-1.5">
          <div
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold ${
              isAnonymous ? "bg-surface text-muted-foreground" : "bg-primary-light text-primary"
            }`}
          >
            {isAnonymous ? "?" : name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
          </div>
          <MatchScoreRing score={candidate.match_score} onClick={() => onExplain(candidate)} />
          <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wider">Match</span>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-base font-semibold ${isAnonymous ? "text-muted-foreground italic" : "text-foreground"}`}>
              {name}
            </p>
            {candidate.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>

          {candidate.headline && (
            <p className="mt-0.5 text-sm text-muted-foreground truncate">{candidate.headline}</p>
          )}
          {candidate.last_role && (
            <p className="text-xs text-muted-foreground">{candidate.last_role}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {candidate.years_experience != null && (
              <span>{candidate.years_experience} yr{candidate.years_experience !== 1 ? "s" : ""} exp</span>
            )}
            {candidate.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{candidate.city}</span>}
          </div>

          {/* Skills */}
          {(candidate.skills ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(candidate.skills ?? []).slice(0, 5).map((s) => (
                <span key={s} className="rounded-md bg-primary-light px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {s}
                </span>
              ))}
              {(candidate.skills ?? []).length > 5 && (
                <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] text-muted-foreground">
                  +{(candidate.skills ?? []).length - 5} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-col gap-2">
          {!candidate.is_unlocked ? (
            <button
              onClick={() => onUnlock(candidate.user_id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
            >
              <Lock className="h-3.5 w-3.5" /> Unlock Profile
            </button>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success-light px-3 text-xs font-semibold text-success">
              ✓ Unlocked
            </span>
          )}
          <button
            onClick={() => onInvite(candidate.user_id)}
            disabled={inviting}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface disabled:opacity-60"
          >
            <Mail className="h-3.5 w-3.5" /> Invite to Apply
          </button>
          <button
            onClick={() => onDismiss(candidate.user_id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:bg-surface"
          >
            <Ban className="h-3.5 w-3.5" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Board Card (pipeline column item) ──────────────────────────────────────
function BoardCard({
  app,
  score,
  onMove,
  onView,
}: {
  app: Application;
  score?: number;
  onMove: (status: string) => void;
  onView: () => void;
}) {
  const name = app.profiles?.full_name ?? "Candidate";
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-sm">
      <div className="flex items-start justify-between gap-1">
        <button onClick={onView} className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-semibold text-foreground hover:text-primary">{name}</p>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-0.5 text-muted-foreground hover:bg-surface"
              aria-label={`Move ${name}`}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onView}>View profile</DropdownMenuItem>
            {APPLICANT_STATUSES.filter((s) => s.id !== app.status).map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => onMove(s.id)}>
                Move to {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {score != null && <span className="font-bold text-primary">{score}% match</span>}
        {app.candidate_profiles?.years_experience != null && (
          <span>{app.candidate_profiles.years_experience} yr{app.candidate_profiles.years_experience !== 1 ? "s" : ""}</span>
        )}
        {app.profiles?.city && <span className="truncate">{app.profiles.city}</span>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function ApplicantsPage() {
  const { jobId } = Route.useParams();
  const { source: sourceParam } = Route.useSearch();
  const [job, setJob] = useState<{ title: string; status: string; company_id: string } | null>(null);

  // Applied candidates state
  const [apps, setApps] = useState<Application[]>([]);
  const [reviewing, setReviewing] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [sortOrder, setSortOrder] = useState<"match" | "newest" | "oldest">("match");
  const [boardView, setBoardView] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState<Application | null>(null);
  const [ranked, setRanked] = useState<Record<string, { score: number; tags: string[] }>>({});

  // Source switcher
  const [source, setSource] = useState<Source>(sourceParam === "recommended" ? "recommended" : "applied");
  const [explaining, setExplaining] = useState<RecommendedCandidate | null>(null);

  // Keep the active tab in sync with ?source= on every navigation to this
  // route (not just the first mount) — e.g. clicking a different "Review
  // candidates" / "view now" link while this route is already mounted, or
  // using back/forward between two links with different `source` values.
  useEffect(() => {
    setSource(sourceParam === "recommended" ? "recommended" : "applied");
  }, [sourceParam]);

  // Recommended candidates state
  const [recommended, setRecommended] = useState<RecommendedCandidate[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recFilter, setRecFilter] = useState<string | null>(null);
  const [recPage, setRecPage] = useState(0);
  const [recTotal, setRecTotal] = useState(0);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const REC_PAGE_SIZE = 20;

  // ─── Load applied candidates ──────────────────────────────────────────────
  const load = async () => {
    const [jRes, aRes] = await Promise.all([
      supabase.from("jobs").select("title, status, company_id").eq("id", jobId).single(),
      supabase
        .from("applications")
        .select(
          "id, status, created_at, cover_note, expected_salary, available_from, candidate_id, profiles!candidate_id (full_name, email, mobile, avatar_url, city)",
        )
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
    ]);
    if (jRes.error) toast.error(jRes.error.message);
    if (aRes.error) toast.error(aRes.error.message);
    setJob(jRes.data as { title: string; status: string; company_id: string } | null);

    const rows = (aRes.data || []) as unknown as Array<Omit<Application, "candidate_profiles" | "education">>;
    const ids = Array.from(new Set(rows.map((r) => r.candidate_id)));

    let cpMap: Record<string, Application["candidate_profiles"]> = {};
    const eduMap: Record<string, Application["education"]> = {};
    if (ids.length) {
      const [cpRes, eduRes] = await Promise.all([
        supabase
          .from("candidate_profiles")
          .select("user_id, profile_slug, headline, last_role, years_experience, experience_status, skills")
          .in("user_id", ids),
        supabase
          .from("candidate_education")
          .select("user_id, level, institute, year_of_passing")
          .in("user_id", ids)
          .order("year_of_passing", { ascending: false, nullsFirst: false }),
      ]);
      cpMap = Object.fromEntries((cpRes.data || []).map((c) => [c.user_id, c]));
      for (const e of eduRes.data || []) {
        if (!eduMap[e.user_id]) eduMap[e.user_id] = { level: e.level, institute: e.institute };
      }
    }

    setApps(rows.map((r) => ({ ...r, candidate_profiles: cpMap[r.candidate_id] ?? null, education: eduMap[r.candidate_id] ?? null })) as Application[]);
    setLoading(false);
  };

  // ─── Load recommended candidates ─────────────────────────────────────────
  const loadRecommended = async (page = 0, filter: string | null = null) => {
    setRecLoading(true);
    const { data, error } = await supabase.rpc("get_recommended_candidates_for_job", {
      _job_id: jobId,
      _limit: REC_PAGE_SIZE,
      _offset: page * REC_PAGE_SIZE,
      _min_score: 40,
      _filter: filter ?? undefined,
    });
    setRecLoading(false);
    if (error) {
      toast.error("Couldn't load recommendations: " + error.message);
      return;
    }
    const rows = (data ?? []) as unknown as RecommendedCandidate[];
    if (page === 0) setRecommended(rows);
    else setRecommended((prev) => [...prev, ...rows]);
    if (rows.length > 0) setRecTotal(rows[0].total_count);
  };

  useEffect(() => {
    load();
    supabase
      .rpc("get_ranked_job_applicants", { _job_id: jobId, _sort_by: "match" })
      .then(({ data, error }) => {
        if (error) return;
        const map: Record<string, { score: number; tags: string[] }> = {};
        for (const row of data ?? []) {
          map[row.application_id] = { score: row.match_score ?? 0, tags: row.tags ?? [] };
        }
        setRanked(map);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Lazily load recommended tab when first switched to
  useEffect(() => {
    if (source === "recommended" && recommended.length === 0) {
      loadRecommended(0, recFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const applyRecFilter = (f: string | null) => {
    setRecFilter(f);
    setRecPage(0);
    loadRecommended(0, f);
  };

  // ─── Applied candidates: actions ──────────────────────────────────────────
  const move = useServerFn(moveStage);

  const updateStatus = async (ids: string[], status: string) => {
    if (status === "interview" && ids.length === 1) {
      const applicant = apps.find((a) => a.id === ids[0]);
      if (applicant) setScheduling(applicant);
      return;
    }
    const prevApps = apps;
    setApps((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, status } : a)));
    setReviewing((r) => (r && ids.includes(r.id) ? { ...r, status } : r));
    try {
      await move({ data: { applicationIds: ids, status: status as ApplicationStatus } });
    } catch (e) {
      setApps(prevApps);
      toast.error(mapCrmError(e instanceof Error ? e.message : "Update failed"));
      return;
    }
    toast.success(ids.length > 1 ? `Moved ${ids.length} to ${applicantStatusLabel(status)}` : `Marked as ${applicantStatusLabel(status)}`);
    setSelectedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  };

  // ─── Recommended: actions ────────────────────────────────────────────────
  const handleInvite = async (candidateUserId: string) => {
    setInvitingId(candidateUserId);
    const { error } = await supabase.rpc("invite_candidate_to_apply", {
      _job_id: jobId,
      _candidate_user_id: candidateUserId,
    });
    setInvitingId(null);
    if (error) return toast.error(error.message);
    toast.success("Invitation sent! The candidate will be notified.");
  };

  const handleDismiss = async (candidateUserId: string) => {
    const { error } = await supabase.rpc("dismiss_recommended_candidate", {
      _job_id: jobId,
      _candidate_user_id: candidateUserId,
    });
    if (error) return toast.error(error.message);
    setRecommended((prev) => prev.filter((c) => c.user_id !== candidateUserId));
    toast.success("Removed from recommendations.");
  };

  const handleUnlock = async (candidateUserId: string) => {
    // Redirect to unlock flow via candidate database page with the candidate pre-selected
    toast.info("Unlocking candidates uses credits. Redirecting to candidate database...");
    window.location.href = `/employer/database?unlock=${candidateUserId}`;
  };

  // ─── Applied candidates: derived state ───────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    for (const s of APPLICANT_STATUSES) c[s.id] = apps.filter((a) => a.status === s.id).length;
    return c;
  }, [apps]);

  const visible = useMemo(() => {
    const filtered = tab === "all" ? apps : apps.filter((a) => a.status === tab);
    if (sortOrder === "match") return [...filtered].sort((a, b) => (ranked[b.id]?.score ?? -1) - (ranked[a.id]?.score ?? -1));
    const sorted = [...filtered].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === "newest" ? -diff : diff;
    });
    return sorted;
  }, [apps, tab, sortOrder, ranked]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const empty = emptyStateCopy(tab);
  const showInterviewSubTabs = tab === "interview" || tab === "hired" || tab === "rejected";

  return (
    <EmployerShell
      title={job?.title ?? "Applicants"}
      subtitle={source === "applied" ? `${apps.length} applicant${apps.length === 1 ? "" : "s"}` : `${recTotal} matched profiles`}
      actions={
        <Link to="/employer/jobs" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
          <ArrowLeft className="h-4 w-4" /> All jobs
        </Link>
      }
    >
      {/* ── Source Switcher ─────────────────────────────────────────────── */}
      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
        <button
          onClick={() => setSource("applied")}
          className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
            source === "applied"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Users className="h-4 w-4" />
          Applied Candidates
          {apps.length > 0 && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${source === "applied" ? "bg-white/20" : "bg-primary-light text-primary"}`}>
              {apps.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setSource("recommended")}
          className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
            source === "recommended"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          AI Recommended Profiles
          {recTotal > 0 && source !== "recommended" && (
            <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-bold text-primary">
              {recTotal}
            </span>
          )}
          {source === "recommended" && recTotal > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
              {recTotal}
            </span>
          )}
        </button>
      </div>

      {/* ── Applied Candidates View ─────────────────────────────────────── */}
      {source === "applied" && (
        <>
          {loading ? (
            <div className="h-64 animate-pulse rounded-xl bg-card" />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                {!boardView && (
                <div className="w-full rounded-xl border border-border bg-card p-1 sm:flex sm:w-auto sm:flex-wrap sm:gap-1">
                  <div className="grid grid-cols-4 gap-1 sm:contents">
                    {TABS.filter((t) => t.id !== "hired" && t.id !== "rejected").map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-3 ${
                          tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
                        }`}
                      >
                        {t.label} {counts[t.id] > 0 && <span className="ml-1 opacity-80">({counts[t.id]})</span>}
                      </button>
                    ))}
                  </div>
                  <div className={`${showInterviewSubTabs ? "mt-1 grid grid-cols-2 gap-1" : "hidden"} sm:contents sm:mt-0`}>
                    {TABS.filter((t) => t.id === "hired" || t.id === "rejected").map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:px-3 ${
                          tab === t.id ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
                        }`}
                      >
                        {t.label} {counts[t.id] > 0 && <span className="ml-1 opacity-80">({counts[t.id]})</span>}
                      </button>
                    ))}
                  </div>
                </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBoardView((v) => !v)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
                    aria-label={boardView ? "Switch to list view" : "Switch to board view"}
                  >
                    {boardView ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}{" "}
                    {boardView ? "List" : "Board"}
                  </button>
                  {!boardView && (
                    <button
                      onClick={() => setSortOrder((s) => (s === "match" ? "newest" : s === "newest" ? "oldest" : "match"))}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />{" "}
                      {sortOrder === "match" ? "Best match" : sortOrder === "newest" ? "Newest first" : "Oldest first"}
                    </button>
                  )}
                </div>
              </div>

              {boardView ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  {APPLICANT_STATUSES.map((s) => {
                    const colApps = apps
                      .filter((a) => a.status === s.id)
                      .sort((a, b) => (ranked[b.id]?.score ?? -1) - (ranked[a.id]?.score ?? -1));
                    return (
                      <div key={s.id} className="flex min-h-[10rem] flex-col rounded-xl border border-border bg-surface/60 p-2">
                        <div className="mb-2 flex items-center justify-between px-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{s.label}</span>
                          <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-bold tabular-nums text-foreground">
                            {colApps.length}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {colApps.length === 0 && (
                            <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">No one here</p>
                          )}
                          {colApps.map((a) => (
                            <BoardCard
                              key={a.id}
                              app={a}
                              score={ranked[a.id]?.score}
                              onMove={(status) => updateStatus([a.id], status)}
                              onView={() => setReviewing(a)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
              <>
              {selectedIds.size > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-light p-3">
                  <span className="text-xs font-semibold text-primary">{selectedIds.size} selected</span>
                  <div className="flex flex-wrap gap-1.5">
                    {APPLICANT_STATUSES.filter((s) => s.id !== "interview").map((s) => (
                      <button
                        key={s.id}
                        onClick={() => updateStatus([...selectedIds], s.id)}
                        className="rounded-md bg-card px-2.5 py-1 text-xs font-semibold hover:bg-surface"
                      >
                        Move to {s.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-muted-foreground hover:underline">
                    Clear
                  </button>
                </div>
              )}

              {visible.length === 0 ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
                  <Users className="mb-3 h-7 w-7 text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">{empty.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{empty.body}</p>
                  {tab === "all" && apps.length === 0 && (
                    <button
                      onClick={() => setSource("recommended")}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
                    >
                      <Sparkles className="h-4 w-4" /> Explore AI Recommended Profiles
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-3">
                  {visible.map((a) => (
                    <ApplicantCard
                      key={a.id}
                      applicant={a}
                      selected={selectedIds.has(a.id)}
                      onToggleSelect={() => toggleSelect(a.id)}
                      onStatusChange={(status) => updateStatus([a.id], status)}
                      onView={() => setReviewing(a)}
                      matchScore={ranked[a.id]?.score}
                      tags={ranked[a.id]?.tags}
                    />
                  ))}
                </div>
              )}
              </>
              )}
            </>
          )}
        </>
      )}

      {/* ── AI Recommended Profiles View ─────────────────────────────────── */}
      {source === "recommended" && (
        <div>
          {/* Filter chips */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filter:</span>
            {[
              { label: "All Matches", value: null },
              { label: "🔥 Hot Profiles", value: "hot" },
              { label: "📍 Nearby", value: "nearby" },
              { label: "⚡ Recently Active", value: "active" },
            ].map((f) => (
              <button
                key={String(f.value)}
                onClick={() => applyRecFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  recFilter === f.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground/80 hover:bg-surface"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Insight banner */}
          {recTotal > 0 && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary-light/40 px-4 py-3">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm text-foreground">
                <strong>{recTotal} candidates</strong> in our database match your job requirements but haven't applied yet.
                Invite them to apply or unlock their contact details.
              </p>
            </div>
          )}

          {recLoading && recommended.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-2xl bg-card" />
              ))}
            </div>
          ) : recommended.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Sparkles className="mb-3 h-7 w-7 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">No recommendations yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We'll surface matching candidates as more profiles are added to the platform.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {recommended.map((c) => (
                  <RecommendedCard
                    key={c.user_id}
                    candidate={c}
                    onInvite={handleInvite}
                    onDismiss={handleDismiss}
                    onUnlock={handleUnlock}
                    onExplain={setExplaining}
                    inviting={invitingId === c.user_id}
                  />
                ))}
              </div>

              {/* Load More */}
              {recommended.length < recTotal && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => {
                      const nextPage = recPage + 1;
                      setRecPage(nextPage);
                      loadRecommended(nextPage, recFilter);
                    }}
                    disabled={recLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface disabled:opacity-60"
                  >
                    {recLoading ? "Loading..." : `Load more (${recTotal - recommended.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {explaining && (
        <MatchExplanationModal candidate={explaining} onClose={() => setExplaining(null)} />
      )}

      {/* Panels */}
      {reviewing && (
        <ApplicantReviewPanel
          applicant={reviewing}
          onClose={() => setReviewing(null)}
          onStatusChange={(status) => updateStatus([reviewing.id], status)}
        />
      )}

      {scheduling && job && (
        <ScheduleInterviewModal
          open
          onOpenChange={(v) => !v && setScheduling(null)}
          companyId={job.company_id}
          applicationId={scheduling.id}
          candidateName={scheduling.profiles?.full_name}
          onScheduled={() => {
            setApps((prev) => prev.map((a) => (a.id === scheduling.id ? { ...a, status: "interview" } : a)));
            setScheduling(null);
          }}
        />
      )}
    </EmployerShell>
  );
}

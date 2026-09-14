import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Filter, Loader2, Search, X } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { z } from "zod";
import { Navbar } from "@/components/site/Navbar";
import { Pagination } from "@/components/site/Pagination";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { AutocompleteInput } from "@/components/site/AutocompleteInput";
import { CandidateMobileTabBar } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import {
  JOB_CATEGORIES,
  JOB_TYPE_OPTIONS,
  WORK_MODES,
  EDUCATION_LEVELS,
  SHIFTS,
  ENGLISH_LEVELS,
  INDIAN_CITIES,
} from "@/lib/options";
import { useJobTitleSuggestions } from "@/lib/useJobTitleSuggestions";

const PAGE_SIZE = 20;
const SORT_OPTIONS = ["newest", "oldest", "salary_high", "salary_low"] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

const DATE_POSTED_OPTIONS = [
  { id: "24h", label: "Last 24 hours" },
  { id: "3d", label: "Last 3 days" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

const DATE_POSTED_HOURS: Record<string, number> = { "24h": 24, "3d": 72, "7d": 168, "30d": 720 };
function datePostedCutoffIso(key: string): string | null {
  const hours = DATE_POSTED_HOURS[key];
  if (!hours) return null;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const jobsSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  workMode: z.string().optional(),
  minSalary: z.string().optional(),
  maxSalary: z.string().optional(),
  minExp: z.string().optional(),
  maxExp: z.string().optional(),
  datePosted: z.string().optional(),
  education: z.string().optional(),
  shift: z.string().optional(),
  englishLevel: z.string().optional(),
  company: z.string().optional(),
  vehicle: z.string().optional(),
  verifiedOnly: z.string().optional(),
  sort: z.enum(SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

type JobsSearch = z.infer<typeof jobsSearchSchema>;

export const Route = createFileRoute("/jobs")({
  validateSearch: jobsSearchSchema,
  head: () => ({
    meta: [
      { title: "Browse Jobs · JobsKart" },
      {
        name: "description",
        content: "Search lakhs of full-time, part-time and field jobs across India on JobsKart.",
      },
      { property: "og:title", content: "Browse Jobs on JobsKart" },
      {
        property: "og:description",
        content: "Find delivery, sales, security, telecaller, warehouse and more jobs near you.",
      },
    ],
  }),
  component: JobsPage,
});

type Filters = {
  q: string;
  city: string;
  category: string;
  jobType: string;
  workMode: string;
  minSalary: string;
  maxSalary: string;
  minExp: string;
  maxExp: string;
  datePosted: string;
  education: string;
  shift: string;
  englishLevel: string;
  company: string;
  vehicle: string;
  verifiedOnly: string;
};

const empty: Filters = {
  q: "",
  city: "",
  category: "",
  jobType: "",
  workMode: "",
  minSalary: "",
  maxSalary: "",
  minExp: "",
  maxExp: "",
  datePosted: "",
  education: "",
  shift: "",
  englishLevel: "",
  company: "",
  vehicle: "",
  verifiedOnly: "",
};

function filtersFromSearch(s: JobsSearch): Filters {
  return {
    q: s.q ?? "",
    city: s.city ?? "",
    category: s.category ?? "",
    jobType: s.jobType ?? "",
    workMode: s.workMode ?? "",
    minSalary: s.minSalary ?? "",
    maxSalary: s.maxSalary ?? "",
    minExp: s.minExp ?? "",
    maxExp: s.maxExp ?? "",
    datePosted: s.datePosted ?? "",
    education: s.education ?? "",
    shift: s.shift ?? "",
    englishLevel: s.englishLevel ?? "",
    company: s.company ?? "",
    vehicle: s.vehicle ?? "",
    verifiedOnly: s.verifiedOnly ?? "",
  };
}

// Build a non-empty search payload, preserving sort/page when requested.
function buildSearch(f: Filters, extras: { sort?: SortKey; page?: number } = {}): JobsSearch {
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(f.city ? { city: f.city } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.jobType ? { jobType: f.jobType } : {}),
    ...(f.workMode ? { workMode: f.workMode } : {}),
    ...(f.minSalary ? { minSalary: f.minSalary } : {}),
    ...(f.maxSalary ? { maxSalary: f.maxSalary } : {}),
    ...(f.minExp ? { minExp: f.minExp } : {}),
    ...(f.maxExp ? { maxExp: f.maxExp } : {}),
    ...(f.datePosted ? { datePosted: f.datePosted } : {}),
    ...(f.education ? { education: f.education } : {}),
    ...(f.shift ? { shift: f.shift } : {}),
    ...(f.englishLevel ? { englishLevel: f.englishLevel } : {}),
    ...(f.company ? { company: f.company } : {}),
    ...(f.vehicle ? { vehicle: f.vehicle } : {}),
    ...(f.verifiedOnly ? { verifiedOnly: f.verifiedOnly } : {}),
    ...(extras.sort && extras.sort !== "newest" ? { sort: extras.sort } : {}),
    ...(extras.page && extras.page > 1 ? { page: extras.page } : {}),
  };
}

// "/jobs/$jobId" nests under this route in the generated route tree (shared
// "jobs" file prefix), so this component must yield to it via <Outlet />
// instead of always rendering the list — same pattern as
// _authenticated/employer/jobs.tsx's EmployerJobs/EmployerJobsList split.
function JobsPage() {
  const { pathname } = useLocation();
  if (pathname !== "/jobs") return <Outlet />;

  return <JobsList />;
}

function JobsList() {
  const urlSearch = useSearch({ from: "/jobs" });
  const navigate = useNavigate({ from: "/jobs" });
  const [filters, setFilters] = useState<Filters>(() => filtersFromSearch(urlSearch));
  const [draft, setDraft] = useState<Filters>(() => filtersFromSearch(urlSearch));
  const sort: SortKey = urlSearch.sort ?? "newest";
  const page = Math.max(1, urlSearch.page ?? 1);
  const [jobs, setJobs] = useState<JobCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isEmployer, setIsEmployer] = useState(false);
  const jobTitles = useJobTitleSuggestions();

  // Same session + role check Navbar/CandidateShell use, so the candidate
  // bottom tab bar only shows for logged-in candidates (not employers/guests).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return setIsEmployer(false);
    let cancelled = false;
    supabase
      .from("employer_members")
      .select("company_id")
      .eq("user_id", uid)
      .limit(1)
      .then(({ data: rows }) => {
        if (!cancelled) setIsEmployer(!!rows?.length);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const showCandidateTabBar = !!session && !isEmployer;

  // Keep state in sync when the URL changes (e.g. navigating from Home).
  useEffect(() => {
    const next = filtersFromSearch(urlSearch);
    setFilters(next);
    setDraft(next);
  }, [
    urlSearch.q,
    urlSearch.city,
    urlSearch.category,
    urlSearch.jobType,
    urlSearch.workMode,
    urlSearch.minSalary,
    urlSearch.maxSalary,
    urlSearch.minExp,
    urlSearch.maxExp,
    urlSearch.datePosted,
    urlSearch.education,
    urlSearch.shift,
    urlSearch.englishLevel,
    urlSearch.company,
    urlSearch.vehicle,
    urlSearch.verifiedOnly,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("jobs")
        .select(
          "id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies!inner (name, is_verified)",
          { count: "exact" },
        )
        .eq("status", "active");

      if (sort === "newest") q = q.order("created_at", { ascending: false });
      else if (sort === "oldest") q = q.order("created_at", { ascending: true });
      else if (sort === "salary_high")
        q = q.order("max_salary", { ascending: false, nullsFirst: false });
      else if (sort === "salary_low")
        q = q.order("min_salary", { ascending: true, nullsFirst: false });

      if (filters.q) q = q.ilike("title", `%${filters.q}%`);
      if (filters.city) q = q.ilike("city", `%${filters.city}%`);
      if (filters.category) q = q.eq("category", filters.category);
      if (filters.jobType) q = q.eq("job_type", filters.jobType as never);
      if (filters.workMode) q = q.eq("work_mode", filters.workMode as never);
      if (filters.minSalary) q = q.gte("min_salary", Number(filters.minSalary));
      if (filters.maxSalary) q = q.lte("max_salary", Number(filters.maxSalary));
      // Job's accepted experience range must overlap the candidate's selected range.
      if (filters.maxExp) q = q.lte("min_experience_years", Number(filters.maxExp));
      if (filters.minExp)
        q = q.or(`max_experience_years.gte.${Number(filters.minExp)},max_experience_years.is.null`);
      if (filters.datePosted) {
        const cutoff = datePostedCutoffIso(filters.datePosted);
        if (cutoff) q = q.gte("created_at", cutoff);
      }
      if (filters.education) q = q.eq("education", filters.education);
      if (filters.shift) q = q.eq("shift", filters.shift as never);
      if (filters.englishLevel) q = q.eq("english_level", filters.englishLevel);
      if (filters.company) q = q.ilike("companies.name", `%${filters.company}%`);
      if (filters.vehicle) q = q.contains("required_assets", ["Two-wheeler"]);
      if (filters.verifiedOnly) q = q.eq("companies.is_verified", true);

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.range(from, to);

      const { data, count, error } = await q;
      if (!cancelled) {
        if (error) console.error(error);
        setJobs((data as unknown as JobCardData[]) || []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, sort, page]);

  const apply = () => {
    setFilters(draft);
    setMobileFilters(false);
    // Filter change resets to page 1, preserves sort.
    navigate({ search: buildSearch(draft, { sort }), replace: true });
  };
  const reset = () => {
    setDraft(empty);
    setFilters(empty);
    navigate({ search: {}, replace: true });
  };
  const setSort = (next: SortKey) => {
    navigate({ search: buildSearch(filters, { sort: next }), replace: true });
  };
  const setPage = (next: number) => {
    navigate({ search: buildSearch(filters, { sort, page: next }) });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div
      className={`flex min-h-screen flex-col bg-surface ${showCandidateTabBar ? "pb-20 lg:pb-0" : ""}`}
    >
      <Navbar />

      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-row flex-nowrap items-center gap-2 sm:gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <AutocompleteInput
                value={draft.q}
                onChange={(v) => setDraft({ ...draft, q: v })}
                onSubmit={apply}
                suggestions={jobTitles}
                placeholder="Job title, role or skill"
                wrapperClassName="relative w-full"
                inputClassName="form-input pl-9"
                aria-label="Job title, role or skill"
              />
            </div>
            <div className="relative w-24 shrink-0 sm:w-64">
              <AutocompleteInput
                value={draft.city}
                onChange={(v) => setDraft({ ...draft, city: v })}
                onSubmit={apply}
                suggestions={INDIAN_CITIES}
                placeholder="City"
                wrapperClassName="relative w-full"
                inputClassName="form-input"
                aria-label="City"
              />
            </div>
            <button
              onClick={apply}
              aria-label="Search"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark sm:px-6"
            >
              <Search className="h-4 w-4" /> <span className="hidden sm:inline">Search</span>
            </button>
            <button
              onClick={() => setMobileFilters(true)}
              aria-label="Filters"
              className="relative inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground lg:hidden"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">
                Filters{activeCount ? ` (${activeCount})` : ""}
              </span>
              {activeCount > 0 && (
                <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground sm:hidden">
                  {activeCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="hidden w-64 shrink-0 lg:block">
          <FilterPanel draft={draft} setDraft={setDraft} apply={apply} reset={reset} />
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : total === 0
                  ? "No jobs found"
                  : `${total.toLocaleString("en-IN")} job${total === 1 ? "" : "s"} · page ${page} of ${totalPages}`}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sort by</span>
              <select
                className="form-input w-auto"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="salary_high">Salary: high to low</option>
                <option value="salary_low">Salary: low to high</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Briefcase className="mb-3 h-8 w-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">No jobs match your filters</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try clearing filters or searching a different city.
              </p>
              <button
                onClick={reset}
                className="mt-4 inline-flex h-10 items-center rounded-lg border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary-light"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid gap-4">
                {jobs.map((j) => (
                  <JobCard key={j.id} job={j} />
                ))}
              </div>
              {totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              )}
            </>
          )}
        </main>
      </div>

      {mobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setMobileFilters(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Filters</h2>
              <button onClick={() => setMobileFilters(false)} className="rounded-lg p-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <FilterPanel draft={draft} setDraft={setDraft} apply={apply} reset={reset} />
          </div>
        </div>
      )}

      {showCandidateTabBar && <CandidateMobileTabBar />}
    </div>
  );
}

function FilterPanel({
  draft,
  setDraft,
  apply,
  reset,
}: {
  draft: Filters;
  setDraft: (f: Filters) => void;
  apply: () => void;
  reset: () => void;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <Section label="Category">
        <select
          className="form-input"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
        >
          <option value="">All categories</option>
          {JOB_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Job type">
        <select
          className="form-input"
          value={draft.jobType}
          onChange={(e) => setDraft({ ...draft, jobType: e.target.value })}
        >
          <option value="">Any</option>
          {JOB_TYPE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Work mode">
        <select
          className="form-input"
          value={draft.workMode}
          onChange={(e) => setDraft({ ...draft, workMode: e.target.value })}
        >
          <option value="">Any</option>
          {WORK_MODES.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Salary (₹/month)">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="Min"
            className="form-input"
            value={draft.minSalary}
            onChange={(e) => setDraft({ ...draft, minSalary: e.target.value })}
          />
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="Max"
            className="form-input"
            value={draft.maxSalary}
            onChange={(e) => setDraft({ ...draft, maxSalary: e.target.value })}
          />
        </div>
      </Section>
      <Section label="Experience (years)">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={0}
            placeholder="Min"
            className="form-input"
            value={draft.minExp}
            onChange={(e) => setDraft({ ...draft, minExp: e.target.value })}
          />
          <input
            type="number"
            min={0}
            placeholder="Max"
            className="form-input"
            value={draft.maxExp}
            onChange={(e) => setDraft({ ...draft, maxExp: e.target.value })}
          />
        </div>
      </Section>
      <Section label="Date posted">
        <select
          className="form-input"
          value={draft.datePosted}
          onChange={(e) => setDraft({ ...draft, datePosted: e.target.value })}
        >
          <option value="">Any time</option>
          {DATE_POSTED_OPTIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Education required">
        <select
          className="form-input"
          value={draft.education}
          onChange={(e) => setDraft({ ...draft, education: e.target.value })}
        >
          <option value="">Any</option>
          {EDUCATION_LEVELS.map((ed) => (
            <option key={ed} value={ed}>
              {ed}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Shift">
        <select
          className="form-input"
          value={draft.shift}
          onChange={(e) => setDraft({ ...draft, shift: e.target.value })}
        >
          <option value="">Any</option>
          {SHIFTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Section>
      <Section label="English level">
        <select
          className="form-input"
          value={draft.englishLevel}
          onChange={(e) => setDraft({ ...draft, englishLevel: e.target.value })}
        >
          <option value="">Any</option>
          {ENGLISH_LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Company">
        <input
          placeholder="Search by company name"
          className="form-input"
          value={draft.company}
          onChange={(e) => setDraft({ ...draft, company: e.target.value })}
        />
      </Section>
      <div className="space-y-3 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={draft.verifiedOnly === "1"}
            onChange={(e) => setDraft({ ...draft, verifiedOnly: e.target.checked ? "1" : "" })}
          />
          Verified employers only
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={draft.vehicle === "1"}
            onChange={(e) => setDraft({ ...draft, vehicle: e.target.checked ? "1" : "" })}
          />
          Two-wheeler required
        </label>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={apply}
          className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
        >
          Apply
        </button>
        <button
          onClick={reset}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

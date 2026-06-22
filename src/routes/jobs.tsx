import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, ChevronLeft, ChevronRight, Filter, Loader2, Search, X } from "lucide-react";
import { z } from "zod";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;
const SORT_OPTIONS = ["newest", "oldest", "salary_high", "salary_low"] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

const jobsSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  workMode: z.string().optional(),
  minSalary: z.string().optional(),
  sort: z.enum(SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

type JobsSearch = z.infer<typeof jobsSearchSchema>;

export const Route = createFileRoute("/jobs")({
  validateSearch: jobsSearchSchema,
  head: () => ({
    meta: [
      { title: "Browse Jobs · JobsKart" },
      { name: "description", content: "Search lakhs of full-time, part-time and field jobs across India on JobsKart." },
      { property: "og:title", content: "Browse Jobs on JobsKart" },
      { property: "og:description", content: "Find delivery, sales, security, telecaller, warehouse and more jobs near you." },
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
};

const empty: Filters = { q: "", city: "", category: "", jobType: "", workMode: "", minSalary: "" };

function filtersFromSearch(s: JobsSearch): Filters {
  return {
    q: s.q ?? "",
    city: s.city ?? "",
    category: s.category ?? "",
    jobType: s.jobType ?? "",
    workMode: s.workMode ?? "",
    minSalary: s.minSalary ?? "",
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
    ...(extras.sort && extras.sort !== "newest" ? { sort: extras.sort } : {}),
    ...(extras.page && extras.page > 1 ? { page: extras.page } : {}),
  };
}

function JobsPage() {
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

  // Keep state in sync when the URL changes (e.g. navigating from Home).
  useEffect(() => {
    const next = filtersFromSearch(urlSearch);
    setFilters(next);
    setDraft(next);
  }, [urlSearch.q, urlSearch.city, urlSearch.category, urlSearch.jobType, urlSearch.workMode, urlSearch.minSalary]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("jobs")
        .select(
          "id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)",
          { count: "exact" },
        )
        .eq("status", "active");

      if (sort === "newest") q = q.order("created_at", { ascending: false });
      else if (sort === "oldest") q = q.order("created_at", { ascending: true });
      else if (sort === "salary_high") q = q.order("max_salary", { ascending: false, nullsFirst: false });
      else if (sort === "salary_low") q = q.order("min_salary", { ascending: true, nullsFirst: false });

      if (filters.q) q = q.ilike("title", `%${filters.q}%`);
      if (filters.city) q = q.ilike("city", `%${filters.city}%`);
      if (filters.category) q = q.eq("category", filters.category);
      if (filters.jobType) q = q.eq("job_type", filters.jobType as never);
      if (filters.workMode) q = q.eq("work_mode", filters.workMode as never);
      if (filters.minSalary) q = q.gte("min_salary", Number(filters.minSalary));

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

  const activeCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters],
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Navbar />

      <section className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder="Job title, role or skill"
                className="form-input pl-9"
              />
            </div>
            <div className="relative sm:w-64">
              <input
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder="City"
                className="form-input"
              />
            </div>
            <button
              onClick={apply}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
            >
              <Search className="h-4 w-4" /> Search
            </button>
            <button
              onClick={() => setMobileFilters(true)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground lg:hidden"
            >
              <Filter className="h-4 w-4" /> Filters{activeCount ? ` (${activeCount})` : ""}
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
                className="form-input h-9 w-auto"
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
              <p className="mt-1 text-sm text-muted-foreground">Try clearing filters or searching a different city.</p>
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
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMobileFilters(false)} />
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

      <Footer />
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const windowSize = 5;
  const start = Math.max(1, Math.min(page - 2, totalPages - windowSize + 1));
  const end = Math.min(totalPages, start + windowSize - 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-1" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-surface disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4" /> Prev
      </button>
      {start > 1 && (
        <>
          <PageBtn n={1} active={page === 1} onClick={onChange} />
          {start > 2 && <span className="px-2 text-muted-foreground">…</span>}
        </>
      )}
      {pages.map((p) => (
        <PageBtn key={p} n={p} active={p === page} onClick={onChange} />
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="px-2 text-muted-foreground">…</span>}
          <PageBtn n={totalPages} active={page === totalPages} onClick={onChange} />
        </>
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-surface disabled:opacity-50"
      >
        Next <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

function PageBtn({ n, active, onClick }: { n: number; active: boolean; onClick: (p: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-sm font-medium ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-surface"
      }`}
    >
      {n}
    </button>
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
        <select className="form-input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
          <option value="">All categories</option>
          {["Delivery", "Sales", "Security", "Warehouse", "Telecaller", "Driver", "Housekeeping", "Cook", "Retail", "Nurse"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Section>
      <Section label="Job type">
        <select className="form-input" value={draft.jobType} onChange={(e) => setDraft({ ...draft, jobType: e.target.value })}>
          <option value="">Any</option>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="internship">Internship</option>
        </select>
      </Section>
      <Section label="Work mode">
        <select className="form-input" value={draft.workMode} onChange={(e) => setDraft({ ...draft, workMode: e.target.value })}>
          <option value="">Any</option>
          <option value="onsite">On-site</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="field">Field job</option>
        </select>
      </Section>
      <Section label="Minimum salary (₹/month)">
        <input
          type="number"
          min={0}
          step={1000}
          placeholder="e.g. 15000"
          className="form-input"
          value={draft.minSalary}
          onChange={(e) => setDraft({ ...draft, minSalary: e.target.value })}
        />
      </Section>
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

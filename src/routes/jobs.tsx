import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Filter, Loader2, Search, X } from "lucide-react";
import { z } from "zod";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { supabase } from "@/integrations/supabase/client";

const jobsSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  workMode: z.string().optional(),
  minSalary: z.string().optional(),
});

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

function filtersFromSearch(s: z.infer<typeof jobsSearchSchema>): Filters {
  return {
    q: s.q ?? "",
    city: s.city ?? "",
    category: s.category ?? "",
    jobType: s.jobType ?? "",
    workMode: s.workMode ?? "",
    minSalary: s.minSalary ?? "",
  };
}

function JobsPage() {
  const urlSearch = useSearch({ from: "/jobs" });
  const navigate = useNavigate({ from: "/jobs" });
  const [filters, setFilters] = useState<Filters>(() => filtersFromSearch(urlSearch));
  const [draft, setDraft] = useState<Filters>(() => filtersFromSearch(urlSearch));
  const [jobs, setJobs] = useState<JobCardData[]>([]);
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
        )
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(50);

      if (filters.q) q = q.ilike("title", `%${filters.q}%`);
      if (filters.city) q = q.ilike("city", `%${filters.city}%`);
      if (filters.category) q = q.eq("category", filters.category);
      if (filters.jobType) q = q.eq("job_type", filters.jobType as never);
      if (filters.workMode) q = q.eq("work_mode", filters.workMode as never);
      if (filters.minSalary) q = q.gte("min_salary", Number(filters.minSalary));

      const { data, error } = await q;
      if (!cancelled) {
        if (error) console.error(error);
        setJobs((data as unknown as JobCardData[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const apply = () => {
    setFilters(draft);
    setMobileFilters(false);
    navigate({
      search: {
        ...(draft.q ? { q: draft.q } : {}),
        ...(draft.city ? { city: draft.city } : {}),
        ...(draft.category ? { category: draft.category } : {}),
        ...(draft.jobType ? { jobType: draft.jobType } : {}),
        ...(draft.workMode ? { workMode: draft.workMode } : {}),
        ...(draft.minSalary ? { minSalary: draft.minSalary } : {}),
      },
      replace: true,
    });
  };
  const reset = () => {
    setDraft(empty);
    setFilters(empty);
    navigate({ search: {}, replace: true });
  };

  const activeCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);

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
        {/* Sidebar filters */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <FilterPanel draft={draft} setDraft={setDraft} apply={apply} reset={reset} />
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {loading ? "Loading…" : `${jobs.length} job${jobs.length === 1 ? "" : "s"} found`}
            </p>
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
            <div className="grid gap-4">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Mobile filter drawer */}
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

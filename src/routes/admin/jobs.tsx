import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Star, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/site/Pagination";
import { adminListJobs, adminToggleJobFeatured, adminCloseJob } from "@/lib/admin.functions";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/admin/jobs")({
  component: Page,
});

type JobRow = {
  id: string;
  title: string;
  status: string;
  is_featured: boolean | null;
  applications_count: number | null;
  companies: { name: string } | null;
};

// Same status values the page already used before this change
// (jobs.status: "active" | "draft" | "closed").
function statusTone(status: string): "success" | "warning" | "muted" {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  return "muted";
}

const DOT_TONE: Record<"success" | "warning" | "muted", string> = {
  success: "bg-success",
  warning: "bg-warning",
  muted: "bg-muted-foreground",
};

const PILL_TONE: Record<"success" | "warning" | "muted", string> = {
  success: "border-success/30 bg-success-light text-success",
  warning: "border-warning/30 bg-warning-light text-warning",
  muted: "border-border bg-surface text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${PILL_TONE[tone]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`} />
      {status}
    </span>
  );
}

function companyInitials(name: string | null | undefined) {
  return (name || "—").trim().slice(0, 2).toUpperCase();
}

function Page() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const list = useServerFn(adminListJobs);
  const tog = useServerFn(adminToggleJobFeatured);
  const close = useServerFn(adminCloseJob);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "jobs", search],
    queryFn: () => list({ data: { search } }),
  });
  const mTog = useMutation({
    mutationFn: (v: { jobId: string; featured: boolean }) => tog({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
  });
  const mClose = useMutation({
    mutationFn: (jobId: string) => close({ data: { jobId } }),
    onSuccess: () => {
      toast.success("Closed");
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
  });
  const rows = useMemo(() => (data?.rows ?? []) as JobRow[], [data]);

  // Stat cards: counts by status from this same already-loaded page of jobs
  // (see the file-level note in the final report — adminListJobs caps at the
  // 200 most-recently-created jobs matching the current search, so these are
  // partial totals, not every job in the database. No new RPC/SQL added.)
  const counts = useMemo(() => {
    const c = { total: rows.length, active: 0, draft: 0, closed: 0 };
    for (const r of rows) {
      if (r.status === "active") c.active++;
      else if (r.status === "draft") c.draft++;
      else if (r.status === "closed") c.closed++;
    }
    return c;
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <AdminShell title="Jobs" subtitle="Moderate and feature job postings">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Total postings
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{counts.total}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Active jobs
          </p>
          <p className="mt-1 text-2xl font-bold text-success">{counts.active}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Draft
          </p>
          <p className="mt-1 text-2xl font-bold text-warning">{counts.draft}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Closed
          </p>
          <p className="mt-1 text-2xl font-bold text-muted-foreground">{counts.closed}</p>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <div className="relative max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search title"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No jobs.</p>
        ) : (
          visibleRows.map((j) => (
            <div
              key={j.id}
              className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    aria-hidden="true"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-light text-sm font-bold text-primary"
                  >
                    {companyInitials(j.companies?.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{j.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold">{j.companies?.name ?? "—"}</span>
                      <span aria-hidden="true">•</span>
                      <span className="inline-flex items-center gap-1">
                        <Users aria-hidden="true" className="h-3 w-3" />
                        {j.applications_count ?? 0} applicants
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-between">
                  <StatusPill status={j.status} />
                  {j.is_featured ? (
                    <Badge variant="info" className="inline-flex items-center gap-1">
                      <Star aria-hidden="true" className="h-3 w-3 fill-current" /> Featured
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex gap-2 border-t border-border pt-3 max-sm:flex-col">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => mTog.mutate({ jobId: j.id, featured: !j.is_featured })}
                  disabled={mTog.isPending}
                  className="gap-1.5 max-sm:h-11 max-sm:flex-1"
                >
                  <Star
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 ${j.is_featured ? "fill-current" : ""}`}
                  />
                  {j.is_featured ? "Unfeature" : "Feature"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => mClose.mutate(j.id)}
                  disabled={mClose.isPending}
                  className="max-sm:h-11 max-sm:flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      {totalPages > 1 ? (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          onChange={setPage}
          ariaLabel="Jobs pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}

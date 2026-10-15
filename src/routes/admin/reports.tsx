import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/site/Pagination";
import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { adminListReports, adminResolveReport, adminReverseReport } from "@/lib/admin.functions";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/admin/reports")({
  component: Page,
});

type ReportAction = "dismissed" | "flagged" | "banned";

function Page() {
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const list = useServerFn(adminListReports);
  const resolve = useServerFn(adminResolveReport);
  const reverse = useServerFn(adminReverseReport);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reports", status],
    queryFn: () => list({ data: { status: status || undefined } }),
  });

  const mut = useMutation({
    mutationFn: (v: { reportId: string; reportType: "job" | "company"; action: ReportAction }) =>
      resolve({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.action === "dismissed"
          ? "Report dismissed."
          : v.action === "flagged"
            ? "Flagged for tracking."
            : v.reportType === "job"
              ? "Job removed."
              : "Company banned — all its jobs were closed.",
      );
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const reverseMut = useMutation({
    mutationFn: (v: { reportId: string; reportType: "job" | "company" }) => reverse({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(
        v.reportType === "job"
          ? "Job restored — visible again."
          : "Company unbanned — its jobs are visible again.",
      );
      qc.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <AdminShell title="Reports" subtitle="Candidate reports of fake jobs and companies">
      <ThemedSelect
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-xs"
      >
        <option value="open">Open</option>
        <option value="flagged">Flagged</option>
        <option value="dismissed">Dismissed</option>
        <option value="banned">Banned</option>
        <option value="">All</option>
      </ThemedSelect>
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No reports.</p>
        ) : (
          visibleRows.map((r) => (
            <div key={`${r.type}-${r.id}`} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{r.type === "job" ? "Job" : "Company"}</Badge>
                    <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                      {r.status}
                    </Badge>
                  </div>
                  <p className="mt-1 break-words font-semibold text-foreground">
                    {r.type === "job" ? (
                      <Link
                        to="/jobs/$jobId"
                        params={{ jobId: r.targetId }}
                        className="hover:underline"
                      >
                        {r.targetTitle}
                      </Link>
                    ) : (
                      r.targetTitle
                    )}
                  </p>
                  {r.companyName && (
                    <p className="text-xs text-muted-foreground">{r.companyName}</p>
                  )}
                  <p className="mt-2 text-sm text-foreground/80">{r.reason}</p>
                  {r.details && <p className="mt-1 text-xs text-muted-foreground">{r.details}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Reported by {r.reporter?.full_name || r.reporter?.email || "a candidate"} ·{" "}
                    {new Date(r.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                  </p>
                </div>
                {r.status === "open" && (
                  <div className="flex shrink-0 items-center gap-2 max-sm:flex-wrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={mut.isPending}
                      onClick={() =>
                        mut.mutate({ reportId: r.id, reportType: r.type, action: "dismissed" })
                      }
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mut.isPending}
                      onClick={() =>
                        mut.mutate({ reportId: r.id, reportType: r.type, action: "flagged" })
                      }
                    >
                      Flag
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={mut.isPending}
                      onClick={() =>
                        mut.mutate({ reportId: r.id, reportType: r.type, action: "banned" })
                      }
                    >
                      {r.type === "job" ? "Remove job" : "Ban company"}
                    </Button>
                  </div>
                )}
                {r.status === "flagged" && (
                  <div className="flex shrink-0 items-center gap-2 max-sm:flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reverseMut.isPending}
                      onClick={() => reverseMut.mutate({ reportId: r.id, reportType: r.type })}
                    >
                      Unflag
                    </Button>
                  </div>
                )}
                {r.status === "banned" && (
                  <div className="flex shrink-0 items-center gap-2 max-sm:flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reverseMut.isPending}
                      onClick={() => reverseMut.mutate({ reportId: r.id, reportType: r.type })}
                    >
                      {r.type === "job" ? "Restore job" : "Unban company"}
                    </Button>
                  </div>
                )}
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
          ariaLabel="Reports pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/site/Pagination";
import { adminListResumes } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/resumes")({
  component: Page,
});

const PAGE_SIZE = 10;

function Page() {
  const fn = useServerFn(adminListResumes);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-resumes"],
    queryFn: () => fn(),
  });
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <AdminShell title="Resumes" subtitle="All candidate-uploaded resumes">
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Could not load resumes: {error instanceof Error ? error.message : "Unknown error"}
          </p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No resumes uploaded yet.</p>
        ) : (
          visibleRows.map((r: any) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{r.profiles?.full_name || "Unnamed"}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {r.profiles?.mobile || r.profiles?.email} • {r.file_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline" disabled={!r.signed_url} className="min-h-11 sm:min-h-0">
                  <a href={r.signed_url ?? undefined} target="_blank" rel="noreferrer">View</a>
                </Button>
                <Button asChild size="sm" variant="outline" disabled={!r.download_url} className="min-h-11 sm:min-h-0">
                  <a href={r.download_url ?? undefined} target="_blank" rel="noreferrer">Download</a>
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
          ariaLabel="Resumes pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/site/Pagination";
import { adminListCompanies, adminSetCompanyVerification } from "@/lib/admin.functions";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/admin/companies")({
  component: Page,
});

function Page() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const list = useServerFn(adminListCompanies);
  const setV = useServerFn(adminSetCompanyVerification);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "companies", search],
    queryFn: () => list({ data: { search } }),
  });
  const mut = useMutation({
    mutationFn: (v: { companyId: string; status: "verified" | "pending" | "rejected" }) =>
      setV({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
    },
  });
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <AdminShell title="Companies" subtitle="Approve and moderate employers">
      <Input
        placeholder="Search company"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-xs"
      />
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No companies yet.</p>
        ) : (
          visibleRows.map((c: any) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 max-sm:flex-col max-sm:items-stretch"
            >
              <div className="max-sm:min-w-0">
                <p className="break-words font-semibold text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.industry || "—"} • {c.hq_city || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2 max-sm:flex-wrap">
                <Badge variant={c.verification_status === "verified" ? "secondary" : "outline"}>
                  {c.verification_status || "pending"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mut.mutate({ companyId: c.id, status: "verified" })}
                >
                  Verify
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => mut.mutate({ companyId: c.id, status: "rejected" })}
                >
                  Reject
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
          ariaLabel="Companies pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}

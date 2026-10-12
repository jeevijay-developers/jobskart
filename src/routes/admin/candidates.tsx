import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/site/Pagination";
import { toast } from "sonner";
import { adminListUsers, adminSetUserStatus } from "@/lib/admin.functions";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/admin/candidates")({
  component: CandidatesPage,
});

// Candidate accounts only: the same list/status functions as the Users page, with the user type
// fixed to "candidate" so employers and other roles never appear here.
function CandidatesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");
  const [page, setPage] = useState(1);
  const list = useServerFn(adminListUsers);
  const setUserStatus = useServerFn(adminSetUserStatus);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", "candidates", search, status],
    queryFn: () => list({ data: { search, userType: "candidate", status } }),
  });
  const mStatus = useMutation({
    mutationFn: (v: { userId: string; status: "active" | "suspended" }) =>
      setUserStatus({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <AdminShell title="Candidates" subtitle="Registered candidate accounts">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search name, mobile, email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
        />
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "active", "suspended"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setStatus(t);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                status === t
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="hidden grid-cols-5 gap-3 border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
          <div className="col-span-2">Name</div>
          <div>Mobile</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : !rows.length ? (
          <p className="p-6 text-sm text-muted-foreground">No candidates.</p>
        ) : (
          visibleRows.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-1 gap-2 border-b border-border px-4 py-3 text-sm sm:grid-cols-5 sm:gap-3"
            >
              <div className="col-span-2">
                <p className="font-medium text-foreground">{u.full_name || "—"}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="text-muted-foreground">{u.mobile || "—"}</div>
              <div>
                <Badge variant={u.status === "suspended" ? "destructive" : "secondary"}>
                  {u.status}
                </Badge>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mStatus.mutate({
                      userId: u.id,
                      status: u.status === "suspended" ? "active" : "suspended",
                    })
                  }
                >
                  {u.status === "suspended" ? "Activate" : "Suspend"}
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
          ariaLabel="Candidates pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}

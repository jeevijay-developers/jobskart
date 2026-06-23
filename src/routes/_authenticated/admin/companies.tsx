import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminListCompanies, adminSetCompanyVerification } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/companies")({
  component: Page,
});

function Page() {
  const [search, setSearch] = useState("");
  const list = useServerFn(adminListCompanies);
  const setV = useServerFn(adminSetCompanyVerification);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "companies", search], queryFn: () => list({ data: { search } }) });
  const mut = useMutation({
    mutationFn: (v: { companyId: string; status: "verified" | "pending" | "rejected" }) => setV({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
    },
  });
  return (
    <AdminShell title="Companies" subtitle="Approve and moderate employers">
      <Input placeholder="Search company" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-xs" />
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data?.rows?.length ? (
          <p className="text-sm text-muted-foreground">No companies yet.</p>
        ) : (
          data.rows.map((c: any) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div>
                <p className="font-semibold text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.industry || "—"} • {c.hq_city || "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={c.verification_status === "verified" ? "secondary" : "outline"}>{c.verification_status || "pending"}</Badge>
                <Button size="sm" variant="outline" onClick={() => mut.mutate({ companyId: c.id, status: "verified" })}>Verify</Button>
                <Button size="sm" variant="ghost" onClick={() => mut.mutate({ companyId: c.id, status: "rejected" })}>Reject</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </AdminShell>
  );
}

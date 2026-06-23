import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminListJobs, adminToggleJobFeatured, adminCloseJob } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/jobs")({
  component: Page,
});

function Page() {
  const [search, setSearch] = useState("");
  const list = useServerFn(adminListJobs);
  const tog = useServerFn(adminToggleJobFeatured);
  const close = useServerFn(adminCloseJob);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "jobs", search], queryFn: () => list({ data: { search } }) });
  const mTog = useMutation({
    mutationFn: (v: { jobId: string; featured: boolean }) => tog({ data: v }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["admin", "jobs"] }); },
  });
  const mClose = useMutation({
    mutationFn: (jobId: string) => close({ data: { jobId } }),
    onSuccess: () => { toast.success("Closed"); qc.invalidateQueries({ queryKey: ["admin", "jobs"] }); },
  });
  return (
    <AdminShell title="Jobs" subtitle="Moderate and feature job postings">
      <Input placeholder="Search title" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-xs" />
      <div className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
          !data?.rows?.length ? <p className="text-sm text-muted-foreground">No jobs.</p> :
          data.rows.map((j: any) => (
            <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div>
                <p className="font-semibold text-foreground">{j.title}</p>
                <p className="text-xs text-muted-foreground">{j.companies?.name ?? "—"} • {j.applications_count ?? 0} applicants</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={j.status === "active" ? "secondary" : "outline"}>{j.status}</Badge>
                {j.is_featured ? <Badge>Featured</Badge> : null}
                <Button size="sm" variant="outline" onClick={() => mTog.mutate({ jobId: j.id, featured: !j.is_featured })}>
                  {j.is_featured ? "Unfeature" : "Feature"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => mClose.mutate(j.id)}>Close</Button>
              </div>
            </div>
          ))}
      </div>
    </AdminShell>
  );
}

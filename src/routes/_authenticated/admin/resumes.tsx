import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { adminListResumes } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/resumes")({
  component: Page,
});

function Page() {
  const fn = useServerFn(adminListResumes);
  const { data, isLoading } = useQuery({ queryKey: ["admin-resumes"], queryFn: () => fn() });
  return (
    <AdminShell title="Resumes" subtitle="All candidate-uploaded resumes">
      <div className="space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
          !data?.rows?.length ? <p className="text-sm text-muted-foreground">No resumes uploaded yet.</p> :
          data.rows.map((r: any) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{r.profiles?.full_name || "Unnamed"}</p>
                <p className="text-xs text-muted-foreground">{r.profiles?.mobile || r.profiles?.email} • {r.file_name}</p>
              </div>
              <Button asChild size="sm" variant="outline" disabled={!r.signed_url}>
                <a href={r.signed_url} target="_blank" rel="noreferrer">Download</a>
              </Button>
            </div>
          ))}
      </div>
    </AdminShell>
  );
}

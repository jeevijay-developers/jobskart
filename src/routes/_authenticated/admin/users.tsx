import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { adminListUsers, adminSetUserStatus, adminDeleteUser } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const [search, setSearch] = useState("");
  const [userType, setUserType] = useState<"all" | "candidate" | "employer">("all");
  const list = useServerFn(adminListUsers);
  const setStatus = useServerFn(adminSetUserStatus);
  const del = useServerFn(adminDeleteUser);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", search, userType],
    queryFn: () => list({ data: { search, userType, status: "all" } }),
  });
  const mStatus = useMutation({
    mutationFn: (v: { userId: string; status: "active" | "suspended" }) => setStatus({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
  const mDel = useMutation({
    mutationFn: (userId: string) => del({ data: { userId } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AdminShell title="Users" subtitle="Manage candidates and employers">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="Search name, mobile, email" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["all", "candidate", "employer"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setUserType(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                userType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="hidden grid-cols-6 gap-3 border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
          <div className="col-span-2">Name</div>
          <div>Mobile</div>
          <div>Type</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : !data?.rows?.length ? (
          <p className="p-6 text-sm text-muted-foreground">No users.</p>
        ) : (
          data.rows.map((u: any) => (
            <div key={u.id} className="grid grid-cols-1 gap-2 border-b border-border px-4 py-3 text-sm sm:grid-cols-6 sm:gap-3">
              <div className="col-span-2">
                <p className="font-medium text-foreground">{u.full_name || "—"}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="text-muted-foreground">{u.mobile || "—"}</div>
              <div><Badge variant="outline">{u.user_type}</Badge></div>
              <div>
                <Badge variant={u.status === "suspended" ? "destructive" : "secondary"}>{u.status}</Badge>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mStatus.mutate({ userId: u.id, status: u.status === "suspended" ? "active" : "suspended" })}
                >
                  {u.status === "suspended" ? "Activate" : "Suspend"}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => confirm("Delete user?") && mDel.mutate(u.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </AdminShell>
  );
}

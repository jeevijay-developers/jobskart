import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminStats } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: Dash,
});

function Dash() {
  const fn = useServerFn(adminStats);
  const { data } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => fn() });
  const items = [
    { label: "Users", value: data?.users ?? "—" },
    { label: "Companies", value: data?.companies ?? "—" },
    { label: "Jobs", value: data?.jobs ?? "—" },
    { label: "Applications", value: data?.applications ?? "—" },
    { label: "Revenue (₹)", value: data?.revenue?.toLocaleString("en-IN") ?? "—" },
  ];
  return (
    <AdminShell title="Platform Overview" subtitle="Live KPIs across Jobskart">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((it) => (
          <div key={it.label} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{it.label}</p>
            <p className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">{it.value}</p>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

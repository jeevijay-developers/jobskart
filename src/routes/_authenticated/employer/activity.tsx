import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ActivityFeed, type ActivityItem } from "@/components/employer/ActivityFeed";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/activity")({
  head: () => ({ meta: [{ title: "Activity · JobsKart" }] }),
  component: ActivityPage,
});

const KINDS = [
  { value: "", label: "Everything" },
  { value: "application", label: "Applications" },
  { value: "job", label: "Jobs" },
  { value: "credits", label: "Credits" },
  { value: "candidate", label: "Database" },
  { value: "team", label: "Team" },
] as const;

function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      let cid = getActiveCompanyId();
      if (!cid) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const ms = await fetchMyCompanies(u.user.id);
          cid = ms[0]?.company_id ?? null;
        }
      }
      if (!cid) { setLoading(false); return; }
      let q = supabase
        .from("employer_activity")
        .select("id, kind, title, body, link, created_at, metadata")
        .eq("company_id", cid)
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter) q = q.like("kind", `${filter}.%`);
      const { data } = await q;
      setItems((data || []) as ActivityItem[]);
      setLoading(false);
    })();
  }, [filter]);

  return (
    <EmployerShell title="Activity" subtitle="Every event across your hiring workspace.">
      <div className="mb-4 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setFilter(k.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === k.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground/80 hover:bg-surface"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <ActivityFeed items={items} loading={loading} />
      </section>
    </EmployerShell>
  );
}

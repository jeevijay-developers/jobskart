import { createFileRoute } from "@tanstack/react-router";
import { differenceInCalendarDays, startOfDay } from "date-fns";
import { useEffect, useState } from "react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ActivityFeed, type ActivityItem } from "@/components/employer/ActivityFeed";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/activity")({
  head: () => ({ meta: [{ title: "Activity · JobsKart" }] }),
  component: ActivityPage,
});

const KINDS = [
  { value: "", label: "All" },
  { value: "application", label: "Applications" },
  { value: "job", label: "Jobs" },
  { value: "credits", label: "Credits" },
  { value: "candidate", label: "Database" },
  { value: "team", label: "Team" },
] as const;

// Batch size for "Load More" and for the per-day-group cap on the very first
// render (Today gets up to BATCH_SIZE, then Yesterday also gets up to
// BATCH_SIZE — see initialVisibleCount below). This is a record count, not a
// day-group count: a day with hundreds of records is still capped.
const BATCH_SIZE = 5;
// How many rows to keep buffered client-side ahead of what's currently
// visible, so "Load More" can reveal already-fetched rows instantly most of
// the time without refetching on every single click.
const FETCH_CHUNK = 50;

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date: Date) {
  const daysAgo = differenceInCalendarDays(startOfDay(new Date()), startOfDay(date));
  return daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`;
}

function groupByDay(items: ActivityItem[]) {
  const groups = new Map<string, { label: string; items: ActivityItem[] }>();
  items.forEach((item) => {
    const date = new Date(item.created_at);
    const key = dayKey(date);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { label: dayLabel(date), items: [item] });
  });
  return Array.from(groups.values());
}

// First render only: fill Today fully (capped at BATCH_SIZE), then also fill
// Yesterday fully (capped at BATCH_SIZE) — even though that can show more
// than BATCH_SIZE records total. Every subsequent "Load More" instead adds a
// flat +BATCH_SIZE regardless of day boundaries (see loadMore below).
function initialVisibleCount(items: ActivityItem[]) {
  if (items.length === 0) return 0;
  let count = 0;
  let currentKey: string | null = null;
  let countInCurrentGroup = 0;
  let groupsStarted = 0;

  for (const item of items) {
    const key = dayKey(new Date(item.created_at));
    if (key !== currentKey) {
      if (groupsStarted >= 2) break;
      currentKey = key;
      countInCurrentGroup = 0;
      groupsStarted += 1;
    }
    if (countInCurrentGroup >= BATCH_SIZE) continue;
    countInCurrentGroup += 1;
    count += 1;
  }
  return count;
}

function ActivityPage() {
  // `items` is the full set fetched so far from Supabase (fetched in
  // FETCH_CHUNK-sized pages); `visibleCount` is how many of those are
  // actually shown right now. Load More only ever increases `visibleCount`
  // (by BATCH_SIZE) — it re-fetches more rows from the server only once the
  // client-side buffer runs out.
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreOnServer, setHasMoreOnServer] = useState(false);
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
      setCompanyId(cid);
      if (!cid) setLoading(false);
    })();
  }, []);

  // Filter change resets both the fetched buffer and the visible-record
  // cursor back to the initial (Today + Yesterday) limit.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      let q = supabase
        .from("employer_activity")
        .select("id, kind, title, body, link, created_at, metadata")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .range(0, FETCH_CHUNK);
      if (filter) q = q.like("kind", `${filter}.%`);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data || []) as ActivityItem[];
      const page = rows.slice(0, FETCH_CHUNK);
      setItems(page);
      setVisibleCount(initialVisibleCount(page));
      setHasMoreOnServer(rows.length > FETCH_CHUNK);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId, filter]);

  async function loadMore() {
    if (loadingMore) return;
    const nextVisible = visibleCount + BATCH_SIZE;

    // Enough already fetched to reveal the next batch — no network call needed.
    if (nextVisible <= items.length) {
      setVisibleCount(Math.min(nextVisible, items.length));
      return;
    }

    // Otherwise pull the next chunk from the server first, then reveal.
    if (!companyId || !hasMoreOnServer) {
      setVisibleCount(items.length);
      return;
    }
    setLoadingMore(true);
    let q = supabase
      .from("employer_activity")
      .select("id, kind, title, body, link, created_at, metadata")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(items.length, items.length + FETCH_CHUNK);
    if (filter) q = q.like("kind", `${filter}.%`);
    const { data } = await q;
    const rows = (data || []) as ActivityItem[];
    const page = rows.slice(0, FETCH_CHUNK);
    const merged = [...items, ...page];
    setItems(merged);
    setHasMoreOnServer(rows.length > FETCH_CHUNK);
    setVisibleCount(Math.min(nextVisible, merged.length));
    setLoadingMore(false);
  }

  const visibleItems = items.slice(0, visibleCount);
  const dayGroups = groupByDay(visibleItems);
  const hasMore = visibleCount < items.length || hasMoreOnServer;

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
        {loading || dayGroups.length === 0 ? (
          <ActivityFeed items={visibleItems} loading={loading} />
        ) : (
          <div className="space-y-6">
            {dayGroups.map((group) => (
              <div key={group.label}>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h2>
                <ActivityFeed items={group.items} />
              </div>
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button type="button" variant="outline" onClick={loadMore} disabled={loadingMore}>
                  Load More Activity
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </EmployerShell>
  );
}

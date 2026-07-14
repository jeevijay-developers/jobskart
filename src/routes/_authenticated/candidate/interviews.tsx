import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Calendar, MapPin, Video, Phone, Building2 } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/interviews")({
  head: () => ({ meta: [{ title: "Interviews · JobsKart" }] }),
  component: Page,
});

type Interview = {
  id: string;
  scheduled_at: string;
  mode: string;
  status: string;
  location: string | null;
  meeting_url: string | null;
  notes: string | null;
  jobs: { title: string; companies: { name: string } | null } | null;
};

const ICONS: Record<string, typeof Video> = { online: Video, phone: Phone, in_person: MapPin, walk_in: Building2 };

function Page() {
  const [items, setItems] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return setLoading(false);
      const { data } = await supabase
        .from("interviews")
        .select("id, scheduled_at, mode, status, location, meeting_url, notes, jobs(title, companies(name))")
        .eq("candidate_id", u.user.id)
        .order("scheduled_at", { ascending: true });
      setItems((data || []) as unknown as Interview[]);
      setLoading(false);
    })();
  }, []);

  return (
    <CandidateShell title="Interviews" subtitle="Your upcoming and past interviews">
      {loading ? (
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      ) : !items.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No interviews scheduled yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((iv) => {
            const Icon = ICONS[iv.mode] ?? Calendar;
            const upcoming = new Date(iv.scheduled_at) > new Date();
            return (
              <div key={iv.id} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">{iv.jobs?.companies?.name || "Employer"}</p>
                    <h3 className="mt-1 text-lg font-bold">{iv.jobs?.title || "Interview"}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {format(new Date(iv.scheduled_at), "eee, dd MMM yyyy · h:mm a")}
                      {" · "}
                      {upcoming ? `in ${formatDistanceToNow(new Date(iv.scheduled_at))}` : formatDistanceToNow(new Date(iv.scheduled_at), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    iv.status === "scheduled" ? "bg-primary-light text-primary" :
                    iv.status === "completed" ? "bg-success-light text-success" :
                    "bg-surface text-muted-foreground"
                  }`}>{iv.status}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                  <span className="inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-primary" />{iv.mode.replace("_", " ")}</span>
                  {iv.location && <span className="text-muted-foreground">{iv.location}</span>}
                  {iv.meeting_url && (
                    <a href={iv.meeting_url} target="_blank" rel="noreferrer" className="text-primary underline">Join link</a>
                  )}
                </div>
                {iv.notes && <p className="mt-3 rounded-lg bg-surface p-3 text-sm">{iv.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </CandidateShell>
  );
}

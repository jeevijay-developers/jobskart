import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar, Video, MapPin, Phone, Building2 } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { getActiveCompanyId, fetchMyCompanies } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/interviews")({
  head: () => ({ meta: [{ title: "Interviews · JobsKart" }] }),
  component: Page,
});

type Row = {
  id: string; scheduled_at: string; mode: string; status: string;
  location: string | null; meeting_url: string | null;
  candidate_id: string;
  profiles: { full_name: string | null; mobile: string | null } | null;
  jobs: { title: string } | null;
};

const ICONS: Record<string, typeof Video> = { online: Video, phone: Phone, in_person: MapPin, walk_in: Building2 };

function Page() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let cid = getActiveCompanyId();
      if (!cid) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const ms = await fetchMyCompanies(u.user.id);
          cid = ms[0]?.company_id ?? null;
        }
      }
      if (!cid) return setLoading(false);
      const { data } = await supabase
        .from("interviews")
        .select("id, scheduled_at, mode, status, location, meeting_url, candidate_id, jobs(title), profiles:candidate_id(full_name, mobile)")
        .eq("company_id", cid)
        .order("scheduled_at", { ascending: true });
      setItems((data || []) as unknown as Row[]);
      setLoading(false);
    })();
  }, []);

  return (
    <EmployerShell title="Interviews" subtitle="Scheduled interviews across your open roles">
      {loading ? <div className="h-64 animate-pulse rounded-xl bg-card" /> :
       !items.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No interviews scheduled yet. Schedule from an applicant's card.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs font-bold uppercase text-muted-foreground">
              <tr><th className="p-3">When</th><th className="p-3">Candidate</th><th className="p-3">Role</th><th className="p-3">Mode</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {items.map((iv) => {
                const Icon = ICONS[iv.mode] ?? Calendar;
                return (
                  <tr key={iv.id} className="border-t border-border">
                    <td className="p-3">{format(new Date(iv.scheduled_at), "dd MMM, h:mm a")}</td>
                    <td className="p-3 font-medium">{iv.profiles?.full_name || "Candidate"}</td>
                    <td className="p-3 text-muted-foreground">{iv.jobs?.title}</td>
                    <td className="p-3"><span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{iv.mode.replace("_", " ")}</span></td>
                    <td className="p-3"><span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-bold text-primary">{iv.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </EmployerShell>
  );
}

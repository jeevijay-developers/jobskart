import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Trash2, Plus } from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/alerts")({
  head: () => ({ meta: [{ title: "Job alerts · JobsKart" }] }),
  component: Page,
});

type Alert = { id: string; name: string; query: { keyword?: string; city?: string } | null; frequency: string; created_at: string };

function Page() {
  const [items, setItems] = useState<Alert[]>([]);
  const [keyword, setKw] = useState("");
  const [city, setCity] = useState("");
  const [freq, setFreq] = useState("daily");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setLoading(false);
    const { data } = await supabase.from("candidate_job_alerts")
      .select("id, name, query, frequency, created_at")
      .eq("user_id", u.user.id)
      .order("created_at", { ascending: false });
    setItems((data || []) as unknown as Alert[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const kw = keyword.trim(); const ct = city.trim();
    if (!kw && !ct) return toast.error("Add a keyword or city");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const name = [kw, ct].filter(Boolean).join(" · ") || "New alert";
    const { error } = await supabase.from("candidate_job_alerts").insert({
      user_id: u.user.id, name, query: { keyword: kw || null, city: ct || null }, frequency: freq,
    } as never);
    if (error) return toast.error(error.message);
    toast.success("Alert saved");
    setKw(""); setCity(""); load();
  };
  const del = async (id: string) => {
    await supabase.from("candidate_job_alerts").delete().eq("id", id);
    load();
  };

  return (
    <CandidateShell title="Job alerts" subtitle="We'll notify you when matching jobs are posted.">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h3 className="text-sm font-bold uppercase text-muted-foreground">Create alert</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <Input placeholder="Job title / keyword" value={keyword} onChange={(e) => setKw(e.target.value)} />
          <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <select value={freq} onChange={(e) => setFreq(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="instant">Instant</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <Button onClick={add}><Plus className="mr-2 h-4 w-4" /> Add alert</Button>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {loading ? <div className="h-24 animate-pulse rounded-xl bg-card" /> :
         !items.length ? (
           <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
             <Bell className="mx-auto h-10 w-10 text-muted-foreground" />
             <p className="mt-3 text-sm text-muted-foreground">No alerts yet. Create one above.</p>
           </div>
         ) : items.map((a) => (
           <div key={a.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
             <div>
               <p className="font-medium">{a.name}</p>
               <p className="text-xs text-muted-foreground uppercase">{a.frequency}</p>
             </div>
             <Button variant="ghost" size="sm" onClick={() => del(a.id)}><Trash2 className="h-4 w-4" /></Button>
           </div>
         ))}
      </div>
    </CandidateShell>
  );
}

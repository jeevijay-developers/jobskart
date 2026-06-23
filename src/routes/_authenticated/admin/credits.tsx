import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { adminGrantCredits } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/credits")({
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const [pack, setPack] = useState({ name: "", credits: 100, price_inr: 999 });
  const [grant, setGrant] = useState({ companyId: "", delta: 10, note: "" });
  const grantFn = useServerFn(adminGrantCredits);

  const { data: packs } = useQuery({
    queryKey: ["credit-packs"],
    queryFn: async () => (await supabase.from("credit_packs").select("*").order("price_inr")).data ?? [],
  });
  const { data: orders } = useQuery({
    queryKey: ["rzp-orders"],
    queryFn: async () => (await supabase.from("razorpay_orders").select("*").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const { data: txns } = useQuery({
    queryKey: ["credit-txns"],
    queryFn: async () => (await supabase.from("credit_transactions").select("*, companies(name)").order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  const addPack = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("credit_packs").insert({ ...pack, is_active: true }); if (error) throw error; },
    onSuccess: () => { toast.success("Pack added"); setPack({ name: "", credits: 100, price_inr: 999 }); qc.invalidateQueries({ queryKey: ["credit-packs"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const togPack = useMutation({
    mutationFn: async (row: any) => { const { error } = await supabase.from("credit_packs").update({ is_active: !row.is_active }).eq("id", row.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit-packs"] }),
  });
  const doGrant = useMutation({
    mutationFn: () => grantFn({ data: { companyId: grant.companyId, delta: grant.delta, note: grant.note } }),
    onSuccess: () => { toast.success("Credits applied"); qc.invalidateQueries({ queryKey: ["credit-txns"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AdminShell title="Credits & Payments" subtitle="Packs, manual grants, ledger">
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Credit Packs</h2>
        <div className="mb-3 grid gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4">
          <div><Label>Name</Label><Input value={pack.name} onChange={(e) => setPack({ ...pack, name: e.target.value })} /></div>
          <div><Label>Credits</Label><Input type="number" value={pack.credits} onChange={(e) => setPack({ ...pack, credits: +e.target.value })} /></div>
          <div><Label>Price (₹)</Label><Input type="number" value={pack.price_inr} onChange={(e) => setPack({ ...pack, price_inr: +e.target.value })} /></div>
          <div className="flex items-end"><Button onClick={() => addPack.mutate()} className="w-full">Add pack</Button></div>
        </div>
        <div className="space-y-2">
          {(packs ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
              <div>
                <p className="text-sm font-medium">{p.name} — {p.credits} credits</p>
                <p className="text-xs text-muted-foreground">₹{p.price_inr}</p>
              </div>
              <Switch checked={p.is_active} onCheckedChange={() => togPack.mutate(p)} />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Grant credits</h2>
        <div className="grid gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><Label>Company ID</Label><Input value={grant.companyId} onChange={(e) => setGrant({ ...grant, companyId: e.target.value })} placeholder="UUID" /></div>
          <div><Label>Delta</Label><Input type="number" value={grant.delta} onChange={(e) => setGrant({ ...grant, delta: +e.target.value })} /></div>
          <div className="flex items-end"><Button onClick={() => doGrant.mutate()} className="w-full">Apply</Button></div>
          <div className="sm:col-span-4"><Label>Note</Label><Input value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} /></div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent Razorpay orders</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {(orders ?? []).slice(0, 20).map((o: any) => (
            <div key={o.id} className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">{o.razorpay_order_id}</p>
                <p className="text-foreground">₹{(o.amount / 100).toLocaleString("en-IN")} • {o.status}</p>
              </div>
              <p className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent transactions</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {(txns ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0">
              <div>
                <p className="font-medium text-foreground">{t.companies?.name ?? t.company_id}</p>
                <p className="text-xs text-muted-foreground">{t.kind}</p>
              </div>
              <div className="text-right">
                <p className={`font-semibold ${t.delta < 0 ? "text-destructive" : "text-success"}`}>{t.delta > 0 ? "+" : ""}{t.delta}</p>
                <p className="text-xs text-muted-foreground">bal {t.balance_after}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}

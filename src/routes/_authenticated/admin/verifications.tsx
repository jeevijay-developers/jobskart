import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, FileText, Loader2, ShieldX } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/verifications")({
  head: () => ({ meta: [{ title: "KYC Queue · JobsKart Admin" }] }),
  component: Page,
});

type Row = {
  id: string; company_id: string; method: string; status: string;
  reference: string | null; notes: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docs: any; created_at: string;
  companies: { name: string; slug: string | null } | null;
};

function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<"pending" | "verified" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_verifications")
      .select("*, companies(name, slug)")
      .eq("status", tab)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows(((data as unknown) as Row[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  const decide = async (r: Row, status: "verified" | "rejected") => {
    const notes = status === "rejected" ? window.prompt("Rejection reason (optional):") ?? "" : "";
    setBusy(r.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc("admin_set_verification" as any, {
        _id: r.id, _status: status, _notes: notes,
      });
      if (error) throw error;
      toast.success(status === "verified" ? "Company verified" : "Rejected");
      setRows((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  };

  return (
    <AdminShell title="KYC & Verifications" subtitle="Review employer KYC submissions.">
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {(["pending", "verified", "rejected"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const docs = Array.isArray(r.docs) ? r.docs as { path: string; name: string }[] : [];
            return (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{r.companies?.name ?? "Company"}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="uppercase font-medium">{r.method}</span>
                      {r.reference ? ` · ${r.reference}` : ""} · {new Date(r.created_at).toLocaleString()}
                    </p>
                    {r.notes && <p className="mt-1 text-sm text-foreground/80">{r.notes}</p>}
                    {docs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {docs.map((d) => (
                          <button key={d.path}
                            onClick={async () => {
                              const { data } = await supabase.storage.from("company-docs").createSignedUrl(d.path, 300);
                              if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold hover:bg-foreground/5">
                            <FileText className="h-3 w-3" /> {d.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {tab === "pending" && (
                    <div className="flex gap-2">
                      <button onClick={() => decide(r, "verified")} disabled={busy === r.id}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-50">
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />} Approve
                      </button>
                      <button onClick={() => decide(r, "rejected")} disabled={busy === r.id}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50">
                        <ShieldX className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminShell>
  );
}

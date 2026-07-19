import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Building2, FileText, Loader2, Mail, ShieldCheck, Upload } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/verification")({
  head: () => ({ meta: [{ title: "KYC & Verification · JobsKart Employer" }] }),
  component: VerificationPage,
});

type Row = { id: string; method: string; status: string; reference: string | null; notes: string | null; created_at: string };
type Method = "gst" | "email" | "manual";

function VerificationPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [method, setMethod] = useState<Method>("gst");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      let id = getActiveCompanyId();
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) { const ms = await fetchMyCompanies(u.user.id); id = ms[0]?.company_id ?? null; }
      }
      if (!id) return;
      setCid(id);
      const { data } = await supabase.from("company_verifications").select("*").eq("company_id", id).order("created_at", { ascending: false });
      setRows((data as Row[]) || []);
    })();
  }, []);

  const submit = async () => {
    if (!cid) return toast.error("No active company.");
    if (method !== "manual" && !reference.trim()) return toast.error("Enter the reference number.");
    if (method === "manual" && !file) return toast.error("Upload a supporting document.");
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      const docs: { path: string; name: string }[] = [];
      if (file) {
        const path = `${cid}/kyc/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("company-docs").upload(path, file, { upsert: false });
        if (up.error) throw up.error;
        docs.push({ path, name: file.name });
      }
      const { data, error } = await supabase.from("company_verifications").insert({
        company_id: cid, method: method as never, status: "pending" as never,
        reference: reference.trim() || null, notes: notes.trim() || null,
        docs: docs as never, submitted_by: uid,
      }).select("*").single();
      if (error) throw error;
      setRows((r) => [data as Row, ...r]);
      setReference(""); setNotes(""); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success("Submitted — our team will review within 24 hours.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit"); }
    finally { setSaving(false); }
  };

  const badgeTone = (s: string) => s === "verified" ? "bg-success text-success-foreground" : s === "rejected" ? "bg-destructive text-destructive-foreground" : "bg-warning-light text-warning";

  return (
    <EmployerShell title="KYC & Verification" subtitle="Verified employers get 4× more applications and higher search rank.">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex gap-2">
            {([
              { v: "gst", label: "GST / PAN / CIN", icon: Building2 },
              { v: "email", label: "Business Email", icon: Mail },
              { v: "manual", label: "Manual KYC", icon: ShieldCheck },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = method === t.v;
              return (
                <button key={t.v} onClick={() => setMethod(t.v)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold ${active ? "bg-primary text-primary-foreground" : "bg-surface text-foreground/70 hover:bg-foreground/5"}`}>
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {method === "gst" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Instant verification via your GSTIN, PAN, or CIN. We'll fetch official records and issue a Verified badge.</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">GST / PAN / CIN</span>
                <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className="form-input" placeholder="08AARFT8882G1ZA" maxLength={21} />
              </label>
            </div>
          )}
          {method === "email" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Verify with your official work email (no free providers).</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">Work email</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} className="form-input" placeholder="you@yourcompany.com" type="email" />
              </label>
            </div>
          )}
          {method === "manual" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Upload LLP deed, business license, address proof, or Aadhaar of an authorised representative. Reviewed within 24 hours.</p>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface p-4 hover:border-primary/40">
                <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary-light text-primary"><Upload className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{file ? file.name : "Upload document (PDF/JPG/PNG · max 5 MB)"}</p>
                  <p className="text-xs text-muted-foreground">Kept private, visible only to our verification team.</p>
                </div>
                <input ref={fileInput} type="file" hidden accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          )}
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="form-input" placeholder="Any context for our team." />
          </label>
          <button onClick={submit} disabled={saving} className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            Submit for verification
          </button>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <h3 className="text-sm font-bold">Submission history</h3>
          {rows.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">No submissions yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-3">
                  <FileText className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold capitalize">{r.method.replace("_", " ")} {r.reference ? `· ${r.reference}` : ""}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
                    {r.notes && <p className="mt-1 text-xs text-foreground/70">{r.notes}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeTone(r.status)}`}>{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </EmployerShell>
  );
}

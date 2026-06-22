import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Building2, Camera, Loader2, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { INDIAN_CITIES } from "@/lib/options";

export const Route = createFileRoute("/_authenticated/employer/company")({
  head: () => ({ meta: [{ title: "Company Profile · JobsKart" }] }),
  component: CompanyPage,
});

type Company = {
  id: string;
  name: string;
  slug: string | null;
  industry: string | null;
  website: string | null;
  about: string | null;
  hq_city: string | null;
  founded_year: number | null;
  gst_number: string | null;
  pan_number: string | null;
  logo_url: string | null;
  verification_status: string;
};

type Doc = { id: string; doc_type: string; file_name: string | null; status: string; created_at: string };

function CompanyPage() {
  const [c, setC] = useState<Company | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    let cid = getActiveCompanyId();
    if (!cid) {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const ms = await fetchMyCompanies(u.user.id);
        cid = ms[0]?.company_id ?? null;
      }
    }
    if (!cid) return;
    const [cRes, dRes] = await Promise.all([
      supabase.from("companies").select("*").eq("id", cid).single(),
      supabase.from("company_documents").select("id, doc_type, file_name, status, created_at").eq("company_id", cid).order("created_at", { ascending: false }),
    ]);
    setC(cRes.data as Company | null);
    setDocs((dRes.data || []) as Doc[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!c) return;
    setSaving(true);
    const { error } = await supabase.from("companies").update({
      name: c.name, industry: c.industry, website: c.website, about: c.about,
      hq_city: c.hq_city, founded_year: c.founded_year, gst_number: c.gst_number, pan_number: c.pan_number,
    }).eq("id", c.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Company saved.");
  };

  const uploadLogo = async (file: File) => {
    if (!c) return;
    const path = `${c.id}/logo-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("company-logos").upload(path, file, { upsert: true });
    if (error) return toast.error(error.message);
    const { data: signed } = await supabase.storage.from("company-logos").createSignedUrl(path, 60 * 60 * 24 * 365);
    if (!signed?.signedUrl) return;
    await supabase.from("companies").update({ logo_url: signed.signedUrl }).eq("id", c.id);
    setC({ ...c, logo_url: signed.signedUrl });
    toast.success("Logo uploaded.");
  };

  const uploadDoc = async (file: File, docType: string) => {
    if (!c) return;
    const path = `${c.id}/${docType}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("company-docs").upload(path, file);
    if (error) return toast.error(error.message);
    await supabase.from("company_documents").insert({
      company_id: c.id, doc_type: docType, file_path: path, file_name: file.name, status: "pending",
    });
    toast.success("Document uploaded. Verification in progress…");
    // KYC stub: auto-verify after 2s
    setTimeout(async () => {
      await supabase.from("companies").update({ verification_status: "verified" }).eq("id", c.id);
      await supabase.from("company_documents").update({ status: "verified" }).eq("company_id", c.id);
      toast.success("✓ Company verified!");
      load();
    }, 2000);
    load();
  };

  if (!c) return <EmployerShell title="Company"><div className="h-64 animate-pulse rounded-xl bg-card" /></EmployerShell>;

  const verified = c.verification_status === "verified";

  return (
    <EmployerShell title="Company profile" subtitle="How candidates see you. Keep it sharp.">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <div className="rounded-2xl border border-border bg-card p-5 text-center shadow-[var(--shadow-card)]">
            <div className="relative mx-auto h-24 w-24">
              {c.logo_url ? (
                <img src={c.logo_url} alt={c.name} className="h-24 w-24 rounded-2xl object-cover" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-2xl bg-primary-light text-3xl font-bold text-primary">
                  {c.name.slice(0, 1)}
                </div>
              )}
              <button onClick={() => logoRef.current?.click()} className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                <Camera className="h-4 w-4" />
              </button>
              <input ref={logoRef} type="file" hidden accept="image/*" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            </div>
            <h3 className="mt-3 text-lg font-bold">{c.name}</h3>
            <p className="text-xs text-muted-foreground">{c.industry || "Set industry"}</p>
            <div className="mt-3">
              {verified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-3 py-1 text-xs font-semibold text-success">
                  <ShieldCheck className="h-3 w-3" /> Verified employer
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-light px-3 py-1 text-xs font-semibold text-warning">
                  Verification pending
                </span>
              )}
            </div>
            {c.slug && (
              <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="mt-3 block text-xs font-semibold text-primary">View public page →</a>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-bold">KYC documents</h3>
            <p className="mt-1 text-xs text-muted-foreground">Upload GST or PAN to get verified. Auto-verifies in seconds for demo.</p>
            <button onClick={() => fileRef.current?.click()} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary bg-primary-light text-sm font-semibold text-primary">
              <Upload className="h-4 w-4" /> Upload document
            </button>
            <input ref={fileRef} type="file" hidden accept=".pdf,.jpg,.png" onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0], "gst")} />
            <div className="mt-3 space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs">
                  <span className="truncate font-medium">{d.file_name || d.doc_type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${d.status === "verified" ? "bg-success-light text-success" : "bg-warning-light text-warning"}`}>{d.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2"><Building2 className="h-4 w-4" /> Company details</h3>
            <div className="space-y-4">
              <Field label="Company name" required>
                <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} className="form-input" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Industry">
                  <input value={c.industry || ""} onChange={(e) => setC({ ...c, industry: e.target.value })} className="form-input" />
                </Field>
                <Field label="HQ city">
                  <select value={c.hq_city || ""} onChange={(e) => setC({ ...c, hq_city: e.target.value })} className="form-input">
                    <option value="">Select…</option>
                    {INDIAN_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Website">
                  <input value={c.website || ""} onChange={(e) => setC({ ...c, website: e.target.value })} className="form-input" placeholder="https://…" />
                </Field>
                <Field label="Founded year">
                  <input type="number" value={c.founded_year || ""} onChange={(e) => setC({ ...c, founded_year: e.target.value ? Number(e.target.value) : null })} className="form-input" />
                </Field>
              </div>
              <Field label="About" hint={`${(c.about || "").length}/1000`}>
                <textarea rows={5} maxLength={1000} value={c.about || ""} onChange={(e) => setC({ ...c, about: e.target.value })} className="form-input resize-none" placeholder="What you do, your mission, what makes you a great place to work." />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="GST number">
                  <input value={c.gst_number || ""} onChange={(e) => setC({ ...c, gst_number: e.target.value })} className="form-input" />
                </Field>
                <Field label="PAN number">
                  <input value={c.pan_number || ""} onChange={(e) => setC({ ...c, pan_number: e.target.value })} className="form-input" />
                </Field>
              </div>
              <button onClick={save} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </EmployerShell>
  );
}

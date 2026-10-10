import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Mail,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { ConditionalField } from "@/components/forms/ConditionalField";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { useEmployerRole } from "@/hooks/use-employer-role";
import { sanitizeGstinInput, validateGstin } from "@/lib/validators";

export const Route = createFileRoute("/_authenticated/employer/verification")({
  head: () => ({ meta: [{ title: "KYC & Verification · JobsKart Employer" }] }),
  component: VerificationPage,
});

type Row = { id: string; method: string; status: string; reference: string | null; notes: string | null; created_at: string };
type Method = "gst" | "email" | "manual";
type Draft = { reference: string; notes: string; file: File | null };
type CompanyStatus = { is_verified: boolean; verification_status: string } | null;

const emptyDraft = (): Draft => ({ reference: "", notes: "", file: null });

function VerificationPage() {
  const { canManageVerification } = useEmployerRole();
  const [cid, setCid] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [companyStatus, setCompanyStatus] = useState<CompanyStatus>(null);
  const [method, setMethod] = useState<Method>("gst");
  // One draft per tab, so text typed in one tab never shows up in another.
  const [drafts, setDrafts] = useState<Record<Method, Draft>>({
    gst: emptyDraft(),
    email: emptyDraft(),
    manual: emptyDraft(),
  });
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const draft = drafts[method];
  const patchDraft = (patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [method]: { ...d[method], ...patch } }));

  // Only shown once the GSTIN reaches full length, so a half-typed value
  // doesn't flash an error before the user is done.
  const gstFieldError =
    drafts.gst.reference.length === 15 ? validateGstin(drafts.gst.reference) : null;

  const refetchCompanyStatus = useCallback(async (companyId: string) => {
    const { data } = await supabase
      .from("companies")
      .select("is_verified, verification_status")
      .eq("id", companyId)
      .maybeSingle();
    setCompanyStatus((data as CompanyStatus) ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      // The stored active-company id can be stale (another account, a removed membership).
      // The KYC upload path is "<company_id>/kyc/..." and the storage policy only accepts a
      // company the caller is an active member of, so only trust a stored id the user belongs to.
      let id = getActiveCompanyId();
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const ms = await fetchMyCompanies(u.user.id);
        if (!id || (ms.length > 0 && !ms.some((m) => m.company_id === id))) id = ms[0]?.company_id ?? id;
      }
      if (!id) return;
      setCid(id);
      const { data } = await supabase.from("company_verifications").select("*").eq("company_id", id).order("created_at", { ascending: false });
      setRows((data as Row[]) || []);
      refetchCompanyStatus(id);
    })();
  }, [refetchCompanyStatus]);

  const submit = async () => {
    if (!cid) return toast.error("No active company.");
    if (method !== "manual" && !draft.reference.trim()) return toast.error("Enter the reference number.");
    if (method === "gst") {
      const gstErr = validateGstin(draft.reference, { required: true });
      if (gstErr) return toast.error(gstErr);
    }
    if (method === "manual" && !draft.file) return toast.error("Upload a supporting document.");
    setSaving(true);
    try {
      if (method === "gst") {
        // Instant check runs on the server: it verifies the GSTIN against the GST
        // registry and records the outcome, falling back to the review queue.
        const { data: res, error: fnErr } = await supabase.functions.invoke("gst-verify", {
          body: { companyId: cid, gstin: draft.reference.trim(), notes: draft.notes.trim() || undefined },
        });
        if (fnErr) throw fnErr;
        const out = (res ?? {}) as { verified?: boolean; legalName?: string | null };
        setDrafts((d) => ({ ...d, gst: emptyDraft() }));
        const { data: fresh } = await supabase.from("company_verifications").select("*").eq("company_id", cid).order("created_at", { ascending: false });
        setRows((fresh as Row[]) || []);
        refetchCompanyStatus(cid);
        if (out.verified) toast.success(`Verified instantly${out.legalName ? ` — ${out.legalName}` : ""}.`);
        else toast.success("We couldn't confirm this GSTIN instantly, so our team will review it within 24 hours.");
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      const docs: { path: string; name: string }[] = [];
      if (draft.file && method === "manual") {
        const path = `${cid}/kyc/${Date.now()}-${draft.file.name}`;
        const up = await supabase.storage.from("company-docs").upload(path, draft.file, { upsert: false });
        if (up.error) throw up.error;
        docs.push({ path, name: draft.file.name });
      }
      const { data, error } = await supabase.from("company_verifications").insert({
        company_id: cid, method: method as never, status: "pending" as never,
        reference: method === "manual" ? null : draft.reference.trim() || null, notes: draft.notes.trim() || null,
        docs: docs as never, submitted_by: uid,
      }).select("*").single();
      if (error) throw error;
      setRows((r) => [data as Row, ...r]);
      setDrafts((d) => ({ ...d, [method]: emptyDraft() }));
      if (fileInput.current) fileInput.current.value = "";
      refetchCompanyStatus(cid);
      toast.success("Submitted — our team will review within 24 hours.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit"); }
    finally { setSaving(false); }
  };

  const badgeTone = (s: string) => s === "verified" ? "bg-success text-success-foreground" : s === "rejected" ? "bg-destructive text-destructive-foreground" : "bg-warning-light text-warning";

  const hasPendingSubmission = rows.some((r) => r.status === "pending");
  const overallStatus: { label: string; tone: string; Icon: typeof CheckCircle2 } =
    companyStatus?.is_verified
      ? { label: "Verified", tone: "border-success/30 bg-success-light text-success", Icon: CheckCircle2 }
      : hasPendingSubmission
        ? { label: "Pending review", tone: "border-warning/30 bg-warning-light text-warning", Icon: Clock }
        : { label: "Not verified", tone: "border-border bg-surface text-muted-foreground", Icon: ShieldCheck };

  return (
    <EmployerShell title="KYC & Verification" subtitle="Verified employers get 4× more applications and higher search rank.">
      {companyStatus && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${overallStatus.tone}`}
        >
          <overallStatus.Icon className="h-4 w-4 shrink-0" />
          Company status: {overallStatus.label}
        </div>
      )}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-6">
          {!canManageVerification && (
            <p className="mb-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
              Only company admins can submit verification.
            </p>
          )}
          <fieldset disabled={!canManageVerification} className="contents disabled:opacity-60">
          <div className="mb-4 flex gap-1 sm:gap-2">
            {([
              { v: "gst", label: "GST (GSTIN)", icon: Building2 },
              { v: "email", label: "Business Email", icon: Mail },
              { v: "manual", label: "Manual KYC", icon: ShieldCheck },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = method === t.v;
              return (
                <button key={t.v} onClick={() => setMethod(t.v)}
                  className={`flex h-11 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 text-[9.5px] font-semibold sm:h-auto sm:gap-2 sm:px-3 sm:py-2.5 sm:text-xs ${active ? "bg-primary text-primary-foreground" : "bg-surface text-foreground/70 hover:bg-foreground/5"}`}>
                  <Icon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          <ConditionalField visible={method === "gst"}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Instant verification via your 15-character GSTIN. We'll check it against the official GST registry and issue a Verified badge right away. Only have a PAN or CIN? Use Manual KYC instead.</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">GSTIN</span>
                <input
                  value={drafts.gst.reference}
                  onChange={(e) => setDrafts((d) => ({ ...d, gst: { ...d.gst, reference: sanitizeGstinInput(e.target.value) } }))}
                  className="form-input"
                  placeholder="08AARFT8882G1ZA"
                  maxLength={15}
                  aria-invalid={!!gstFieldError}
                />
                {gstFieldError && <p className="mt-1 text-xs text-destructive">{gstFieldError}</p>}
              </label>
            </div>
          </ConditionalField>
          <ConditionalField visible={method === "email"}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Verify with your official work email (no free providers).</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">Work email</span>
                <input value={drafts.email.reference} onChange={(e) => setDrafts((d) => ({ ...d, email: { ...d.email, reference: e.target.value } }))} className="form-input" placeholder="you@yourcompany.com" type="email" />
              </label>
            </div>
          </ConditionalField>
          <ConditionalField visible={method === "manual"}>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Upload LLP deed, business license, address proof, or Aadhaar of an authorised representative. Reviewed within 24 hours.</p>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface p-4 hover:border-primary/40">
                <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary-light text-primary"><Upload className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{drafts.manual.file ? drafts.manual.file.name : "Upload document (PDF/JPG/PNG · max 10 MB)"}</p>
                  <p className="text-xs text-muted-foreground">Kept private, visible only to our verification team.</p>
                </div>
                <input ref={fileInput} type="file" hidden accept="application/pdf,image/*" onChange={(e) => setDrafts((d) => ({ ...d, manual: { ...d.manual, file: e.target.files?.[0] ?? null } }))} />
              </label>
            </div>
          </ConditionalField>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold">Notes (optional)</span>
            <textarea value={draft.notes} onChange={(e) => patchDraft({ notes: e.target.value })} rows={3} className="form-input" placeholder="Any context for our team." />
          </label>
          <button onClick={submit} disabled={saving} className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            Submit for verification
          </button>
          </fieldset>
        </section>

        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-6">
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

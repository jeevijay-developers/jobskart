import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload, Eye } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/candidate/documents")({
  head: () => ({ meta: [{ title: "My documents · JobsKart" }] }),
  component: DocumentsPage,
});

const DOC_TYPES = [
  { key: "resume", label: "Resume / CV" },
  { key: "id_proof", label: "ID proof (Aadhaar/PAN)" },
  { key: "education", label: "Education certificate" },
  { key: "experience", label: "Experience letter" },
  { key: "other", label: "Other" },
] as const;
type DocKey = (typeof DOC_TYPES)[number]["key"];

type Doc = { id: string; doc_type: string; file_path: string; file_name: string; size_bytes: number | null; created_at: string };

function DocumentsPage() {
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = async () => {
    setLoading(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setLoading(false); return; }
    const { data, error } = await supabase.from("candidate_documents").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as Doc[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const upload = async (docType: DocKey, file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast.error("File too large (max 5 MB).");
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return toast.error("Please sign in again.");
    setUploading(docType);
    try {
      const path = `${uid}/${docType}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("candidate-docs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("candidate_documents").insert({
        user_id: uid, doc_type: docType, file_path: path, file_name: file.name, size_bytes: file.size,
      });
      if (insErr) throw insErr;
      toast.success("Uploaded");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Delete ${d.file_name}?`)) return;
    await supabase.storage.from("candidate-docs").remove([d.file_path]);
    const { error } = await supabase.from("candidate_documents").delete().eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    setRows((r) => r.filter((x) => x.id !== d.id));
  };

  const openDoc = async (d: Doc) => {
    const { data } = await supabase.storage.from("candidate-docs").createSignedUrl(d.file_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <CandidateShell title="My documents" subtitle="Keep your resume, ID and certificates ready — employers can verify you faster.">
      <div className="grid gap-4">
        {DOC_TYPES.map((t) => {
          const owned = rows.filter((r) => r.doc_type === t.key);
          return (
            <div key={t.key} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground">{t.label}</h3>
                  <p className="text-xs text-muted-foreground">PDF, PNG or JPG · max 5 MB</p>
                </div>
                <button
                  onClick={() => inputs.current[t.key]?.click()}
                  disabled={uploading === t.key}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
                >
                  {uploading === t.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload
                </button>
                <input
                  ref={(el) => { inputs.current[t.key] = el; }}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(t.key, f);
                    e.currentTarget.value = "";
                  }}
                />
              </div>
              {loading ? null : owned.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">No file uploaded yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {owned.map((d) => (
                    <li key={d.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-foreground sm:truncate">{d.file_name}</p>
                          <p className="text-xs text-muted-foreground">{Math.round((d.size_bytes ?? 0) / 1024)} KB · {timeAgo(d.created_at)}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                        <button onClick={() => openDoc(d)} aria-label="View document" title="View" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border hover:bg-surface">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => remove(d)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </CandidateShell>
  );
}

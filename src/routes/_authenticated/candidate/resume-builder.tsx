import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PDFViewer } from "@react-pdf/renderer";
import {
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Clock,
  CheckCircle2,
  Circle,
  Eye,
  X,
} from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { ResumeExtrasEditor } from "@/components/candidate/ResumeExtrasEditor";
import { JobMatchPanel } from "@/components/candidate/JobMatchPanel";
import { supabase } from "@/integrations/supabase/client";
import { getResumeTemplate, RESUME_TEMPLATE_LIST } from "@/lib/resumeBuilder/templates/registry";
import { getResumeVersionPdfUrl } from "@/lib/resumeBuilder.functions";
import { applyResumeExtras } from "@/lib/resumeBuilder/snapshot";
import { validateResume } from "@/lib/resumeBuilder/validateResume";
import type { ExperienceItem, ResumeExtras, ResumeSchema } from "@/lib/resumeBuilder/schema";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const Route = createFileRoute(
  "/_authenticated/candidate/resume-builder"
)({
  ssr: false,
  component: ResumeBuilderPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchSnapshot(token: string): Promise<ResumeSchema> {
  const res = await fetch("/api/resume-builder", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to load resume data");
  }
  return res.json();
}

async function generateVersion(
  token: string,
  templateId: string
): Promise<{ version: Record<string, unknown>; pdfUrl: string | null }> {
  const res = await fetch("/api/resume-builder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to generate resume");
  }
  return res.json();
}

type VersionRow = {
  id: string;
  version_number: number;
  template_id: string;
  created_at: string;
  snapshot: ResumeSchema;
};

// ─── Main page component ──────────────────────────────────────────────────────
function ResumeBuilderPage() {
  const [snapshot, setSnapshot] = useState<ResumeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("classic-ats");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionRow | null>(null);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const getVersionPdfUrl = useServerFn(getResumeVersionPdfUrl);

  // Builder-authored content (hobbies, certifications, rich-text overrides…).
  // Autosaved to resume_drafts; the live preview merges it onto the profile
  // snapshot exactly like the server does when a version is saved.
  const [extras, setExtras] = useState<ResumeExtras>({});
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      userIdRef.current = u.user.id;
      const { data } = await supabase.from("resume_drafts").select("extras").eq("user_id", u.user.id).maybeSingle();
      setExtras((data?.extras ?? {}) as ResumeExtras);
      setExtrasLoaded(true);
    })();
  }, []);

  const debouncedExtras = useDebounced(extras, 700);
  const firstSave = useRef(true);
  useEffect(() => {
    if (!extrasLoaded) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const uid = userIdRef.current;
    if (!uid) return;
    setSaveState("saving");
    supabase
      .from("resume_drafts")
      .upsert({ user_id: uid, extras: debouncedExtras as never }, { onConflict: "user_id" })
      .then(({ error }) => {
        if (error) toast.error("Couldn't save your changes");
        setSaveState(error ? "idle" : "saved");
      });
  }, [debouncedExtras, extrasLoaded]);

  const merged = useMemo(() => (snapshot ? applyResumeExtras(snapshot, debouncedExtras) : null), [snapshot, debouncedExtras]);
  const checklist = useMemo(() => (merged ? validateResume(merged) : []), [merged]);
  const baseExperiences = useMemo(() => {
    const sec = snapshot?.sections.find((s) => s.content.kind === "experience");
    return sec && sec.content.kind === "experience" ? (sec.content.items as ExperienceItem[]) : [];
  }, [snapshot]);

  // ── Load snapshot ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await getAuthToken();
        if (!token) {
          toast.error("Please sign in to use the Resume Builder.");
          return;
        }
        const snap = await fetchSnapshot(token);
        setSnapshot(snap);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load resume data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load version history (includes each version's own snapshot, so Preview
  //    can re-render an old version exactly as it was saved, not the current
  //    live profile data) ───────────────────────────────────────────────────
  const loadVersions = async () => {
    setVersionsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("resume_versions")
        .select("id, version_number, template_id, created_at, snapshot")
        .eq("user_id", user.id)
        .order("version_number", { ascending: false })
        .limit(10);
      setVersions((data as unknown as VersionRow[]) ?? []);
    } catch {
      // silently ignore
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => { loadVersions(); }, []);

  // ── Generate & save PDF version ───────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getAuthToken();
      if (!token) { toast.error("Not signed in"); return; }
      // Flush un-debounced edits first: the server merges the saved draft, so a
      // version generated right after typing must not miss the latest changes.
      if (userIdRef.current) {
        const { error } = await supabase
          .from("resume_drafts")
          .upsert({ user_id: userIdRef.current, extras: extras as never }, { onConflict: "user_id" });
        if (error) throw new Error("Couldn't save your latest changes — try again");
      }
      const { version, pdfUrl } = await generateVersion(token, selectedTemplate);
      toast.success(`Resume v${(version as VersionRow).version_number} saved!`);
      if (pdfUrl) setLastPdfUrl(pdfUrl);
      await loadVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadVersion = async (v: VersionRow) => {
    setDownloadingVersionId(v.id);
    try {
      const { url } = await getVersionPdfUrl({ data: { versionNumber: v.version_number } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't get a download link");
    } finally {
      setDownloadingVersionId(null);
    }
  };

  const LivePreviewTemplate = getResumeTemplate(selectedTemplate);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <CandidateShell
      title="Resume Builder"
      subtitle="Build a professional resume from your profile in seconds"
    >
      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Loading your profile data…</p>
          </div>
        </div>
      ) : !snapshot ? (
        <EmptyState />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* ── Left panel ── */}
          <div className="flex flex-col gap-5">
            {/* Template picker */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Choose Template
              </h2>
              <div className="flex flex-col gap-3">
                {RESUME_TEMPLATE_LIST.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplate(t.id)}
                    className={`relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                      selectedTemplate === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/40 hover:bg-surface"
                    }`}
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{t.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    </div>
                    {selectedTemplate === t.id && (
                      <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </section>

            {/* Completeness checklist — asks for what's missing instead of silently leaving gaps */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Resume Checklist
              </h2>
              {checklist.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> Your resume looks complete.
                </p>
              ) : (
                <ul className="space-y-2">
                  {checklist.map((item) => (
                    <li key={item.key} className="flex items-start gap-2 text-xs">
                      <Circle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.severity === "required" ? "text-destructive" : "text-muted-foreground"}`} />
                      {item.fix === "profile" ? (
                        <a href="/candidate/profile" className="text-foreground hover:text-primary hover:underline">{item.message}</a>
                      ) : (
                        <button
                          type="button"
                          className="text-left text-foreground hover:text-primary hover:underline"
                          onClick={() => document.getElementById(item.anchor ?? "")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        >
                          {item.message}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Builder-only fields: not on the profile, never written back to it */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Edit Your Resume
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
                </span>
              </div>
              {extrasLoaded ? (
                <ResumeExtrasEditor extras={extras} onChange={setExtras} experiences={baseExperiences} />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </section>

            {/* Tailor to a specific JobsKart job */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Tailor to a Job
              </h2>
              {merged && <JobMatchPanel resume={merged} />}
            </section>

            {/* Profile summary */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Profile Data
              </h2>
              <div className="space-y-2 text-sm text-foreground">
                <InfoRow label="Name" value={snapshot.candidateName || "Not set"} />
                {snapshot.targetJobRole && (
                  <InfoRow label="Target Role" value={snapshot.targetJobRole} />
                )}
                <InfoRow
                  label="Sections"
                  value={`${snapshot.sections.length} sections`}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Data pulled from your{" "}
                <a
                  href="/candidate/profile"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Profile
                </a>
                . Keep it updated for the best resume.
              </p>
            </section>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating ? "Generating…" : "Generate & Save Resume"}
              </button>

              {lastPdfUrl && (
                <a
                  href={lastPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-semibold text-foreground shadow-sm transition-all hover:bg-surface"
                >
                  <Download className="h-4 w-4" />
                  Download Last PDF
                </a>
              )}
            </div>

            {/* Version history — every version now gets its own Preview + Download */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Version History
                </h2>
                <button
                  type="button"
                  onClick={loadVersions}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${versionsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No versions saved yet. Click "Generate" to create your first.
                </p>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground">
                          Version {v.version_number}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(v.created_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          {" · "}
                          {v.template_id}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPreviewVersion(v)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
                        title="Preview this version"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadVersion(v)}
                        disabled={downloadingVersionId === v.id}
                        className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-50"
                        title="Download this version"
                      >
                        {downloadingVersionId === v.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── Right panel: live preview — this IS the real PDF engine
              (react-pdf), the exact same component tree used server-side for
              the download, so preview and download can never drift apart. ── */}
          <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Eye className="h-4 w-4 text-primary" />
                Live Preview
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                {RESUME_TEMPLATE_LIST.find((t) => t.id === selectedTemplate)?.label}
              </span>
            </div>
            <div className="relative min-h-[700px] overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
              <PDFViewer key={selectedTemplate} style={{ width: "100%", height: 700, border: "none" }} showToolbar={false}>
                <LivePreviewTemplate resume={{ ...(merged ?? snapshot), templateId: selectedTemplate }} />
              </PDFViewer>
            </div>
            <p className="text-xs text-muted-foreground">
              Preview is generated from your profile data. Click{" "}
              <strong>Generate &amp; Save</strong> to lock in this version and
              download the exact same PDF shown above.
            </p>
          </div>
        </div>
      )}

      {previewVersion && (
        <VersionPreviewModal version={previewVersion} onClose={() => setPreviewVersion(null)} />
      )}
    </CandidateShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function VersionPreviewModal({ version, onClose }: { version: VersionRow; onClose: () => void }) {
  const Template = getResumeTemplate(version.template_id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">
            Version {version.version_number} — {version.template_id}
          </p>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1">
          <PDFViewer style={{ width: "100%", height: "100%", border: "none" }} showToolbar={false}>
            <Template resume={version.snapshot} />
          </PDFViewer>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <FileText className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-foreground">No profile data found</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Complete your candidate profile first so the Resume Builder can pull
          your experience, education, and skills.
        </p>
      </div>
      <a
        href="/candidate/profile"
        className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        Go to Profile
      </a>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Clock,
  CheckCircle2,
  ChevronDown,
  Eye,
} from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import { renderResumeToHtml } from "@/lib/resumeBuilder/template";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";

export const Route = createFileRoute(
  "/_authenticated/candidate/resume-builder"
)({
  ssr: false,
  component: ResumeBuilderPage,
});

// ─── Template options ─────────────────────────────────────────────────────────
const TEMPLATES = [
  {
    id: "classic-ats",
    label: "Classic ATS",
    description: "Clean, ATS-friendly, widely accepted",
    color: "from-blue-500 to-blue-700",
  },
];

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
};

// ─── Main page component ──────────────────────────────────────────────────────
function ResumeBuilderPage() {
  const [snapshot, setSnapshot] = useState<ResumeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("classic-ats");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Load snapshot + version history ──────────────────────────────────────
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
        setPreviewHtml(renderResumeToHtml({ ...snap, templateId: selectedTemplate }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load resume data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load version history ──────────────────────────────────────────────────
  const loadVersions = async () => {
    setVersionsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("resume_versions")
        .select("id, version_number, template_id, created_at")
        .eq("user_id", user.id)
        .order("version_number", { ascending: false })
        .limit(10);
      setVersions((data as VersionRow[]) ?? []);
    } catch {
      // silently ignore
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => { loadVersions(); }, []);

  // ── Update preview when template changes ──────────────────────────────────
  useEffect(() => {
    if (snapshot) {
      setPreviewHtml(renderResumeToHtml({ ...snapshot, templateId: selectedTemplate }));
    }
  }, [selectedTemplate, snapshot]);

  // ── Sync preview HTML into iframe ─────────────────────────────────────────
  useEffect(() => {
    if (iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();
      }
    }
  }, [previewHtml]);

  // ── Generate & save PDF version ───────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getAuthToken();
      if (!token) { toast.error("Not signed in"); return; }
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
                {TEMPLATES.map((t) => (
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
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${t.color}`}
                    >
                      <FileText className="h-4 w-4 text-white" />
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

            {/* Profile summary */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Profile Data
              </h2>
              <div className="space-y-2 text-sm text-foreground">
                <InfoRow label="Title" value={snapshot.title} />
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

            {/* Version history */}
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
                      className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
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
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── Right panel: live preview ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Eye className="h-4 w-4 text-primary" />
                Live Preview
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                {TEMPLATES.find((t) => t.id === selectedTemplate)?.label}
              </span>
            </div>
            <div className="relative min-h-[700px] overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
              {previewHtml ? (
                <iframe
                  ref={iframeRef}
                  title="Resume Preview"
                  className="h-full w-full"
                  style={{ minHeight: 700, border: "none" }}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex h-full min-h-[700px] items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Preview is generated from your profile data. Click{" "}
              <strong>Generate &amp; Save</strong> to lock in this version and
              optionally download a PDF.
            </p>
          </div>
        </div>
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


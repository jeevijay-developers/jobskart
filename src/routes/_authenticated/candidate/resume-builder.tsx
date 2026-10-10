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
  Wand2,
} from "lucide-react";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { JobMatchPanel } from "@/components/candidate/JobMatchPanel";
import { supabase } from "@/integrations/supabase/client";
import { getResumeTemplate, RESUME_TEMPLATE_LIST } from "@/lib/resumeBuilder/templates/registry";
import {
  getDefaultLayout,
  getTemplateTheme,
  normalizeLayout,
} from "@/lib/resumeBuilder/templates/theme";
import {
  getResumeVersionPdfUrl,
  deleteResumeVersion,
  renameResumeVersion,
} from "@/lib/resumeBuilder.functions";
import { MAX_RESUME_VERSIONS, RESUME_VERSION_LIMIT_MESSAGE } from "@/lib/resumeBuilder/limits";
import { applyResumeExtras } from "@/lib/resumeBuilder/snapshot";
import { validateResume } from "@/lib/resumeBuilder/validateResume";
import type {
  ExperienceItem,
  ResumeExtras,
  ResumeLayoutSettings,
  ResumeSchema,
} from "@/lib/resumeBuilder/schema";
import { TemplatePicker } from "@/components/candidate/TemplatePicker";
import { VersionHistory } from "@/components/candidate/VersionHistory";
import { EditModeTrigger } from "@/components/candidate/EditModeTrigger";
import { EditModeDrawer } from "@/components/candidate/EditModeDrawer";
import { EditModeBottomSheet } from "@/components/candidate/EditModeBottomSheet";
import { LivePreview } from "@/components/candidate/LivePreview";
import { Segmented } from "@/components/candidate/Segmented";
import { GuidedResumeWizard } from "@/components/candidate/GuidedResumeWizard";
import { useStandardFontsReady } from "@/lib/resumeBuilder/ensureStandardFonts";

export const Route = createFileRoute("/_authenticated/candidate/resume-builder")({
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
  templateId: string,
  layout: ResumeLayoutSettings,
  versionNumber?: number,
): Promise<{ version: Record<string, unknown>; pdfUrl: string | null }> {
  const res = await fetch("/api/resume-builder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ templateId, layout, versionNumber }),
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
  name?: string | null;
  snapshot: ResumeSchema;
};

// ─── Main page component ──────────────────────────────────────────────────────
function ResumeBuilderPage() {
  const [snapshot, setSnapshot] = useState<ResumeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("classic-ats");
  // Layout & Design works like "Edit Your Resume": `layoutDraft` is the working
  // copy; `savedLayout` is what the preview and generated versions use. It only
  // changes when the candidate clicks Save changes (and is remembered per candidate).
  const [layoutDraft, setLayoutDraft] = useState<ResumeLayoutSettings>(() =>
    getDefaultLayout("classic-ats"),
  );
  const [savedLayout, setSavedLayout] = useState<ResumeLayoutSettings>(() =>
    getDefaultLayout("classic-ats"),
  );
  const [savingLayout, setSavingLayout] = useState(false);
  const layoutDirty = useMemo(
    () => JSON.stringify(layoutDraft) !== JSON.stringify(savedLayout),
    [layoutDraft, savedLayout],
  );
  const selectTemplate = (id: string) => {
    // Each template has its own look, so switching starts from that template's
    // defaults (and replaces any unsaved layout edits).
    const defaults = getDefaultLayout(id);
    setSelectedTemplate(id);
    setLayoutDraft(defaults);
    setSavedLayout(defaults);
    const uid = userIdRef.current;
    if (uid) {
      supabase
        .from("resume_drafts")
        .upsert({ user_id: uid, template_id: id, layout: null }, { onConflict: "user_id" })
        .then(({ error }) => {
          if (error) toast.error("Couldn't remember your template choice");
        });
    }
  };
  const handleSaveLayout = async () => {
    const uid = userIdRef.current;
    if (!uid) {
      toast.error("Not signed in");
      return;
    }
    setSavingLayout(true);
    const { error } = await supabase
      .from("resume_drafts")
      .upsert(
        { user_id: uid, template_id: selectedTemplate, layout: layoutDraft as never },
        { onConflict: "user_id" },
      );
    setSavingLayout(false);
    if (error) {
      toast.error("Couldn't save your layout");
      return;
    }
    setSavedLayout(layoutDraft);
    toast.success("Layout saved");
  };
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionRow | null>(null);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const getVersionPdfUrl = useServerFn(getResumeVersionPdfUrl);
  const deleteVersionFn = useServerFn(deleteResumeVersion);
  const renameVersionFn = useServerFn(renameResumeVersion);
  // Version currently loaded in the editor; saving updates it instead of creating a new one.
  const [editingVersion, setEditingVersion] = useState<VersionRow | null>(null);

  // Builder-authored content (hobbies, certifications, rich-text overrides…).
  // `extras` is the working copy being edited; `savedExtras` is what was last
  // saved to resume_drafts. The live preview (and any generated version) only
  // reflect `savedExtras` — changes apply when the candidate clicks Save changes.
  const [extras, setExtras] = useState<ResumeExtras>({});
  const [savedExtras, setSavedExtras] = useState<ResumeExtras>({});
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const [savingExtras, setSavingExtras] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const isDirty = useMemo(
    () => JSON.stringify(extras) !== JSON.stringify(savedExtras),
    [extras, savedExtras],
  );
  // Edit mode state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTab, setEditTab] = useState<"layout" | "extras">("layout");
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  // Guided builder (optional alternative to the manual Edit Resume workflow).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPeek, setWizardPeek] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const openChecklistItem = (anchor?: string) => {
    if (!anchor) return;
    setEditTab("extras");
    setIsEditOpen(true);
    setPendingAnchor(anchor);
  };

  // The checklist targets fields inside the edit panel, which only mounts once
  // it's open. Scroll after it renders, picking the visible copy (desktop drawer
  // and mobile sheet both render the same ids, one of them hidden per breakpoint).
  useEffect(() => {
    if (!pendingAnchor || !isEditOpen || editTab !== "extras") return;
    const target = Array.from(
      document.querySelectorAll<HTMLElement>(`[id="${pendingAnchor}"]`),
    ).find((el) => el.offsetParent !== null);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setPendingAnchor(null);
  }, [pendingAnchor, isEditOpen, editTab]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      userIdRef.current = u.user.id;
      const { data } = await supabase
        .from("resume_drafts")
        .select("extras, layout, template_id")
        .eq("user_id", u.user.id)
        .maybeSingle();
      const loaded = (data?.extras ?? {}) as ResumeExtras;
      setExtras(loaded);
      setSavedExtras(loaded);
      // Restore the template and layout the candidate last saved.
      const tpl = RESUME_TEMPLATE_LIST.some((t) => t.id === data?.template_id)
        ? (data!.template_id as string)
        : "classic-ats";
      const restored = data?.layout
        ? normalizeLayout(data.layout, getTemplateTheme(tpl))
        : getDefaultLayout(tpl);
      setSelectedTemplate(tpl);
      setLayoutDraft(restored);
      setSavedLayout(restored);
      setExtrasLoaded(true);
    })();
  }, []);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!isDirty && !layoutDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, layoutDirty]);

  const handleSaveExtras = async () => {
    const uid = userIdRef.current;
    if (!uid) {
      toast.error("Not signed in");
      return;
    }
    setSavingExtras(true);
    const { error } = await supabase
      .from("resume_drafts")
      .upsert({ user_id: uid, extras: extras as never }, { onConflict: "user_id" });
    setSavingExtras(false);
    if (error) {
      toast.error("Couldn't save your changes");
      return;
    }
    setSavedExtras(extras);
    toast.success("Changes saved");
  };

  // The live preview tracks the working draft (`extras`/`layoutDraft`), not the
  // saved copy — so every Edit Resume control updates it immediately. "Save
  // changes" still persists the draft to resume_drafts (and is what
  // Generate & Save reads), it's just no longer the gate for what the preview shows.
  const merged = useMemo(
    () => (snapshot ? applyResumeExtras({ ...snapshot, templateId: selectedTemplate }, extras) : null),
    [snapshot, extras, selectedTemplate],
  );
  // Section titles in current display order, including not-yet-saved edits, for the order list.
  const workingSections = useMemo(
    () => merged?.sections.map((sec) => ({ id: sec.id, title: sec.title })) ?? [],
    [merged],
  );
  const checklist = useMemo(() => (merged ? validateResume(merged) : []), [merged]);
  // react-pdf's incremental updates duplicate a node when its siblings are
  // reordered (a moved section would render twice in the live preview), so
  // the viewer is only remounted for that specific case — the section
  // id *order* signature. Template switches and layout/content edits must
  // NOT be in this key: PDFViewer renders via an iframe, so keying on
  // anything that changes on every edit forces a full iframe teardown/rebuild
  // (the visible flicker/reload) even though react-pdf already re-renders PDF
  // content in place without that. React also already remounts the <Template>
  // subtree on its own when templateId changes the component function, so a
  // template entry in this key was redundant for that case anyway.
  const previewKey = (merged ?? snapshot)?.sections.map((sec) => sec.id).join(",") ?? "";
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const query = (cols: string) =>
        supabase
          .from("resume_versions")
          .select(cols)
          .eq("user_id", user.id)
          .order("version_number", { ascending: false })
          .limit(MAX_RESUME_VERSIONS + 5);
      let res = await query("id, version_number, template_id, created_at, name, snapshot");
      if (res.error) {
        // The optional `name` column comes from a newer migration; if it isn't applied yet, still list
        // the saved versions (without custom names) instead of showing an empty list.
        console.error("[resume-builder] version query failed, retrying without name:", res.error.message);
        res = await query("id, version_number, template_id, created_at, snapshot");
      }
      if (res.error) {
        console.error("[resume-builder] couldn't load versions:", res.error.message);
        toast.error("Couldn't load your saved versions. Please refresh.");
        return;
      }
      setVersions((res.data as unknown as VersionRow[]) ?? []);
    } catch {
      // silently ignore
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    loadVersions();
  }, []);

  // ── Generate & save PDF version ───────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        toast.error("Not signed in");
        return;
      }
      // The server merges the *saved* draft, so unsaved edits would be missing
      // from the version while the preview (also saved-only) wouldn't show them
      // either — make the candidate save first so version, preview and PDF agree.
      if (isDirty || layoutDirty) {
        toast.error("Save your changes first, then generate.");
        return;
      }
      // A new version is blocked client-side too (clear message); the server and database enforce it.
      if (!editingVersion && versions.length >= MAX_RESUME_VERSIONS) {
        toast.error(RESUME_VERSION_LIMIT_MESSAGE);
        return;
      }
      const { version, pdfUrl } = await generateVersion(
        token,
        selectedTemplate,
        savedLayout,
        editingVersion?.version_number,
      );
      toast.success(
        editingVersion
          ? `Version ${editingVersion.version_number} updated!`
          : `Resume v${(version as VersionRow).version_number} saved!`,
      );
      setEditingVersion(null);
      // Show the saved version right away (the server returns the full row), then refresh the list.
      const saved = version as unknown as VersionRow;
      if (saved?.id) setVersions((prev) => [saved, ...prev.filter((row) => row.id !== saved.id)]);
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
      // Save the signed PDF in place instead of opening it in a new tab. A cross-origin
      // link's `download` attribute is ignored, so fetch it and save the blob ourselves.
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blobUrl = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `resume-v${v.version_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Fetch blocked (e.g. CORS): fall back to the previous behaviour so a download is never lost.
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't get a download link");
    } finally {
      setDownloadingVersionId(null);
    }
  };

  const handleRenameVersion = async (v: VersionRow, name: string) => {
    try {
      const res = await renameVersionFn({ data: { versionNumber: v.version_number, name } });
      setVersions((prev) => prev.map((row) => (row.id === v.id ? { ...row, name: res.name } : row)));
      toast.success("Name saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename this version");
      throw e;
    }
  };

  // Load a saved version's template + layout into the editor. "Generate & Save" then updates this
  // version (and its PDF) in place rather than creating another one.
  const handleEditVersion = (v: VersionRow) => {
    const tpl = RESUME_TEMPLATE_LIST.some((t) => t.id === v.template_id) ? v.template_id : "classic-ats";
    const layout = v.snapshot?.layout
      ? normalizeLayout(v.snapshot.layout, getTemplateTheme(tpl))
      : getDefaultLayout(tpl);
    setSelectedTemplate(tpl);
    setLayoutDraft(layout);
    setSavedLayout(layout);
    setEditingVersion(v);
    setIsVersionModalOpen(false);
    toast.info(`Editing ${v.name?.trim() || `Version ${v.version_number}`} — make changes, then save.`);
  };

  const handleDeleteVersion = async (v: VersionRow) => {
    if (deletingVersionId) return; // guard against a double-delete while one is in flight
    setDeletingVersionId(v.id);
    try {
      await deleteVersionFn({ data: { versionNumber: v.version_number } });
      setVersions((prev) => prev.filter((row) => row.id !== v.id));
      if (previewVersion?.id === v.id) setPreviewVersion(null);
      if (editingVersion?.id === v.id) setEditingVersion(null);
      toast.success(`Version ${v.version_number} deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete this version");
    } finally {
      setDeletingVersionId(null);
    }
  };

  const handleSave = async () => {
    if (layoutDirty) {
      await handleSaveLayout();
    }
    if (isDirty) {
      await handleSaveExtras();
    }
    setIsEditOpen(false);
  };

  const handleReset = () => {
    setLayoutDraft(getDefaultLayout(selectedTemplate));
    setSavedLayout(getDefaultLayout(selectedTemplate));
    setExtras({});
    setSavedExtras({});
    toast.success("Reset to defaults");
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
        <>
          {/* ── Desktop layout ── */}
          <div className="hidden lg:grid gap-6 lg:grid-cols-[340px_1fr]">
            {/* Sidebar */}
            <div className="flex flex-col gap-5">
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="flex items-center gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-left transition-all hover:bg-primary/10"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Wand2 className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Guided Resume Builder</p>
                  <p className="text-xs text-muted-foreground">Step by step, with tips for your role</p>
                </div>
              </button>
              <TemplatePicker selectedTemplate={selectedTemplate} onSelect={selectTemplate} />
              <EditModeTrigger isEditOpen={isEditOpen} onToggle={() => setIsEditOpen(true)} />

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
                        <Circle
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.severity === "required" ? "text-destructive" : "text-muted-foreground"}`}
                        />
                        {item.fix === "profile" ? (
                          <a
                            href="/candidate/profile"
                            className="text-foreground hover:text-primary hover:underline"
                          >
                            {item.message}
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="text-left text-foreground hover:text-primary hover:underline"
                            onClick={() => openChecklistItem(item.anchor)}
                          >
                            {item.message}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Tailor to a specific JobsKart job */}
              <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Tailor to a Job
                </h2>
                {merged && (
                  <JobMatchPanel
                    resume={merged}
                    onJumpToSummary={() => openChecklistItem("rb-summary")}
                  />
                )}
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
                  <InfoRow label="Sections" value={`${snapshot.sections.length} sections`} />
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
                  {generating
                    ? editingVersion
                      ? "Updating…"
                      : "Generating…"
                    : editingVersion
                      ? `Update Version ${editingVersion.version_number}`
                      : "Generate & Save Resume"}
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
                <div className="mb-1 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={loadVersions}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title="Refresh"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${versionsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <VersionHistory
                  versions={versions}
                  versionsLoading={versionsLoading}
                  onPreview={setPreviewVersion}
                  onDownload={handleDownloadVersion}
                  onDelete={handleDeleteVersion}
                  onRename={handleRenameVersion}
                  onEdit={handleEditVersion}
                  editingVersionNumber={editingVersion?.version_number ?? null}
                  onStopEditing={() => setEditingVersion(null)}
                  downloadingVersionId={downloadingVersionId}
                  deletingVersionId={deletingVersionId}
                />
              </section>
            </div>

            {/* Main preview area — this IS the real PDF engine (react-pdf), the
                exact same component tree used server-side for the download, so
                preview and download can never drift apart. */}
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
              <div className="relative h-[700px] overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
                <LivePreview
                  resume={merged ?? snapshot}
                  templateId={selectedTemplate}
                  layout={layoutDraft}
                  previewKey={previewKey}
                  fillViewport
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Preview is generated from your profile data. Click{" "}
                <strong>Generate &amp; Save</strong> to lock in this version and download the exact
                same PDF shown above.
              </p>
            </div>

            {isEditOpen && (
              <EditModeDrawer
                isOpen={isEditOpen}
                onClose={() => setIsEditOpen(false)}
                activeTab={editTab}
                setActiveTab={setEditTab}
                layoutDraft={layoutDraft}
                setLayoutDraft={setLayoutDraft}
                extras={extras}
                setExtras={setExtras}
                experiences={baseExperiences}
                sections={workingSections}
                onSave={handleSave}
                isSaving={savingExtras}
                isDirty={isDirty}
                onReset={handleReset}
                onSaveLayout={handleSaveLayout}
                isSavingLayout={savingLayout}
                isLayoutDirty={layoutDirty}
              />
            )}
          </div>

          {/* ── Mobile layout ── */}
          <div className="lg:hidden flex flex-col gap-4">
            {/* Full-screen-ish preview */}
            <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
              <header className="flex items-center justify-between px-4 py-2 bg-background border-b border-border">
                <div className="min-w-0 overflow-x-auto [&_button]:whitespace-nowrap">
                  <Segmented
                    value={selectedTemplate}
                    options={RESUME_TEMPLATE_LIST.map((t) => ({ value: t.id, label: t.label }))}
                    onChange={selectTemplate}
                  />
                </div>
                <EditModeTrigger
                  isEditOpen={isEditOpen}
                  onToggle={() => {
                    // Mobile always opens on the Layout tab, per spec — desktop's
                    // own trigger (above) is untouched and keeps whatever tab was
                    // last active.
                    setEditTab("layout");
                    setIsEditOpen(true);
                  }}
                />
              </header>
              <LivePreview
                resume={merged ?? snapshot}
                templateId={selectedTemplate}
                layout={layoutDraft}
                previewKey={previewKey}
                className="flex-1"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 px-5 text-sm font-semibold text-foreground transition-all hover:bg-primary/10"
              >
                <Wand2 className="h-4 w-4 text-primary" />
                Guided Resume Builder
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-60"
              >
                  {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                {generating
                    ? editingVersion
                      ? "Updating…"
                      : "Generating…"
                    : editingVersion
                      ? `Update Version ${editingVersion.version_number}`
                      : "Generate & Save Resume"}
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

              <button
                type="button"
                onClick={() => setIsVersionModalOpen(true)}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 text-sm font-semibold text-foreground shadow-sm transition-all hover:bg-surface"
              >
                <Clock className="h-4 w-4" />
                Version History
              </button>
            </div>

            {/* Completeness checklist */}
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
                      <Circle
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${item.severity === "required" ? "text-destructive" : "text-muted-foreground"}`}
                      />
                      {item.fix === "profile" ? (
                        <a
                          href="/candidate/profile"
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {item.message}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="text-left text-foreground hover:text-primary hover:underline"
                          onClick={() => openChecklistItem(item.anchor)}
                        >
                          {item.message}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Tailor to a specific JobsKart job */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Tailor to a Job
              </h2>
              {merged && (
                <JobMatchPanel
                  resume={merged}
                  onJumpToSummary={() => openChecklistItem("rb-summary")}
                />
              )}
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
                <InfoRow label="Sections" value={`${snapshot.sections.length} sections`} />
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

            {isEditOpen && (
              <EditModeBottomSheet
                isOpen={isEditOpen}
                onClose={() => setIsEditOpen(false)}
                activeTab={editTab}
                setActiveTab={setEditTab}
                layoutDraft={layoutDraft}
                setLayoutDraft={setLayoutDraft}
                extras={extras}
                setExtras={setExtras}
                experiences={baseExperiences}
                sections={workingSections}
                onSave={handleSave}
                isSaving={savingExtras}
                isDirty={isDirty}
                onReset={handleReset}
                onSaveLayout={handleSaveLayout}
                isSavingLayout={savingLayout}
                isLayoutDirty={layoutDirty}
              />
            )}

            {isVersionModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card p-6 shadow-xl">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground">Versions</h2>
                    <button
                      type="button"
                      onClick={() => setIsVersionModalOpen(false)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label="Close versions"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="overflow-y-auto">
                    <VersionHistory
                      versions={versions}
                      versionsLoading={versionsLoading}
                      onPreview={(v) => {
                        setPreviewVersion(v);
                        setIsVersionModalOpen(false);
                      }}
                      onDownload={handleDownloadVersion}
                      onDelete={handleDeleteVersion}
                  onRename={handleRenameVersion}
                  onEdit={handleEditVersion}
                  editingVersionNumber={editingVersion?.version_number ?? null}
                  onStopEditing={() => setEditingVersion(null)}
                      downloadingVersionId={downloadingVersionId}
                      deletingVersionId={deletingVersionId}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {wizardOpen && snapshot && (
        <>
          <GuidedResumeWizard
            snapshot={snapshot}
            resume={merged ?? snapshot}
            extras={extras}
            setExtras={setExtras}
            selectedTemplate={selectedTemplate}
            onSelectTemplate={selectTemplate}
            checklist={checklist}
            isDirty={isDirty || layoutDirty}
            isSaving={savingExtras || savingLayout}
            onSave={handleSave}
            onGenerate={handleGenerate}
            generating={generating}
            editingLabel={
              editingVersion ? editingVersion.name?.trim() || `Version ${editingVersion.version_number}` : null
            }
            lastPdfUrl={lastPdfUrl}
            onClose={() => {
              setWizardOpen(false);
              setWizardPeek(false);
            }}
            peek={wizardPeek}
            onPeek={() => setWizardPeek(true)}
          />
          {wizardPeek && (
            <button
              type="button"
              onClick={() => setWizardPeek(false)}
              className="fixed bottom-4 right-4 z-50 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-lg lg:hidden"
            >
              <Wand2 className="h-4 w-4" /> Back to guide
            </button>
          )}
        </>
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
  // See ensureStandardFonts.ts — PDFViewer must not mount until this resolves.
  const fontsReady = useStandardFontsReady();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        // Same pattern as ApplyDialog: only a click landing directly on the backdrop
        // closes it, never one bubbling up from inside the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-foreground">
            Version {version.version_number} — {version.template_id}
          </p>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1">
          {fontsReady && (
            <PDFViewer
              style={{ width: "100%", height: "100%", border: "none" }}
              showToolbar={false}
            >
              <Template resume={version.snapshot} />
            </PDFViewer>
          )}
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
          Complete your candidate profile first so the Resume Builder can pull your experience,
          education, and skills.
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

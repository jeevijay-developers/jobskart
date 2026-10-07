import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  createContentItem,
  deleteContentItem,
  getContentItemForEdit,
  togglePublish,
  updateContentItem,
  uploadCoverImage,
} from "@/lib/learning.functions";
import { getCertificateAssetUrls } from "@/lib/certificates.functions";
import {
  CertificateSettings,
  EMPTY_CERT_SETTINGS,
  type CertSettingsState,
} from "@/components/admin/CertificateSettings";
import { CERT_PREFIX_RE } from "@/lib/certificate-layout";

export const Route = createFileRoute("/admin/content")({
  component: Page,
});

type Kind = "video" | "reading" | "quiz";

type LessonForm = {
  title: string;
  kind: Kind;
  videoUrl: string;
  bodyMd: string;
  freePreview: boolean;
  durationMinutes: string;
};
type ModuleForm = LessonForm & { lessons: LessonForm[] };

type FormState = {
  id: string | null;
  type: "post" | "course" | "certification";
  title: string;
  excerpt: string;
  category: string;
  tagsCsv: string;
  coverUrl: string;
  bodyMd: string;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string;
  modules: ModuleForm[];
  coursePriceInr: string;
  priceInr: string;
  provider: "first_party" | "partner";
  partnerName: string;
  passMark: string;
  maxAttempts: string;
  validityMonths: string;
  questions: DraftQuestion[];
  cert: CertSettingsState;
};

// One exam question as the admin edits it. `id` is kept across edits so
// existing candidate answers still line up with the question they answered.
type DraftQuestion = { id: string; text: string; options: string[]; correct: number };

const MAX_OPTIONS = 8;

const newQuestion = (): DraftQuestion => ({
  id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  text: "",
  options: ["", ""],
  correct: 0,
});

const emptyLesson = (): LessonForm => ({
  title: "",
  kind: "reading",
  videoUrl: "",
  bodyMd: "",
  freePreview: false,
  durationMinutes: "",
});
const emptyModule = (): ModuleForm => ({ ...emptyLesson(), lessons: [] });

const EMPTY_FORM: FormState = {
  id: null,
  type: "post",
  title: "",
  excerpt: "",
  category: "",
  tagsCsv: "",
  coverUrl: "",
  bodyMd: "",
  seoTitle: "",
  seoDescription: "",
  ogImageUrl: "",
  modules: [],
  coursePriceInr: "0",
  priceInr: "0",
  provider: "first_party",
  partnerName: "",
  passMark: "80",
  maxAttempts: "3",
  validityMonths: "",
  questions: [],
  cert: EMPTY_CERT_SETTINGS,
};

// Saved certificate_config (+ enabled flag) -> form state. Preview URLs are filled in after load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function certSettingsFromRow(cert: any): CertSettingsState {
  const c = (cert?.certificate_config ?? {}) as Record<string, string | null | undefined>;
  return {
    enabled: !!cert?.certificate_enabled,
    paths: {
      template: c.templatePath ?? "",
      logo: c.logoPath ?? "",
      signature: c.signaturePath ?? "",
      signature2: c.signature2Path ?? "",
    },
    urls: {},
    names: {},
    issuerName: c.issuerName ?? "",
    prefix: c.prefix ?? "JK-CERT",
    layout: (cert?.certificate_config?.layout ?? {}) as CertSettingsState["layout"],
  };
}

type ListRow = {
  id: string;
  slug: string;
  title: string;
  content_type: "post" | "course" | "certification";
  status: "draft" | "published" | "archived";
  category: string | null;
  created_at: string | null;
};

const STATUS_TONE: Record<ListRow["status"], string> = {
  draft: "bg-surface text-muted-foreground",
  published: "bg-success-light text-success",
  archived: "bg-destructive/10 text-destructive",
};

function num(s: string, fallback = 0) {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function Page() {
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | ListRow["content_type"]>("all");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const create = useServerFn(createContentItem);
  const update = useServerFn(updateContentItem);
  const del = useServerFn(deleteContentItem);
  const toggle = useServerFn(togglePublish);
  const uploadCover = useServerFn(uploadCoverImage);
  const getForEdit = useServerFn(getContentItemForEdit);

  const load = async () => {
    setLoading(true);
    // Admin RLS ("Admins can manage ...", FOR ALL) covers this SELECT too, so a direct
    // browser read is fine here — same pattern as admin/learning.tsx. Writes go through
    // learning.functions.ts because creating/editing a course or certification touches
    // several tables together; centralising that beats duplicating it per call site.
    const { data, error } = await supabase
      .from("content_items")
      .select("id, slug, title, content_type, status, category, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as ListRow[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const getCertUrls = useServerFn(getCertificateAssetUrls);
  const startEdit = async (row: ListRow) => {
    // course_lessons body_md/video_url and certifications.questions are revoked
    // from the browser client's role entirely (see 20260930150000/1) — this has
    // to go through the admin-checked server function, not a direct table read.
    let data;
    try {
      data = await getForEdit({ data: { id: row.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load this item.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    const post = Array.isArray(d.content_posts) ? d.content_posts[0] : d.content_posts;
    const cert = Array.isArray(d.certifications) ? d.certifications[0] : d.certifications;
    const courseRow = Array.isArray(d.courses) ? d.courses[0] : d.courses;
    const modules: ModuleForm[] = (d.course_modules ?? [])
      .slice()
      .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({
        title: m.title,
        kind: m.kind,
        videoUrl: m.video_url ?? "",
        bodyMd: m.body_md ?? "",
        freePreview: !!m.free_preview,
        durationMinutes: m.duration_minutes != null ? String(m.duration_minutes) : "",
        lessons: (m.course_lessons ?? [])
          .slice()
          .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((l: any) => ({
            title: l.title,
            kind: l.kind,
            videoUrl: l.video_url ?? "",
            bodyMd: l.body_md ?? "",
            freePreview: !!l.free_preview,
            durationMinutes: l.duration_minutes != null ? String(l.duration_minutes) : "",
          })),
      }));

    setForm({
      id: d.id,
      type: d.content_type,
      title: d.title,
      excerpt: d.excerpt ?? "",
      category: d.category ?? "",
      tagsCsv: (d.tags ?? []).join(", "),
      coverUrl: d.cover_url ?? "",
      bodyMd: post?.body_md ?? "",
      seoTitle: post?.seo_title ?? "",
      seoDescription: post?.seo_description ?? "",
      ogImageUrl: post?.og_image_url ?? "",
      modules,
      coursePriceInr: courseRow ? String(courseRow.price_inr) : "0",
      priceInr: cert ? String(cert.price_inr) : "0",
      provider: cert?.provider ?? "first_party",
      partnerName: cert?.partner_name ?? "",
      passMark: cert ? String(cert.pass_mark) : "80",
      maxAttempts: cert ? String(cert.max_attempts) : "3",
      validityMonths: cert?.validity_months != null ? String(cert.validity_months) : "",
      cert: certSettingsFromRow(cert),
      questions: cert
        ? (cert.questions ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (q: any): DraftQuestion => ({
              id: String(q.id),
              text: String(q.text ?? ""),
              options: Array.isArray(q.options) ? q.options.map(String) : ["", ""],
              correct: Number.isInteger(q.correct) ? q.correct : 0,
            }),
          )
        : [],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Signed preview URLs for the saved certificate assets (private bucket) — display only.
    const cs = certSettingsFromRow(cert);
    const entries = (Object.entries(cs.paths) as [keyof typeof cs.paths, string][]).filter(([, p]) => p);
    if (entries.length) {
      getCertUrls({ data: { paths: entries.map(([, p]) => p) } })
        .then((urls) =>
          setForm((f) =>
            f.id === d.id
              ? {
                  ...f,
                  cert: {
                    ...f.cert,
                    urls: Object.fromEntries(entries.map(([k, p]) => [k, urls[p]])),
                  },
                }
              : f,
          ),
        )
        .catch(() => {});
    }
  };

  const resetForm = () => setForm(EMPTY_FORM);

  const patchQuestion = (qi: number, patch: Partial<DraftQuestion>) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)),
    }));

  const addOption = (qi: number) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi && q.options.length < MAX_OPTIONS ? { ...q, options: [...q.options, ""] } : q,
      ),
    }));

  // Removing an option shifts the correct index if the removed one sat before it,
  // and falls back to the first option if the correct one itself was removed.
  const removeOption = (qi: number, oi: number) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => {
        if (i !== qi || q.options.length <= 2) return q;
        const correct = oi < q.correct ? q.correct - 1 : oi === q.correct ? 0 : q.correct;
        return { ...q, options: q.options.filter((_, j) => j !== oi), correct };
      }),
    }));

  const handleCoverUpload = async (file: File) => {
    setUploadingCover(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(file);
      });
      const { url } = await uploadCover({
        data: { fileName: file.name, base64, mimeType: file.type || "application/octet-stream" },
      });
      setForm((f) => ({ ...f, coverUrl: url }));
      toast.success("Cover image uploaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSave = async () => {
    if (form.title.trim().length < 3) {
      toast.error("Title must be at least 3 characters.");
      return;
    }
    const questions: { id: string; text: string; options: string[]; correct: number }[] = [];
    if (form.type === "certification" && form.cert.enabled) {
      if (!form.cert.paths.template) {
        toast.error("Upload a certificate template, or turn Enable Certificate off.");
        return;
      }
      if (form.cert.prefix.trim() && !CERT_PREFIX_RE.test(form.cert.prefix.trim())) {
        toast.error("Certificate prefix can only contain letters, numbers and dashes (max 16).");
        return;
      }
    }
    if (form.type === "certification") {
      for (const [i, q] of form.questions.entries()) {
        const text = q.text.trim();
        const options = q.options.map((o) => o.trim());
        if (!text) {
          toast.error(`Question ${i + 1} needs text.`);
          return;
        }
        if (options.length < 2) {
          toast.error(`Question ${i + 1} needs at least 2 options.`);
          return;
        }
        if (options.some((o) => !o)) {
          toast.error(`Question ${i + 1} has an empty option. Fill it in or remove it.`);
          return;
        }
        questions.push({ id: q.id, text, options, correct: q.correct });
      }
    }

    const tags = form.tagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const courseModules = form.modules.map((m) => ({
      title: m.title,
      kind: m.kind,
      videoUrl: m.videoUrl || null,
      bodyMd: m.bodyMd || null,
      freePreview: m.freePreview,
      durationMinutes: m.durationMinutes ? num(m.durationMinutes) : null,
      lessons: m.lessons.map((l) => ({
        title: l.title,
        kind: l.kind,
        videoUrl: l.videoUrl || null,
        bodyMd: l.bodyMd || null,
        freePreview: l.freePreview,
        durationMinutes: l.durationMinutes ? num(l.durationMinutes) : null,
      })),
    }));

    setSaving(true);
    try {
      const shared = {
        excerpt: form.excerpt || null,
        category: form.category || null,
        tags,
        coverUrl: form.coverUrl || null,
        bodyMd: form.type === "post" ? form.bodyMd : undefined,
        seoTitle: form.type === "post" ? form.seoTitle || null : undefined,
        seoDescription: form.type === "post" ? form.seoDescription || null : undefined,
        ogImageUrl: form.type === "post" ? form.ogImageUrl || null : undefined,
        courseModules: form.type === "course" ? courseModules : undefined,
        coursePriceInr: form.type === "course" ? num(form.coursePriceInr) : undefined,
        certificationDetails:
          form.type === "certification"
            ? {
                priceInr: num(form.priceInr),
                provider: form.provider,
                partnerName: form.provider === "partner" ? form.partnerName || null : null,
                passMark: num(form.passMark, 80),
                maxAttempts: num(form.maxAttempts, 3),
                validityMonths: form.validityMonths ? num(form.validityMonths) : null,
                certificateEnabled: form.cert.enabled,
                certificateConfig: {
                  templatePath: form.cert.paths.template || null,
                  logoPath: form.cert.paths.logo || null,
                  signaturePath: form.cert.paths.signature || null,
                  signature2Path: form.cert.paths.signature2 || null,
                  issuerName: form.cert.issuerName.trim() || null,
                  prefix: form.cert.prefix.trim() || null,
                  layout: form.cert.layout,
                },
                questions,
              }
            : undefined,
      };

      if (form.id) {
        await update({ data: { id: form.id, title: form.title, ...shared } });
        toast.success("Saved.");
      } else {
        await create({ data: { type: form.type, title: form.title, ...shared } });
        toast.success("Created as draft.");
      }
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ListRow) => {
    if (!window.confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    try {
      await del({ data: { id: row.id } });
      toast.success("Deleted.");
      if (form.id === row.id) resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const handleToggle = async (row: ListRow) => {
    try {
      await toggle({ data: { id: row.id } });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update status.");
    }
  };

  const shown = rows.filter((r) => typeFilter === "all" || r.content_type === typeFilter);

  return (
    <AdminShell title="Content Library" subtitle="Articles, courses and certifications">
      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {form.id ? `Editing: ${form.title || "…"}` : "New item"}
          </h2>
          {form.id && (
            <Button size="sm" variant="ghost" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Type</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm((f) => ({ ...f, type: v as FormState["type"] }))}
              disabled={!!form.id}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="post">Article / post</SelectItem>
                <SelectItem value="course">Course</SelectItem>
                <SelectItem value="certification">Certification</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Excerpt</Label>
            <Textarea
              rows={2}
              value={form.excerpt}
              onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
            />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input
              value={form.tagsCsv}
              onChange={(e) => setForm((f) => ({ ...f, tagsCsv: e.target.value }))}
            />
          </div>
          <div>
            <Label>Cover image</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/gif"
                disabled={uploadingCover}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleCoverUpload(file);
                }}
              />
              {uploadingCover && <Upload className="h-4 w-4 animate-spin text-primary" />}
            </div>
            {form.coverUrl && (
              <img src={form.coverUrl} alt="" className="mt-2 h-20 rounded-lg object-cover" />
            )}
          </div>
        </div>

        {form.type === "post" && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div>
              <Label>Body (Markdown)</Label>
              <Textarea
                rows={10}
                value={form.bodyMd}
                onChange={(e) => setForm((f) => ({ ...f, bodyMd: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>SEO title</Label>
                <Input
                  value={form.seoTitle}
                  onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))}
                />
              </div>
              <div>
                <Label>OG image URL</Label>
                <Input
                  value={form.ogImageUrl}
                  onChange={(e) => setForm((f) => ({ ...f, ogImageUrl: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>SEO description</Label>
                <Textarea
                  rows={2}
                  value={form.seoDescription}
                  onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))}
                />
              </div>
            </div>
          </div>
        )}

        {form.type === "course" && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="max-w-xs">
              <Label>Price (₹, 0 = free)</Label>
              <Input
                type="number"
                min={0}
                value={form.coursePriceInr}
                onChange={(e) => setForm((f) => ({ ...f, coursePriceInr: e.target.value }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Free-preview lessons stay open to everyone even when the course is priced.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Modules</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setForm((f) => ({ ...f, modules: [...f.modules, emptyModule()] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add module
              </Button>
            </div>
            {form.modules.map((m, mi) => (
              <div key={mi} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Module {mi + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm((f) => ({ ...f, modules: f.modules.filter((_, i) => i !== mi) }))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <ModuleFields
                  value={m}
                  onChange={(next) =>
                    // next is typed LessonForm (ModuleFields doesn't know about `lessons`);
                    // merge onto the existing module rather than replacing it outright, so
                    // this module's own lessons array is kept both at runtime and in the type.
                    setForm((f) => ({
                      ...f,
                      modules: f.modules.map((x, i) => (i === mi ? { ...x, ...next } : x)),
                    }))
                  }
                />

                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Lessons
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          modules: f.modules.map((x, i) =>
                            i === mi ? { ...x, lessons: [...x.lessons, emptyLesson()] } : x,
                          ),
                        }))
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add lesson
                    </Button>
                  </div>
                  {m.lessons.map((l, li) => (
                    <div key={li} className="mt-2 rounded-lg bg-surface p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Lesson {li + 1}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              modules: f.modules.map((x, i) =>
                                i === mi
                                  ? { ...x, lessons: x.lessons.filter((_, j) => j !== li) }
                                  : x,
                              ),
                            }))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                      <ModuleFields
                        value={l}
                        onChange={(next) =>
                          setForm((f) => ({
                            ...f,
                            modules: f.modules.map((x, i) =>
                              i === mi
                                ? { ...x, lessons: x.lessons.map((y, j) => (j === li ? next : y)) }
                                : x,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {form.modules.length === 0 && (
              <p className="text-sm text-muted-foreground">No modules yet.</p>
            )}
          </div>
        )}

        {form.type === "certification" && (
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <div>
              <Label>Price (₹, 0 = free)</Label>
              <Input
                type="number"
                min={0}
                value={form.priceInr}
                onChange={(e) => setForm((f) => ({ ...f, priceInr: e.target.value }))}
              />
            </div>
            <div>
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, provider: v as FormState["provider"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first_party">JobsKart</SelectItem>
                  <SelectItem value="partner">Partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.provider === "partner" && (
              <div className="sm:col-span-2">
                <Label>Partner name</Label>
                <Input
                  value={form.partnerName}
                  onChange={(e) => setForm((f) => ({ ...f, partnerName: e.target.value }))}
                />
              </div>
            )}
            <div>
              <Label>Pass mark (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.passMark}
                onChange={(e) => setForm((f) => ({ ...f, passMark: e.target.value }))}
              />
            </div>
            <div>
              <Label>Max attempts</Label>
              <Input
                type="number"
                min={1}
                value={form.maxAttempts}
                onChange={(e) => setForm((f) => ({ ...f, maxAttempts: e.target.value }))}
              />
            </div>
            <div>
              <Label>Validity (months, blank = never expires)</Label>
              <Input
                type="number"
                min={1}
                value={form.validityMonths}
                onChange={(e) => setForm((f) => ({ ...f, validityMonths: e.target.value }))}
              />
            </div>
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Questions</Label>
                <span className="text-xs text-muted-foreground">
                  {form.questions.length} question{form.questions.length === 1 ? "" : "s"}
                </span>
              </div>

              {form.questions.map((q, qi) => (
                <div key={q.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Q{qi + 1}</span>
                    <Input
                      placeholder="Question text"
                      value={q.text}
                      onChange={(e) => patchQuestion(qi, { text: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove question ${qi + 1}`}
                      onClick={() =>
                        setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== qi) }))
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <div className="space-y-2 pl-7">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${q.id}`}
                          checked={q.correct === oi}
                          onChange={() => patchQuestion(qi, { correct: oi })}
                          aria-label={`Option ${oi + 1} is correct`}
                          title="Mark as correct answer"
                          className="h-4 w-4 accent-primary"
                        />
                        <Input
                          placeholder={`Option ${oi + 1}`}
                          value={opt}
                          onChange={(e) =>
                            patchQuestion(qi, {
                              options: q.options.map((o, j) => (j === oi ? e.target.value : o)),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove option ${oi + 1}`}
                          disabled={q.options.length <= 2}
                          onClick={() => removeOption(qi, oi)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <div className="flex items-center justify-between pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={q.options.length >= MAX_OPTIONS}
                        onClick={() => addOption(qi)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add option
                      </Button>
                      <p className="text-xs text-muted-foreground">Select the radio button for the correct answer</p>
                    </div>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, newQuestion()] }))}
              >
                <Plus className="mr-1 h-4 w-4" /> Add question
              </Button>
            </div>
            <CertificateSettings
              value={form.cert}
              onChange={(cert) => setForm((f) => ({ ...f, cert }))}
              courseTitle={form.title}
              providerLabel={form.provider === "partner" && form.partnerName ? form.partnerName : "JobsKart"}
              validityMonths={form.validityMonths ? num(form.validityMonths) : null}
            />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : form.id ? "Save changes" : "Create draft"}
          </Button>
          {form.id && (
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", "post", "course", "certification"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`h-8 rounded-full border px-3 text-xs font-semibold ${
              typeFilter === t
                ? "border-primary bg-primary-light text-primary"
                : "border-border text-foreground/80"
            }`}
          >
            {t === "all"
              ? "All"
              : t === "post"
                ? "Articles"
                : t === "course"
                  ? "Courses"
                  : "Certifications"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{row.title}</p>
                <p className="text-xs text-muted-foreground">
                  {row.content_type} · {row.category || "uncategorized"} · /learn/{row.content_type}
                  /{row.slug}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_TONE[row.status]}`}
                >
                  {row.status}
                </span>
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={row.status === "published"}
                    onCheckedChange={() => handleToggle(row)}
                  />
                  <span className="text-xs text-muted-foreground">Published</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

/** Shared title/kind/video/body/preview/duration fields, used for both a module and a lesson. */
function ModuleFields({
  value,
  onChange,
}: {
  value: LessonForm;
  onChange: (v: LessonForm) => void;
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Input
          placeholder="Title"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </div>
      <Select value={value.kind} onValueChange={(v) => onChange({ ...value, kind: v as Kind })}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="video">Video</SelectItem>
          <SelectItem value="reading">Reading</SelectItem>
          <SelectItem value="quiz">Quiz</SelectItem>
        </SelectContent>
      </Select>
      <Input
        placeholder="Duration (minutes)"
        type="number"
        min={0}
        value={value.durationMinutes}
        onChange={(e) => onChange({ ...value, durationMinutes: e.target.value })}
      />
      {value.kind === "video" && (
        <div className="sm:col-span-2">
          <Input
            placeholder="Video URL (YouTube / Vimeo)"
            value={value.videoUrl}
            onChange={(e) => onChange({ ...value, videoUrl: e.target.value })}
          />
        </div>
      )}
      {value.kind !== "video" && (
        <div className="sm:col-span-2">
          <Textarea
            placeholder="Content (Markdown)"
            rows={3}
            value={value.bodyMd}
            onChange={(e) => onChange({ ...value, bodyMd: e.target.value })}
          />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={value.freePreview}
          onChange={(e) => onChange({ ...value, freePreview: e.target.checked })}
        />
        Free preview (visible before purchase)
      </label>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
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
  questionsJson: string;
};

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
  questionsJson: "[]",
};

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
      questionsJson: cert ? JSON.stringify(cert.questions ?? [], null, 2) : "[]",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => setForm(EMPTY_FORM);

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
    let questions: unknown[] = [];
    if (form.type === "certification") {
      try {
        const parsed: unknown = JSON.parse(form.questionsJson || "[]");
        if (!Array.isArray(parsed)) throw new Error("not an array");
        questions = parsed;
      } catch {
        toast.error("Questions must be valid JSON array, e.g. []");
        return;
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
            <div className="sm:col-span-2">
              <Label>Questions (JSON array)</Label>
              <Textarea
                rows={6}
                className="font-mono text-xs"
                value={form.questionsJson}
                onChange={(e) => setForm((f) => ({ ...f, questionsJson: e.target.value }))}
              />
            </div>
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

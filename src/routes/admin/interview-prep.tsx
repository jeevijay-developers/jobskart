import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORY_LABELS, type Framework } from "@/lib/interview-prep";
import { draftQuestionTranslation } from "@/lib/interview-prep.functions";

export const Route = createFileRoute("/admin/interview-prep")({
  component: Page,
});

// RLS (super_admin only for writes) is the real gate; admins never see candidate answers here.
const db = supabase;

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const EMPTY = {
  category: "behavioural",
  question: "",
  difficulty: "easy",
  roleKeywords: "",
  skillTags: "",
  frameworkName: "",
  steps: "",
  status: "draft",
};

type Template = {
  id: string;
  category: string;
  question: string;
  status: string;
  difficulty: string;
  role_keywords: string[] | null;
};
type Report = {
  id: string;
  target_type: string;
  category: string;
  details: string | null;
  status: string;
  created_at: string;
};
type Translation = {
  template_id: string;
  question: string;
  framework: Framework;
  status: "draft" | "published";
};

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const draftTranslation = useServerFn(draftQuestionTranslation);

  const templates = useQuery({
    queryKey: ["ip-templates-admin"],
    queryFn: async () => {
      const { data, error } = await db
        .from("interview_prep_question_templates")
        .select("id, category, question, status, difficulty, role_keywords")
        .order("category")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Template[];
    },
  });
  const reports = useQuery({
    queryKey: ["ip-reports-admin"],
    queryFn: async () => {
      const { data, error } = await db
        .from("interview_prep_reports")
        .select("id, target_type, category, details, status, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Report[];
    },
  });
  const translations = useQuery({
    queryKey: ["ip-template-translations-admin"],
    queryFn: async () => {
      const { data, error } = await db
        .from("interview_prep_question_template_translations")
        .select("template_id, question, framework, status")
        .eq("language", "hi");
      if (error) throw error;
      const map: Record<string, Translation> = {};
      for (const row of data as Translation[]) map[row.template_id] = row;
      return map;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const steps = form.steps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const { error } = await db.from("interview_prep_question_templates").insert({
        category: form.category,
        question: form.question.trim(),
        difficulty: form.difficulty,
        role_keywords: csv(form.roleKeywords).length ? csv(form.roleKeywords) : null,
        skill_tags: csv(form.skillTags),
        framework: { name: form.frameworkName.trim() || undefined, steps },
        status: form.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Question added");
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["ip-templates-admin"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("uq_ip_templates_question")
          ? "That question already exists."
          : e.message,
      ),
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db
        .from("interview_prep_question_templates")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ip-templates-admin"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await db.from("interview_prep_reports").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ip-reports-admin"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const requestDraft = useMutation({
    mutationFn: (templateId: string) => draftTranslation({ data: { templateId, language: "hi" } }),
    onSuccess: () => {
      toast.success("Draft translated — review before publishing.");
      qc.invalidateQueries({ queryKey: ["ip-template-translations-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveTranslation = useMutation({
    mutationFn: async ({
      templateId,
      question,
      steps,
      status,
    }: {
      templateId: string;
      question: string;
      steps: string[];
      status: "draft" | "published";
    }) => {
      const { error } = await db.from("interview_prep_question_template_translations").upsert({
        template_id: templateId,
        language: "hi",
        question,
        framework: { steps },
        status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Translation saved.");
      qc.invalidateQueries({ queryKey: ["ip-template-translations-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

  return (
    <AdminShell title="Interview prep" subtitle="Question bank and reported feedback">
      {!!reports.data?.length && (
        <div className="mb-6 space-y-2 rounded-2xl border border-border bg-card p-4">
          <p className="font-semibold text-foreground">Open reports ({reports.data.length})</p>
          {reports.data.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium capitalize">
                  {r.target_type} · {r.category}
                </span>
                {r.details ? <span className="text-muted-foreground"> — {r.details}</span> : null}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolve.mutate({ id: r.id, status: "resolved" })}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolve.mutate({ id: r.id, status: "dismissed" })}
                >
                  Dismiss
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Question</Label>
          <Input value={form.question} onChange={(e) => set("question")(e.target.value)} />
        </div>
        <div>
          <Label>Category</Label>
          <Select value={form.category} onValueChange={set("category")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Difficulty</Label>
          <Select value={form.difficulty} onValueChange={set("difficulty")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["easy", "medium", "hard"].map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Role keywords (comma-separated, blank = all roles)</Label>
          <Input value={form.roleKeywords} onChange={(e) => set("roleKeywords")(e.target.value)} />
        </div>
        <div>
          <Label>Skill tags (comma-separated)</Label>
          <Input value={form.skillTags} onChange={(e) => set("skillTags")(e.target.value)} />
        </div>
        <div>
          <Label>Outline name (e.g. STAR)</Label>
          <Input
            value={form.frameworkName}
            onChange={(e) => set("frameworkName")(e.target.value)}
          />
        </div>
        <div>
          <Label>Publish state</Label>
          <Select value={form.status} onValueChange={set("status")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Outline steps (one per line — an outline, never a model answer)</Label>
          <Textarea rows={3} value={form.steps} onChange={(e) => set("steps")(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Button
            onClick={() => add.mutate()}
            disabled={form.question.trim().length < 10 || add.isPending}
          >
            Add question
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {templates.data?.map((t) => (
          <div key={t.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{t.question}</p>
                <p className="text-xs text-muted-foreground">
                  {CATEGORY_LABELS[t.category] ?? t.category} · {t.difficulty}
                  {t.role_keywords ? ` · roles: ${t.role_keywords.join(", ")}` : " · all roles"}
                </p>
              </div>
              <Select
                value={t.status}
                onValueChange={(status) => setStatus.mutate({ id: t.id, status })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TranslationPanel
              templateId={t.id}
              existing={translations.data?.[t.id]}
              drafting={requestDraft.isPending}
              onDraft={() => requestDraft.mutate(t.id)}
              onSave={(question, steps, status) =>
                saveTranslation.mutate({ templateId: t.id, question, steps, status })
              }
            />
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

function TranslationPanel({
  templateId,
  existing,
  drafting,
  onDraft,
  onSave,
}: {
  templateId: string;
  existing: Translation | undefined;
  drafting: boolean;
  onDraft: () => void;
  onSave: (question: string, steps: string[], status: "draft" | "published") => void;
}) {
  const [question, setQuestion] = useState(existing?.question ?? "");
  const [steps, setSteps] = useState((existing?.framework.steps ?? []).join("\n"));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sync local edit buffer when a fresh/updated translation arrives (e.g. right
  // after an AI draft) — but only once per distinct `existing` value, so the
  // admin's in-progress manual edits are never clobbered by a background refetch.
  const existingKey = existing ? `${existing.question}|${existing.status}` : "none";
  if (loadedFor !== `${templateId}:${existingKey}`) {
    setLoadedFor(`${templateId}:${existingKey}`);
    setQuestion(existing?.question ?? "");
    setSteps((existing?.framework.steps ?? []).join("\n"));
  }

  const stepList = () =>
    steps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-primary">
        Hindi translation {existing ? `(${existing.status})` : "(none yet)"}
      </summary>
      <div className="mt-2 space-y-2">
        <Button size="sm" variant="outline" onClick={onDraft} disabled={drafting}>
          {drafting ? "Drafting…" : existing ? "Re-draft with AI" : "Draft with AI"}
        </Button>
        <div>
          <Label>Hindi question</Label>
          <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div>
          <Label>Hindi outline steps (one per line)</Label>
          <Textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={question.trim().length < 3}
            onClick={() => onSave(question.trim(), stepList(), "draft")}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={question.trim().length < 3}
            onClick={() => onSave(question.trim(), stepList(), "published")}
          >
            Save &amp; publish
          </Button>
          {existing?.status === "published" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSave(question.trim(), stepList(), "draft")}
            >
              Unpublish
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}

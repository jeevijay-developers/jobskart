import { createFileRoute } from "@tanstack/react-router";
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
import { CATEGORY_LABELS } from "@/lib/interview-prep";

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

function Page() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);

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
          <div
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
          >
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
        ))}
      </div>
    </AdminShell>
  );
}

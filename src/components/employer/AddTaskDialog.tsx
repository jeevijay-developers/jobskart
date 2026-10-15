import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getLeads, mapCrmError, saveTask } from "@/lib/crm.functions";

const PRIORITIES = [
  { value: 0, label: "Low" },
  { value: 1, label: "Medium" },
  { value: 2, label: "High" },
];

const TASK_TYPES = [
  { value: "call", label: "Call" },
  { value: "interview_followup", label: "Interview Follow-up" },
  { value: "send_message", label: "Send Message" },
  { value: "check_application", label: "Check Application" },
  { value: "other", label: "Other" },
] as const;

type LeadOption = {
  candidate_id: string;
  full_name: string | null;
  job_title: string | null;
  application_id: string | null;
  job_id: string | null;
};

function defaultDueAt(initial?: Date) {
  const d = initial ? new Date(initial) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Manual "add follow-up task". Works two ways: pass a `candidateId` directly
 * (the existing per-row CRM usage), or omit it to show a searchable
 * candidate picker first (the Follow-up Calendar's standalone "Add
 * Follow-up" button, which has no pre-selected lead).
 */
export function AddTaskDialog({
  open,
  onOpenChange,
  companyId,
  candidateId,
  candidateName,
  applicationId,
  jobId,
  initialDueDate,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  candidateId?: string | null;
  candidateName?: string | null;
  applicationId?: string | null;
  jobId?: string | null;
  initialDueDate?: Date;
  onSaved?: () => void;
}) {
  const save = useServerFn(saveTask);
  const fetchLeads = useServerFn(getLeads);

  const [selected, setSelected] = useState<LeadOption | null>(
    candidateId
      ? {
          candidate_id: candidateId,
          full_name: candidateName ?? null,
          job_title: null,
          application_id: applicationId ?? null,
          job_id: jobId ?? null,
        }
      : null,
  );
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [query, setQuery] = useState("");

  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueAt(initialDueDate));
  const [priority, setPriority] = useState(1);
  const [taskType, setTaskType] = useState<(typeof TASK_TYPES)[number]["value"]>("call");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const needsPicker = !candidateId;

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDueAt(defaultDueAt(initialDueDate));
    setPriority(1);
    setTaskType("call");
    setBody("");
    setQuery("");
    setSelected(
      candidateId
        ? {
            candidate_id: candidateId,
            full_name: candidateName ?? null,
            job_title: null,
            application_id: applicationId ?? null,
            job_id: jobId ?? null,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !needsPicker) return;
    setLeadsLoading(true);
    fetchLeads({ data: { companyId, limit: 200 } })
      .then((rows) => setLeads(rows as unknown as LeadOption[]))
      .catch(() => setLeads([]))
      .finally(() => setLeadsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, needsPicker, companyId]);

  const visibleLeads = query.trim()
    ? leads.filter((l) => (l.full_name ?? "").toLowerCase().includes(query.trim().toLowerCase()))
    : leads;

  const handleSave = async () => {
    if (!selected || !title.trim() || !dueAt) return;
    setSaving(true);
    try {
      await save({
        data: {
          companyId,
          candidateId: selected.candidate_id,
          title: title.trim(),
          dueAt: new Date(dueAt).toISOString(),
          applicationId: selected.application_id ?? undefined,
          jobId: selected.job_id ?? undefined,
          body: body.trim() || undefined,
          priority,
          taskType,
        },
      });
      toast.success("Task created");
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't create task"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add follow-up task</SheetTitle>
          <SheetDescription>
            {selected?.full_name ? `For ${selected.full_name}` : "New follow-up task"}
          </SheetDescription>
        </SheetHeader>

        {needsPicker && !selected ? (
          <div className="space-y-2">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              Candidate
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="form-input h-10 w-full pl-9 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {leadsLoading ? (
                <p className="p-3 text-center text-xs text-muted-foreground">Loading…</p>
              ) : visibleLeads.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  No candidates found.
                </p>
              ) : (
                visibleLeads.map((l) => (
                  <button
                    key={l.candidate_id}
                    type="button"
                    onClick={() => setSelected(l)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      {l.full_name ?? "Candidate"}
                    </span>
                    {l.job_title && (
                      <span className="text-xs text-muted-foreground">{l.job_title}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {needsPicker && selected && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
                <span className="text-sm font-semibold text-foreground">{selected.full_name}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Title
              </label>
              <input
                type="text"
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Call back about interview availability"
                className="form-input h-10 w-full text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Due
                </label>
                <input
                  type="datetime-local"
                  required
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="form-input h-10 w-full text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="form-input h-10 w-full text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Follow-up type
              </label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as typeof taskType)}
                className="form-input h-10 w-full text-sm"
              >
                {TASK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Notes (optional)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={2000}
                className="form-input w-full text-sm"
              />
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !selected || !title.trim() || !dueAt}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create task"}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

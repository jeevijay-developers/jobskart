import { useEffect, useState } from "react";
import { GraduationCap, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const SNOOZE_DAYS = 7;
const TASK_KEY = "education_details";

type Props = {
  candidateId: string;
  highestQualification: string | null;
  /** Where this nudge is being shown, for telemetry only. */
  surface: "profile" | "dashboard" | "apply";
  onSaved?: () => void;
};

// Feature 5 of resume-linkedin-salary-education-onboarding-implementation-plan.md.
// A single, non-blocking, dismissible prompt for the education detail that
// onboarding deliberately skips (institute/board/passing year). Eligibility
// and completeness are derived from real data (candidate_education rows),
// not a second source of truth — candidate_profile_tasks only remembers the
// dismiss/snooze decision.
export function EducationNudge({ candidateId, highestQualification, surface, onSaved }: Props) {
  const [visible, setVisible] = useState(false);
  const [institute, setInstitute] = useState("");
  const [board, setBoard] = useState("");
  const [year, setYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [eduId, setEduId] = useState<string | null>(null);

  useEffect(() => {
    if (!highestQualification) return;
    let cancelled = false;
    (async () => {
      const [{ data: edu }, { data: task }] = await Promise.all([
        supabase
          .from("candidate_education")
          .select("id, institute, board_or_university, year_of_passing")
          .eq("user_id", candidateId)
          .order("created_at", { ascending: false }),
        supabase
          .from("candidate_profile_tasks")
          .select("status, snoozed_until")
          .eq("candidate_id", candidateId)
          .eq("task_key", TASK_KEY)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const hasDetail = (edu ?? []).some((e) => (e.institute ?? "").trim().length > 0);
      if (hasDetail) return; // already complete — nothing to nudge
      const row = edu?.[0];
      if (row) setEduId(row.id);
      if (task?.status === "dismissed") return;
      if (task?.status === "snoozed" && task.snoozed_until && new Date(task.snoozed_until) > new Date()) return;

      setVisible(true);
      supabase
        .from("candidate_profile_tasks")
        .upsert(
          { candidate_id: candidateId, task_key: TASK_KEY, last_shown_at: new Date().toISOString() },
          { onConflict: "candidate_id,task_key" },
        )
        .then(() => {}, () => {});
      supabase
        .from("candidate_profile_events")
        .insert({ candidate_id: candidateId, event_key: "education_prompt_shown", context: { surface } })
        .then(() => {}, () => {});
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, highestQualification]);

  if (!visible) return null;

  const snooze = async (status: "snoozed" | "dismissed") => {
    setVisible(false);
    const patch: Record<string, unknown> = { candidate_id: candidateId, task_key: TASK_KEY, status };
    if (status === "snoozed") patch.snoozed_until = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString();
    await supabase.from("candidate_profile_tasks").upsert(patch as never, { onConflict: "candidate_id,task_key" });
    supabase
      .from("candidate_profile_events")
      .insert({ candidate_id: candidateId, event_key: `education_prompt_${status}`, context: { surface } })
      .then(() => {}, () => {});
  };

  const save = async () => {
    if (!institute.trim()) {
      toast.error("Please enter your college / institute name.");
      return;
    }
    setSaving(true);
    try {
      const patch = {
        institute: institute.trim(),
        board_or_university: board.trim() || null,
        year_of_passing: year ? Number(year) : null,
      };
      if (eduId) {
        await supabase.from("candidate_education").update(patch).eq("id", eduId);
      } else {
        await supabase.from("candidate_education").insert({
          user_id: candidateId,
          level: highestQualification || "Other",
          ...patch,
        });
      }
      await supabase
        .from("candidate_profile_tasks")
        .upsert(
          { candidate_id: candidateId, task_key: TASK_KEY, status: "completed" },
          { onConflict: "candidate_id,task_key" },
        );
      supabase
        .from("candidate_profile_events")
        .insert({ candidate_id: candidateId, event_key: "education_prompt_completed", context: { surface } })
        .then(() => {}, () => {});
      toast.success("Education details saved.");
      setVisible(false);
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary-light/40 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <GraduationCap className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">
              Add your college & passing year to improve your matches
            </p>
            <button
              type="button"
              onClick={() => snooze("snoozed")}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss for now"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Employers filter by education — this takes 30 seconds and you can always edit it later.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <input
              className="form-input h-9 text-sm"
              placeholder="College / Institute"
              value={institute}
              onChange={(e) => setInstitute(e.target.value)}
            />
            <input
              className="form-input h-9 text-sm"
              placeholder="Board / University (optional)"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
            />
            <input
              className="form-input h-9 text-sm"
              type="number"
              placeholder="Passing year (optional)"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => snooze("snoozed")}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground/70 hover:bg-surface"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

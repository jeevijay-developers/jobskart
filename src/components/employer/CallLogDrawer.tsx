import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Phone, PhoneCall, PhoneOff, Unlock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { unlockCandidateContact } from "@/lib/credits.functions";
import {
  CALL_OUTCOMES,
  getCalls,
  getOutcomeBadgeClass,
  logCall,
  mapCrmError,
} from "@/lib/crm.functions";

type CallRow = {
  id: string;
  outcome: string;
  notes: string | null;
  duration_sec: number | null;
  created_at: string;
};

export function CallLogDrawer({
  open,
  onOpenChange,
  companyId,
  candidateId,
  candidateName,
  applicationId,
  jobId,
  source,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  candidateId: string;
  candidateName: string | null;
  applicationId?: string | null;
  jobId?: string | null;
  /** CRM lead source: "application" | "unlock" | "both" (omit on applicant pages). */
  source?: string | null;
  onLogged?: () => void;
}) {
  const log = useServerFn(logCall);
  const fetchCalls = useServerFn(getCalls);
  const unlock = useServerFn(unlockCandidateContact);

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobile, setMobile] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const loadCalls = async () => {
    setLoadingCalls(true);
    try {
      const rows = await fetchCalls({ data: { companyId, candidateId } });
      setCalls(rows as CallRow[]);
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't load calls"));
    } finally {
      setLoadingCalls(false);
    }
  };

  // Applicant contact: readable through the application relation when this
  // candidate applied to one of our jobs (same path the applicants page uses).
  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setNotes("");
    setFollowUpAt("");
    setMobile(null);
    loadCalls();

    // 1. Applicant: fetch mobile via the application → profile join.
    if (jobId) {
      supabase
        .from("applications")
        .select("profiles!candidate_id (mobile)")
        .eq("job_id", jobId)
        .eq("candidate_id", candidateId)
        .maybeSingle()
        .then(({ data }) => {
          const m = (data as { profiles: { mobile: string | null } | null } | null)?.profiles?.mobile;
          if (m) setMobile(m);
        });
    } else if (source === "unlock" || source === "both") {
      // 2. Unlocked lead with no job context (e.g. legacy unlock rows from
      //    before job_id was tracked): read back the contact this company
      //    already paid to unlock, via a masked-column RPC — never a direct
      //    profiles join, which RLS wouldn't allow for a non-applicant anyway.
      supabase
        .rpc("get_unlocked_candidate_contact", {
          _company_id: companyId,
          _candidate_user_id: candidateId,
        })
        .then(({ data }) => {
          const m = (data as Array<{ mobile: string | null }> | null)?.[0]?.mobile;
          if (m) setMobile(m);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidateId, jobId, source]);

  const revealContact = async () => {
    if (!jobId) return;
    setRevealing(true);
    try {
      const r = await unlock({
        data: { companyId, jobId, candidateUserId: candidateId },
      });
      if (r.contact?.mobile) setMobile(r.contact.mobile);
      if (!r.alreadyUnlocked) toast.success("Contact unlocked.");
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Unlock failed"));
    } finally {
      setRevealing(false);
    }
  };

  const submit = async () => {
    if (!outcome) return;
    setSaving(true);
    try {
      const r = await log({
        data: {
          companyId,
          candidateId,
          outcome: outcome as never,
          applicationId: applicationId ?? undefined,
          jobId: jobId ?? undefined,
          notes: notes.trim() || undefined,
          followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
        },
      });
      toast.success(r.task_id ? "Call logged · follow-up scheduled" : "Call logged");
      setOutcome(null);
      setNotes("");
      setFollowUpAt("");
      await loadCalls();
      onLogged?.();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't log call"));
    } finally {
      setSaving(false);
    }
  };

  const outcomeMeta = (id: string) =>
    CALL_OUTCOMES.find((o) => o.id === id) ?? { label: id };

  const canReveal = !mobile && !!jobId && (source === "unlock" || source === "both" || !source);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-primary" /> Log a call
          </SheetTitle>
          <SheetDescription>{candidateName ?? "Candidate"}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* Contact */}
          <div className="rounded-xl border border-border bg-surface/60 p-3">
            {mobile ? (
              <a
                href={`tel:${mobile}`}
                className="flex items-center justify-between gap-2 text-sm font-semibold text-primary hover:underline"
              >
                <span className="flex items-center gap-2">
                  <Phone className="h-4 w-4" /> {mobile}
                </span>
                <span className="text-xs font-medium text-muted-foreground">Tap to call</span>
              </a>
            ) : canReveal ? (
              <button
                type="button"
                onClick={revealContact}
                disabled={revealing}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
              >
                <Unlock className="h-4 w-4" />
                {revealing ? "Unlocking…" : "Reveal contact"}
              </button>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <PhoneOff className="h-3.5 w-3.5" />
                Contact details aren't available for this lead yet.
              </p>
            )}
          </div>

          {/* Outcome picker */}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Call outcome</p>
            <div className="grid grid-cols-2 gap-2">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOutcome(o.id)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                    outcome === o.id
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-card text-foreground/80 hover:bg-surface"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Notes <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What did you discuss?"
              className="form-input w-full resize-none text-sm"
            />
          </div>

          {/* Follow-up */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Follow-up at <span className="font-normal">(optional — some outcomes auto-schedule one)</span>
            </label>
            <input
              type="datetime-local"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              className="form-input h-10 w-full text-sm"
            />
          </div>

          <button
            onClick={submit}
            disabled={!outcome || saving}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
          >
            <PhoneCall className="h-4 w-4" />
            {saving ? "Logging…" : "Log call"}
          </button>

          {/* Timeline */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Call history
            </p>
            {loadingCalls ? (
              <div className="h-16 animate-pulse rounded-lg bg-surface" />
            ) : calls.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No calls logged yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {calls.map((c) => {
                  const meta = outcomeMeta(c.outcome);
                  return (
                    <li key={c.id} className="rounded-lg border border-border bg-card p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getOutcomeBadgeClass(c.outcome)}`}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      {c.notes && <p className="mt-1.5 text-xs text-muted-foreground">{c.notes}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

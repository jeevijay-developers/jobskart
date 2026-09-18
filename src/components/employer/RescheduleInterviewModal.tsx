import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { rescheduleInterview } from "@/lib/interview.functions";
import { minIstDate, TIME_OPTIONS } from "@/lib/interview-schedule-picker";

const DURATIONS = [15, 30, 45, 60, 90];

function mapRescheduleError(message: string): string {
  if (message.includes("interview_must_be_tomorrow_or_later")) {
    return "The new time must be tomorrow (IST) or later.";
  }
  if (message.includes("host_slot_conflict")) {
    return "That time is already booked for a video interview — try a different slot.";
  }
  if (message.includes("interview_not_reschedulable")) {
    return "This interview has already been cancelled or completed.";
  }
  return message;
}

export function RescheduleInterviewModal({
  open,
  onOpenChange,
  companyId,
  interviewId,
  currentDurationMin,
  onRescheduled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  interviewId: string;
  currentDurationMin: number;
  onRescheduled?: () => void;
}) {
  const runReschedule = useServerFn(rescheduleInterview);

  const [date, setDate] = useState(minIstDate());
  const [time, setTime] = useState("10:00");
  const [durationMin, setDurationMin] = useState(currentDurationMin);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(minIstDate());
    setTime("10:00");
    setDurationMin(currentDurationMin);
    setNotes("");
  }, [open, currentDurationMin]);

  const submit = async () => {
    if (!date || !time) return toast.error("Pick a new date and time");
    const newScheduledAt = new Date(`${date}T${time}:00+05:30`);
    setBusy(true);
    try {
      await runReschedule({
        data: {
          companyId,
          interviewId,
          newScheduledAt: newScheduledAt.toISOString(),
          newDurationMin: durationMin,
          notes: notes.trim() || undefined,
        },
      });
      toast.success("Interview rescheduled");
      onOpenChange(false);
      onRescheduled?.();
    } catch (e) {
      toast.error(mapRescheduleError(e instanceof Error ? e.message : "Couldn't reschedule"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule interview</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                New date (IST)
              </label>
              <Input
                type="date"
                min={minIstDate()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                New time (IST)
              </label>
              <ThemedSelect
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </ThemedSelect>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">
              Duration
            </label>
            <ThemedSelect
              value={String(durationMin)}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </ThemedSelect>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">
              Reason (optional)
            </label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Let the candidate know why it moved"
            />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "Rescheduling…" : "Confirm new time"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

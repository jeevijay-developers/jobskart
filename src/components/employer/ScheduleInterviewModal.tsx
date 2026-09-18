import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Video, Link2 } from "lucide-react";
import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { scheduleInterview } from "@/lib/interview.functions";
import { minIstDate, TIME_OPTIONS } from "@/lib/interview-schedule-picker";

type Provider = "jobskart_zoom" | "external_link";
type Mode = "video" | "phone" | "onsite";

const DURATIONS = [15, 30, 45, 60, 90];

function mapScheduleError(message: string): string {
  if (message.includes("verification_required_for_video_interview")) {
    return "Verify your business (GST/PAN) to use JobsKart video interviews — you can still share an external meeting link in the meantime.";
  }
  if (message.includes("employer_flagged_spam")) {
    return "Your account is under review right now, so scheduling is paused. Contact support if this seems wrong.";
  }
  if (message.includes("interview_must_be_tomorrow_or_later")) {
    return "Interviews must start tomorrow (IST) or later.";
  }
  if (message.includes("host_slot_conflict")) {
    return "That time is already booked for a video interview — try a different slot.";
  }
  if (message.includes("application_not_eligible_for_interview")) {
    return "This application has been withdrawn or rejected and can't be scheduled for interview.";
  }
  if (message.includes("zoom_not_configured")) {
    return "Platform video interviews aren't set up yet — please use an external meeting link.";
  }
  return message;
}

export function ScheduleInterviewModal({
  open,
  onOpenChange,
  companyId,
  applicationId,
  candidateName,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companyId: string;
  applicationId: string;
  candidateName?: string | null;
  onScheduled?: () => void;
}) {
  const runSchedule = useServerFn(scheduleInterview);

  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [date, setDate] = useState(minIstDate());
  const [time, setTime] = useState("10:00");
  const [durationMin, setDurationMin] = useState(30);
  const [provider, setProvider] = useState<Provider>("external_link");
  const [mode, setMode] = useState<Mode>("video");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(minIstDate());
    setTime("10:00");
    setDurationMin(30);
    setMeetingUrl("");
    setLocation("");
    setNotes("");
    setVerificationStatus(null);

    supabase
      .from("companies")
      .select("verification_status")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        const status = data?.verification_status ?? "unverified";
        setVerificationStatus(status);
        setProvider(status === "verified" ? "jobskart_zoom" : "external_link");
        setMode("video");
      });
  }, [open, companyId]);

  const zoomAvailable = verificationStatus === "verified";

  const submit = async () => {
    if (!date || !time) return toast.error("Pick a date and time");
    if (provider === "external_link" && mode === "onsite" && !location.trim()) {
      return toast.error("Add the interview address");
    }
    if (provider === "external_link" && mode === "video" && !meetingUrl.trim()) {
      return toast.error("Add a meeting link");
    }

    const scheduledAt = new Date(`${date}T${time}:00+05:30`);
    setBusy(true);
    try {
      await runSchedule({
        data: {
          companyId,
          applicationId,
          scheduledAt: scheduledAt.toISOString(),
          durationMin,
          provider,
          mode: provider === "jobskart_zoom" ? "video" : mode,
          location: mode === "onsite" ? location.trim() : undefined,
          meetingUrl:
            provider === "external_link" && mode === "video" ? meetingUrl.trim() : undefined,
          notes: notes.trim() || undefined,
        },
      });
      toast.success("Interview scheduled");
      onOpenChange(false);
      onScheduled?.();
    } catch (e) {
      toast.error(
        mapScheduleError(e instanceof Error ? e.message : "Couldn't schedule the interview"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Schedule interview{candidateName ? ` with ${candidateName}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Date (IST)
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
                Time (IST)
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
              Interview type
            </label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!zoomAvailable}
                onClick={() => {
                  setProvider("jobskart_zoom");
                  setMode("video");
                }}
                className={`flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                  provider === "jobskart_zoom"
                    ? "border-primary bg-primary-light"
                    : "border-border bg-card hover:bg-surface"
                } ${!zoomAvailable ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block font-semibold">JobsKart Video (Recommended)</span>
                  <span className="block text-xs text-muted-foreground">
                    {zoomAvailable
                      ? "In-app, time-gated, no raw link shared."
                      : "Requires business verification (GST/PAN)."}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setProvider("external_link")}
                className={`flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                  provider === "external_link"
                    ? "border-primary bg-primary-light"
                    : "border-border bg-card hover:bg-surface"
                }`}
              >
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block font-semibold">External link</span>
                  <span className="block text-xs text-muted-foreground">
                    Google Meet, Teams, phone, or in person.
                  </span>
                </span>
              </button>
            </div>
          </div>

          {provider === "external_link" && (
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Mode</label>
              <ThemedSelect
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="video">Video call</option>
                <option value="phone">Phone</option>
                <option value="onsite">In person</option>
              </ThemedSelect>
            </div>
          )}

          {provider === "external_link" && mode === "onsite" && (
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Address
              </label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Office address"
              />
            </div>
          )}

          {provider === "external_link" && mode === "video" && (
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Meeting link
              </label>
              <Input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/…"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">
              Notes (optional)
            </label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What should the candidate prepare?"
            />
          </div>

          <Button
            onClick={submit}
            disabled={busy || verificationStatus === null}
            className="w-full"
          >
            {busy ? "Scheduling…" : "Schedule interview"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

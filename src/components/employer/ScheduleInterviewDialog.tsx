import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export function ScheduleInterviewDialog({
  open, onOpenChange, applicationId, jobId, candidateId, companyId, onScheduled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  applicationId: string; jobId: string; candidateId: string; companyId: string;
  onScheduled?: () => void;
}) {
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState("online");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!when) return toast.error("Pick a date & time");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("interviews").insert({
      application_id: applicationId, job_id: jobId, candidate_id: candidateId,
      company_id: companyId, scheduled_by: u.user?.id,
      scheduled_at: new Date(when).toISOString(),
      mode, location: location || null, meeting_url: url || null, notes: notes || null,
      status: "scheduled",
    } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Interview scheduled");
    onOpenChange(false);
    onScheduled?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule interview</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Date & time</label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="online">Online</option>
              <option value="phone">Phone</option>
              <option value="in_person">In person</option>
              <option value="walk_in">Walk-in</option>
            </select>
          </div>
          {(mode === "in_person" || mode === "walk_in") && (
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Address</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Office address" />
            </div>
          )}
          {mode === "online" && (
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Meeting link</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://meet.google.com/…" />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Notes (optional)</label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What should the candidate prepare?" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full">{busy ? "Scheduling…" : "Schedule interview"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

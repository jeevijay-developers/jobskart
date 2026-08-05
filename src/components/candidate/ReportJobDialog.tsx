import { useState } from "react";
import { CheckCircle2, Loader2, Flag } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";

const REASONS = [
  { value: "fake_job", label: "Looks like a fake or scam job" },
  { value: "misleading", label: "Misleading job description or salary" },
  { value: "asking_money", label: "Employer is asking for money" },
  { value: "spam", label: "Spam or duplicate post" },
  { value: "wrong_category", label: "Wrong category or location" },
  { value: "offensive", label: "Offensive or inappropriate content" },
  { value: "other", label: "Other" },
];

export function ReportJobDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setReason("");
    setDetails("");
    setDone(false);
  };

  const handleSubmit = async () => {
    if (!reason) {
      toast.error("Please select a reason");
      return;
    }
    if (reason === "other" && details.trim().length < 10) {
      toast.error("Please describe the issue (at least 10 characters)");
      return;
    }
    if (details.length > 1000) {
      toast.error("Details must be under 1000 characters");
      return;
    }

    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        toast.error("Please sign in to report a job.");
        setSubmitting(false);
        return;
      }
      const { error } = await supabase.from("job_reports").insert({
        job_id: jobId,
        reporter_id: userData.user.id,
        reason,
        details: details.trim() || null,
      });
      if (error) throw error;
      setDone(true);
      toast.success("Report submitted. Thanks for keeping JobsKart safe.");
    } catch (err) {
      console.error(err);
      toast.error("Could not submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="max-w-lg">
        {done ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Report received</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Our trust &amp; safety team will review this job within 24 hours. You may be contacted for more details.
              </p>
            </div>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Flag className="h-5 w-5 text-destructive" /> Report this job
              </DialogTitle>
              <DialogDescription>
                Help us keep JobsKart safe. Tell us what&apos;s wrong with this listing.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <Label className="text-sm font-medium">Reason</Label>
                <RadioGroup value={reason} onValueChange={setReason} className="mt-2 space-y-2">
                  {REASONS.map((r) => (
                    <label
                      key={r.value}
                      htmlFor={`reason-${r.value}`}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm transition hover:border-primary/40 hover:bg-primary/5 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value={r.value} id={`reason-${r.value}`} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              <div>
                <Label htmlFor="details" className="text-sm font-medium">
                  Additional details {reason === "other" ? "" : <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Textarea
                  id="details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Share any context that helps us investigate (links, screenshots descriptions, what happened…)"
                  rows={4}
                  maxLength={1000}
                  className="mt-1.5"
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">{details.length}/1000</p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !reason} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {submitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  "Submit report"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestAccountDeletionOtp, deleteAccountWithOtp } from "@/lib/candidate.functions";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * "Delete account?" flow for the candidate Settings page. Step 1 sends an OTP to the candidate's
 * registered mobile (server reads it from their profile); step 2 takes the 6-digit OTP and, once
 * verified server-side, permanently deletes the account. While the SMS integration is pending the
 * server runs in test mode (any 6-digit code works) — see ACCOUNT_DELETION_OTP_MODE.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  mobile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobile: string | null;
}) {
  const navigate = useNavigate();
  const requestOtp = useServerFn(requestAccountDeletionOtp);
  const deleteWithOtp = useServerFn(deleteAccountWithOtp);
  const [step, setStep] = useState<"confirm" | "otp">("confirm");
  const [info, setInfo] = useState<{ mode: "sms" | "bypass"; maskedMobile: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setStep("confirm");
      setOtp("");
      setInfo(null);
    }
    onOpenChange(next);
  };

  const sendOtp = async () => {
    setBusy(true);
    try {
      const res = await requestOtp();
      setInfo(res);
      setOtp("");
      setStep("otp");
      toast.success(
        res.mode === "sms"
          ? "OTP sent to your registered mobile."
          : "Enter any 6-digit OTP to continue.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send the OTP.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteWithOtp({ data: { otp } });
      await supabase.auth.signOut().catch(() => {});
      toast.success("Your account has been deleted.");
      onOpenChange(false);
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={reset}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your profile, applications, saved jobs, and resume. This cannot
            be undone.
            {step === "confirm" && mobile ? (
              <> We'll text a one-time password (OTP) to your registered mobile number.</>
            ) : null}
            {step === "otp" && info ? (
              <>
                {" "}
                {info.mode === "sms" ? (
                  <>
                    Enter the 6-digit OTP sent to <strong>{info.maskedMobile}</strong>.
                  </>
                ) : (
                  <>OTP verification is in test mode for now: enter any 6-digit code.</>
                )}
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!mobile ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Add a mobile number to your profile before deleting your account.{" "}
            <Link to="/candidate/profile" className="font-semibold text-primary hover:underline">
              Go to Profile
            </Link>
          </div>
        ) : null}

        {step === "otp" ? (
          <div className="space-y-2">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-lg tracking-[0.4em]"
              disabled={busy}
            />
            <button
              type="button"
              onClick={sendOtp}
              disabled={busy}
              className="text-xs font-semibold text-primary hover:underline disabled:opacity-60"
            >
              Resend OTP
            </button>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {step === "confirm" ? (
            <button
              type="button"
              onClick={sendOtp}
              disabled={busy || !mobile}
              className="inline-flex h-10 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send OTP
            </button>
          ) : (
            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy || otp.length !== 6}
              className="inline-flex h-10 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete account
            </button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

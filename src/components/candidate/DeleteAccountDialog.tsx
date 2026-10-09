import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * "Delete account?" confirmation for the candidate Settings page. Unlike
 * SignOutDialog, confirming here does NOT delete anything immediately — it
 * only requests a verification email (request_account_deletion RPC +
 * send-account-deletion-email edge function). The actual deletion happens
 * when the candidate clicks the link in that email
 * (src/routes/delete-account.$token.tsx).
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
}) {
  const [sending, setSending] = useState(false);

  const handleRequestDeletion = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("request_account_deletion" as never).single();
      if (error) throw error;
      const { id } = data as unknown as { id: string; token: string };

      const { error: sendError } = await supabase.functions.invoke("send-account-deletion-email", {
        body: { requestId: id },
      });
      if (sendError) throw sendError;

      toast.success("Check your email to confirm account deletion.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send the confirmation email.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your profile, applications, saved jobs, and resume. This cannot
            be undone.
            {email ? (
              <>
                {" "}
                We'll email a confirmation link to <strong>{email}</strong> — your account is only
                deleted after you click it.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!email ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Add an email to your profile before deleting your account.{" "}
            <Link to="/candidate/profile" className="font-semibold text-primary hover:underline">
              Go to Profile
            </Link>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRequestDeletion}
            disabled={sending || !email}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send confirmation email
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

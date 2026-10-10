import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { supabase } from "@/integrations/supabase/client";
import { confirmAccountDeletion } from "@/lib/candidate.functions";

export const Route = createFileRoute("/delete-account/$token")({
  head: () => ({ meta: [{ title: "Confirm account deletion · JobsKart" }] }),
  component: DeleteAccountPage,
});

type DeletionRequest = { expires_at: string; confirmed_at: string | null };

function DeleteAccountPage() {
  const { token } = Route.useParams();
  const [req, setReq] = useState<DeletionRequest | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc(
        "get_account_deletion_request_by_token" as never,
        { _token: token } as never,
      );
      const row = (data as unknown as DeletionRequest[] | null)?.[0] ?? null;
      setReq(row);
    })();
  }, [token]);

  const expired = req ? new Date(req.expires_at) < new Date() : false;

  const confirmDeletion = async () => {
    setDeleting(true);
    try {
      await confirmAccountDeletion({ data: { token } });
      await supabase.auth.signOut().catch(() => {});
      setDone(true);
      toast.success("Your account has been deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete your account.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          {done ? (
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary-light text-primary">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="mt-4 text-xl font-bold">Account deleted</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your JobsKart account and data have been permanently deleted.
              </p>
              <Link
                to="/"
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
              >
                Back to home
              </Link>
            </div>
          ) : req === undefined ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : !req ? (
            <p className="text-center text-sm text-muted-foreground">
              This link is invalid. If you requested account deletion, send yourself a fresh link
              from Settings.
            </p>
          ) : req.confirmed_at ? (
            <p className="text-center text-sm text-muted-foreground">
              This link has already been used.
            </p>
          ) : expired ? (
            <p className="text-center text-sm text-destructive">
              This link has expired. Request a new one from Settings.
            </p>
          ) : (
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h1 className="mt-4 text-xl font-bold">Delete your account?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This permanently deletes your profile, applications, saved jobs, resume and
                documents. This cannot be undone.
              </p>
              <button
                onClick={confirmDeletion}
                disabled={deleting}
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? "Deleting…" : "Permanently delete my account"}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

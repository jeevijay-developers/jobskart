import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "You're invited · JobsKart" }] }),
  component: InvitePage,
});

type Invite = { id: string; company_id: string; company_name: string; email: string; role: string; expires_at: string; accepted_at: string | null };

function InvitePage() {
  const { token } = Route.useParams();
  const nav = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<boolean>(false);
  const [accepting, setAccepting] = useState(false);
  // Guards the auto-accept effect so it fires at most once per page visit,
  // even though `invite`/`auth` can each update independently after load.
  const [autoAcceptTried, setAutoAcceptTried] = useState(false);

  useEffect(() => {
    (async () => {
      const [iRes, uRes] = await Promise.all([
        supabase.rpc("get_invite_by_token", { _token: token }),
        supabase.auth.getUser(),
      ]);
      const row = (iRes.data as unknown as Invite[] | null)?.[0] ?? null;
      setInvite(row);
      setAuth(!!uRes.data.user);
      setLoading(false);
    })();
  }, [token]);

  const accept = async () => {
    setAccepting(true);
    const { error } = await supabase.rpc("accept_invite", { _token: token });
    setAccepting(false);
    if (error) return toast.error(error.message);
    toast.success(`Joined ${invite?.company_name}!`);
    nav({ to: "/employer/dashboard" });
  };

  // Arriving here already authenticated (the common case: bounced back from
  // /auth after verifying mobile+OTP, with this page's own URL as the
  // `redirect` target) should join the company immediately, not make the
  // person click Accept again on a page they were already sent to accept.
  useEffect(() => {
    if (loading || autoAcceptTried || accepting) return;
    if (auth && invite && !invite.accepted_at && new Date(invite.expires_at) >= new Date()) {
      setAutoAcceptTried(true);
      accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, auth, invite, autoAcceptTried, accepting]);

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          {loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : !invite ? (
            <p className="text-center text-sm text-muted-foreground">Invite not found or revoked.</p>
          ) : invite.accepted_at ? (
            <p className="text-center text-sm text-muted-foreground">This invite was already used.</p>
          ) : new Date(invite.expires_at) < new Date() ? (
            <p className="text-center text-sm text-destructive">This invite has expired.</p>
          ) : (
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary-light text-primary">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h1 className="mt-4 text-xl font-bold">You're invited to join</h1>
              <p className="mt-1 text-2xl font-bold text-primary">{invite.company_name}</p>
              <p className="mt-2 text-sm text-muted-foreground">Role: <span className="font-semibold">{invite.role.replace("_", " ")}</span></p>
              <p className="text-sm text-muted-foreground">Invited email: <span className="font-medium">{invite.email}</span></p>

              {auth ? (
                <button onClick={accept} disabled={accepting} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60">
                  {accepting && <Loader2 className="h-4 w-4 animate-spin" />} {accepting ? "Joining…" : "Accept invitation"}
                </button>
              ) : (
                <Link
                  to="/auth"
                  search={{ tab: "employer", redirect: `/invite/${token}` }}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
                >
                  <Smartphone className="h-4 w-4" /> Continue with mobile number
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

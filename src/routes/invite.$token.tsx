import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
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
                  {accepting && <Loader2 className="h-4 w-4 animate-spin" />} Accept invitation
                </button>
              ) : (
                <div className="mt-6 space-y-2">
                  <Link to="/auth" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
                    Sign in to accept
                  </Link>
                  <Link to="/signup/employer" className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-semibold">
                    Create an account
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

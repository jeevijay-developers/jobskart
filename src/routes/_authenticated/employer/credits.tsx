import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Coins, CreditCard, Loader2, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";
import {
  createRazorpayOrder,
  getCompanyWallet,
  listCreditPacks,
  verifyRazorpayPayment,
} from "@/lib/credits.functions";

export const Route = createFileRoute("/_authenticated/employer/credits")({
  head: () => ({ meta: [{ title: "Credits & usage · JobsKart Employer" }] }),
  component: CreditsPage,
});

type Pack = { id: string; name: string; credits: number; price_inr: number; badge: string | null };
type Txn = {
  id: string;
  kind: string;
  delta: number;
  balance_after: number;
  reference: unknown;
  created_at: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function CreditsPage() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const ms = await fetchMyCompanies(u.user.id);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      setActive(chosen);
      const p = await listCreditPacks();
      setPacks(p as Pack[]);
      if (chosen) {
        const w = await getCompanyWallet({ data: { companyId: chosen.company_id } });
        setBalance(w.balance);
        setTxns(w.transactions as Txn[]);
      }
      setLoading(false);
    })();
  }, []);

  const refreshWallet = async (cid: string) => {
    const w = await getCompanyWallet({ data: { companyId: cid } });
    setBalance(w.balance);
    setTxns(w.transactions as Txn[]);
  };

  const handleBuy = async (pack: Pack) => {
    if (!active) return;
    setBuyingId(pack.id);
    try {
      const order = await createRazorpayOrder({
        data: { companyId: active.company_id, packId: pack.id },
      });
      if (typeof window === "undefined" || !window.Razorpay) {
        toast.error("Checkout not loaded yet. Refresh and try again.");
        return;
      }
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "JobsKart",
        description: `${pack.name} — ${pack.credits} credits`,
        theme: { color: "#1A55BD" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const r = await verifyRazorpayPayment({
              data: {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
            });
            toast.success(`+${pack.credits} credits added · balance ${r.balance}`);
            await refreshWallet(active.company_id);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed.");
          }
        },
        modal: { ondismiss: () => setBuyingId(null) },
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setBuyingId(null);
    }
  };

  if (loading) {
    return (
      <EmployerShell title="Credits & usage">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </EmployerShell>
    );
  }

  if (!active) {
    return (
      <EmployerShell title="Credits & usage">
        <p className="text-sm text-muted-foreground">Set up a company first to buy credits.</p>
      </EmployerShell>
    );
  }

  return (
    <EmployerShell
      title="Credits & usage"
      subtitle="Buy credits to unlock candidate contacts from the database."
    >
      {/* Balance hero */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-primary-dark p-6 text-primary-foreground shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">
                <Coins className="h-3.5 w-3.5" /> Available credits
              </p>
              <p className="mt-3 text-5xl font-black tabular-nums">{balance.toLocaleString("en-IN")}</p>
              <p className="mt-2 text-sm text-primary-foreground/80">
                1 credit = 1 candidate contact unlock.
              </p>
            </div>
            <div className="hidden h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/10 sm:grid">
              <Coins className="h-8 w-8" />
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> This month
          </p>
          <p className="mt-3 text-3xl font-bold text-foreground tabular-nums">
            {txns.filter((t) => t.kind === "unlock").reduce((a, b) => a + Math.abs(b.delta), 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Unlocks used</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-1 text-xs font-semibold text-success">
            <ShieldCheck className="h-3.5 w-3.5" /> Secured by Razorpay
          </div>
        </div>
      </div>

      {/* Packs */}
      <section className="mt-8">
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Buy credits</h2>
            <p className="text-sm text-muted-foreground">All packs are billed in INR. GST extra at checkout.</p>
          </div>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {packs.map((p) => (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md ${
                p.badge ? "border-primary/40 ring-1 ring-primary/10" : "border-border"
              }`}
            >
              {p.badge && (
                <span className="absolute -top-2 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow">
                  <Sparkles className="h-3 w-3" /> {p.badge}
                </span>
              )}
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {p.name}
              </p>
              <p className="mt-2 text-3xl font-black text-foreground tabular-nums">
                {p.credits.toLocaleString("en-IN")}
                <span className="ml-1 text-sm font-semibold text-muted-foreground">credits</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                ₹{(p.price_inr / p.credits).toFixed(2)} per credit
              </p>
              <div className="mt-4 flex items-end justify-between">
                <p className="text-2xl font-bold text-foreground">
                  ₹{p.price_inr.toLocaleString("en-IN")}
                </p>
              </div>
              <button
                onClick={() => handleBuy(p)}
                disabled={buyingId === p.id}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
              >
                {buyingId === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" /> Buy now
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Transactions */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold text-foreground">Recent transactions</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {txns.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No transactions yet — buy your first credit pack above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(t.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground capitalize">{t.kind}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        t.delta >= 0 ? "text-success" : "text-foreground"
                      }`}
                    >
                      {t.delta >= 0 ? "+" : ""}
                      {t.delta}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                      {t.balance_after}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </EmployerShell>
  );
}

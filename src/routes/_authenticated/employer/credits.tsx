import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Check,
  Coins,
  CreditCard,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
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
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";
import { buildStoredInvoiceData, downloadInvoicePdf, GST_RATE } from "@/lib/invoice-pdf";
import { getCompanyEntitlements } from "@/lib/jobs.functions";
import {
  createRazorpayOrder,
  getCompanyWallet,
  listCompanyInvoices,
  listCreditPacks,
  reportRazorpayPaymentFailure,
  verifyRazorpayPayment,
} from "@/lib/credits.functions";
import {
  createPlanOrder,
  listPlans,
  switchToBasicPlan,
  verifyPlanPayment,
} from "@/lib/plans.functions";

// Display only — the charged amount is quoted server-side by create_credit_pack_order().
const withGst = (priceInr: number) => Math.round(priceInr * (1 + GST_RATE) * 100) / 100;
const formatInr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtLimit = (n: number) => (n === -1 ? "Unlimited" : n.toLocaleString("en-IN"));
// Section 5 of the monetization plan: "show expiry date ... for every
// purchased grant." Most current balances are legacy/no-expiry grants, so
// this reads plainly rather than implying urgency where there is none.
const expiryLabel = (nearest: string | null) =>
  nearest
    ? `Earliest expiry: ${new Date(nearest).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
    : "No expiry on current balance";

export const Route = createFileRoute("/_authenticated/employer/credits")({
  head: () => ({ meta: [{ title: "Credits & usage · JobsKart Employer" }] }),
  component: CreditsPage,
});

type BenefitType = "job_post" | "contact" | "boost";
type Pack = {
  id: string;
  name: string;
  credits: number;
  price_inr: number;
  badge: string | null;
  benefit_type: BenefitType;
};
const BENEFIT_LABELS: Record<BenefitType, string> = {
  job_post: "Job Post",
  contact: "Contact",
  boost: "Boost",
};
type PlanLimits = {
  live_jobs_max: number;
  classic_posts_per_month: number;
  classic_plus_enabled: boolean;
  trending_posts_per_month: number;
  repost_allowed: boolean;
  unlocks_per_job: number;
  response_retention_days: number;
  contact_credits_per_month: number;
  boost_credits_per_month: number;
};
type Plan = { id: string; name: string; price_inr: number; limits: PlanLimits };
type Entitlements = {
  plan_name: string;
  subscribed: boolean;
  plan_ends_at: string | null;
};
type Txn = {
  id: string;
  kind: string;
  delta: number;
  balance_after: number;
  reference: unknown;
  created_at: string;
  benefit_type: BenefitType;
};
type Invoice = {
  id: string;
  invoice_number: string;
  issue_date: string;
  line_items: unknown;
  subtotal_inr: number;
  cgst_inr: number;
  sgst_inr: number;
  igst_inr: number;
  total_inr: number;
  buyer_snapshot: unknown;
  payment_method: string;
  payment_reference: string | null;
  payment_status: string;
  status: string;
  source: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (
        event: "payment.failed",
        cb: (resp: {
          error?: { description?: string; reason?: string; metadata?: { order_id?: string; payment_id?: string } };
        }) => void,
      ) => void;
    };
  }
}

function CreditsPage() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobPostBalance, setJobPostBalance] = useState(0);
  const [contactBalance, setContactBalance] = useState(0);
  const [boostBalance, setBoostBalance] = useState(0);
  const [nearestExpiry, setNearestExpiry] = useState<Record<BenefitType, string | null>>({
    job_post: null,
    contact: null,
    boost: null,
  });
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnFilter, setTxnFilter] = useState<"all" | BenefitType>("all");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [boostCost, setBoostCost] = useState<number | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);
  const [downgrading, setDowngrading] = useState(false);
  const [downgradeConfirmOpen, setDowngradeConfirmOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("boost_settings")
      .select("cost_credits")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setBoostCost(data?.cost_credits ?? null));
  }, []);

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
      const pl = await listPlans();
      setPlans(pl as Plan[]);
      if (chosen) {
        const w = await getCompanyWallet({ data: { companyId: chosen.company_id } });
        setJobPostBalance(w.jobPostBalance);
        setContactBalance(w.contactBalance);
        setBoostBalance(w.boostBalance);
        setTxns(w.transactions as Txn[]);
        void refreshBenefitExpiry(chosen.company_id);
        try {
          const inv = await listCompanyInvoices({ data: { companyId: chosen.company_id } });
          setInvoices(inv as Invoice[]);
        } catch {
          setInvoices([]);
        }
        try {
          const ent = await getCompanyEntitlements({ data: { companyId: chosen.company_id } });
          setEntitlements(ent as unknown as Entitlements);
        } catch {
          setEntitlements(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const refreshBenefitExpiry = async (cid: string) => {
    const { data, error } = await supabase.rpc("company_benefit_balances", { _company_id: cid });
    if (error || !data) return;
    const next: Record<BenefitType, string | null> = { job_post: null, contact: null, boost: null };
    for (const row of data as Array<{ benefit_type: BenefitType; nearest_expiry: string | null }>) {
      next[row.benefit_type] = row.nearest_expiry;
    }
    setNearestExpiry(next);
  };

  const refreshEntitlements = async (cid: string) => {
    try {
      const ent = await getCompanyEntitlements({ data: { companyId: cid } });
      setEntitlements(ent as unknown as Entitlements);
    } catch {
      /* non-critical */
    }
  };

  const refreshWallet = async (cid: string) => {
    const w = await getCompanyWallet({ data: { companyId: cid } });
    setJobPostBalance(w.jobPostBalance);
    setContactBalance(w.contactBalance);
    setBoostBalance(w.boostBalance);
    setTxns(w.transactions as Txn[]);
    void refreshBenefitExpiry(cid);
    try {
      const inv = await listCompanyInvoices({ data: { companyId: cid } });
      setInvoices(inv as Invoice[]);
    } catch {
      /* invoices are non-critical */
    }
  };

  const handleDownloadInvoice = (inv: Invoice) => {
    try {
      downloadInvoicePdf(buildStoredInvoiceData(inv));
    } catch {
      toast.error("Could not open the invoice. Allow pop-ups and try again.");
    }
  };


  const handleBuy = async (pack: Pack) => {
    if (!active) return;
    if (typeof window === "undefined" || !window.Razorpay) {
      toast.error("Checkout not loaded yet. Refresh and try again.");
      return;
    }
    setBuyingId(pack.id);
    // The button stays busy while Checkout is open; it is released by the
    // success handler, dismissal, or an error starting checkout.
    try {
      const order = await createRazorpayOrder({
        data: { companyId: active.company_id, packId: pack.id },
      });
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "JobsKart",
        description: `${order.packName} — ${order.credits} credits (₹${formatInr(order.subtotalInr)} + ₹${formatInr(order.gstInr)} GST)`,
        prefill: order.prefill,
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
            toast.success(
              `+${order.credits} ${BENEFIT_LABELS[pack.benefit_type]} credits added · balance ${r.balance}`,
            );
            await refreshWallet(active.company_id);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed.");
          } finally {
            setBuyingId(null);
          }
        },
        modal: { ondismiss: () => setBuyingId(null) },
      });
      // Checkout stays open after a failure so the user can retry on the same order.
      rzp.on("payment.failed", (resp) => {
        toast.error(resp.error?.description || "Payment failed. Try another method.");
        void reportRazorpayPaymentFailure({
          data: {
            razorpayOrderId: resp.error?.metadata?.order_id ?? order.orderId,
            razorpayPaymentId: resp.error?.metadata?.payment_id,
            reason: [resp.error?.reason, resp.error?.description].filter(Boolean).join(": ") || undefined,
          },
        }).catch(() => {
          /* best-effort; the webhook records failures too */
        });
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout.");
      setBuyingId(null);
    }
  };

  const handleSubscribe = async (plan: Plan) => {
    if (!active) return;
    if (typeof window === "undefined" || !window.Razorpay) {
      toast.error("Checkout not loaded yet. Refresh and try again.");
      return;
    }
    setPlanBusyId(plan.id);
    try {
      const order = await createPlanOrder({
        data: { companyId: active.company_id, planId: plan.id },
      });
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "JobsKart",
        description: `${order.planName} Plan — 30 days (₹${formatInr(order.subtotalInr)} + ₹${formatInr(order.gstInr)} GST)`,
        prefill: order.prefill,
        theme: { color: "#1A55BD" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await verifyPlanPayment({
              data: {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
            });
            toast.success(`Switched to the ${order.planName} plan.`);
            await Promise.all([refreshWallet(active.company_id), refreshEntitlements(active.company_id)]);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed.");
          } finally {
            setPlanBusyId(null);
          }
        },
        modal: { ondismiss: () => setPlanBusyId(null) },
      });
      rzp.on("payment.failed", (resp) => {
        toast.error(resp.error?.description || "Payment failed. Try another method.");
        void reportRazorpayPaymentFailure({
          data: {
            razorpayOrderId: resp.error?.metadata?.order_id ?? order.orderId,
            razorpayPaymentId: resp.error?.metadata?.payment_id,
            reason: [resp.error?.reason, resp.error?.description].filter(Boolean).join(": ") || undefined,
          },
        }).catch(() => {
          /* best-effort; the webhook records failures too */
        });
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout.");
      setPlanBusyId(null);
    }
  };

  const handleSwitchToBasic = async () => {
    if (!active) return;
    setDowngrading(true);
    try {
      await switchToBasicPlan({ data: { companyId: active.company_id } });
      toast.success("Switched to the Basic plan.");
      await refreshEntitlements(active.company_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch plans.");
    } finally {
      setDowngrading(false);
      setDowngradeConfirmOpen(false);
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
      {/* Balance hero — three named balances, never a single generic "credits" number,
          so an employer always sees what a balance is for. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-primary-dark p-5 text-primary-foreground shadow-lg">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground/80">
            <Coins className="h-3.5 w-3.5" /> Job Post credits
          </p>
          <p className="mt-3 text-4xl font-black tabular-nums">{jobPostBalance.toLocaleString("en-IN")}</p>
          <p className="mt-2 text-xs text-primary-foreground/80">Spent posting Classic/Trending jobs beyond your plan quota.</p>
          <p className="mt-2 text-[11px] font-medium text-primary-foreground/70">
            {expiryLabel(nearestExpiry.job_post)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Coins className="h-3.5 w-3.5" /> Contact credits
          </p>
          <p className="mt-3 text-4xl font-black tabular-nums text-foreground">{contactBalance.toLocaleString("en-IN")}</p>
          <p className="mt-2 text-xs text-muted-foreground">Spent unlocking a candidate's contact once a job's free allowance runs out.</p>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground/80">
            {expiryLabel(nearestExpiry.contact)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Coins className="h-3.5 w-3.5" /> Boost credits
          </p>
          <p className="mt-3 text-4xl font-black tabular-nums text-foreground">{boostBalance.toLocaleString("en-IN")}</p>
          <p className="mt-2 text-xs text-muted-foreground">Spent boosting a job's ranking for 24 hours.</p>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground/80">
            {expiryLabel(nearestExpiry.boost)}
          </p>
        </div>
      </div>
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-1 text-xs font-semibold text-success">
        <ShieldCheck className="h-3.5 w-3.5" /> Secured by Razorpay
      </div>

      {/* Plans */}
      <section className="mt-8">
        <header className="mb-4">
          <h2 className="text-lg font-bold text-foreground">Your plan</h2>
          <p className="text-sm text-muted-foreground">
            Sets how many jobs you can keep live at once, monthly post quotas, and reposting.
            Prices in INR, exclusive of GST.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = entitlements?.plan_name === plan.name;
            const isFree = plan.price_inr <= 0;
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md ${
                  isCurrent ? "border-primary/40 ring-1 ring-primary/10" : "border-border"
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow">
                    <Check className="h-3 w-3" /> Current plan
                  </span>
                )}
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {plan.name}
                </p>
                <p className="mt-2 text-2xl font-black text-foreground">
                  {isFree ? "Free" : `₹${plan.price_inr.toLocaleString("en-IN")}`}
                  {!isFree && <span className="ml-1 text-sm font-semibold text-muted-foreground">/ 30 days + GST</span>}
                </p>
                {!isFree && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    ₹{formatInr(withGst(plan.price_inr))} incl. 18% GST
                  </p>
                )}
                <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                  <li>Live jobs at once: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.live_jobs_max)}</span></li>
                  <li>Job posts / month: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.classic_posts_per_month)}</span></li>
                  <li>Trending boosts / month: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.trending_posts_per_month)}</span></li>
                  <li>Reposting (Classic+): <span className="font-semibold text-foreground">{plan.limits.classic_plus_enabled ? "Yes" : "No"}</span></li>
                  <li>Contact credits / month: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.contact_credits_per_month)}</span></li>
                  <li>Boost credits / month: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.boost_credits_per_month)}</span></li>
                  <li>Response history: <span className="font-semibold text-foreground">{fmtLimit(plan.limits.response_retention_days)} days</span></li>
                </ul>
                {isCurrent && entitlements?.subscribed && entitlements.plan_ends_at && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Renews/expires on{" "}
                    {new Date(entitlements.plan_ends_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}.
                  </p>
                )}
                {isCurrent ? (
                  <button
                    disabled
                    className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-semibold text-muted-foreground"
                  >
                    Current plan
                  </button>
                ) : isFree ? (
                  <button
                    onClick={() => setDowngradeConfirmOpen(true)}
                    disabled={downgrading}
                    className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm font-semibold text-foreground hover:bg-background disabled:opacity-50"
                  >
                    {downgrading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Switch to Basic"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan)}
                    disabled={planBusyId !== null}
                    className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
                  >
                    {planBusyId === plan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4" /> Subscribe
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <AlertDialog open={downgradeConfirmOpen} onOpenChange={setDowngradeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to the Basic plan?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll immediately lose {entitlements?.plan_name ?? "your current plan"}'s limits for
              new job posts, boosts and candidate unlocks. Jobs that are already live stay live —
              this only affects what you can do going forward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current plan</AlertDialogCancel>
            <AlertDialogAction onClick={handleSwitchToBasic}>Switch to Basic</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Packs — grouped by benefit_type so a Boost Pack can never be
          mistaken for a Job Post pack. A group with no packs (e.g. before
          the Phase 2 catalogue seed lands) simply doesn't render. */}
      {(["job_post", "contact", "boost"] as const).map((bt) => {
        const group = packs.filter((p) => p.benefit_type === bt);
        if (group.length === 0) return null;
        return (
          <section key={bt} className="mt-8">
            <header className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">{BENEFIT_LABELS[bt]} Packs</h2>
                <p className="text-sm text-muted-foreground">
                  Prices in INR, exclusive of GST. 18% GST is added at checkout.
                  {bt === "boost" && boostCost != null && (
                    <> · Boosting a job costs {boostCost} credit{boostCost === 1 ? "" : "s"}.</>
                  )}
                </p>
              </div>
            </header>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {group.map((p) => (
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
                    <span className="ml-1 text-sm font-semibold text-muted-foreground">
                      {BENEFIT_LABELS[bt].toLowerCase()} credits
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    ₹{(p.price_inr / p.credits).toFixed(2)} per credit
                  </p>
                  <div className="mt-4">
                    <p className="text-2xl font-bold text-foreground">
                      ₹{p.price_inr.toLocaleString("en-IN")}
                      <span className="ml-1 text-sm font-semibold text-muted-foreground">+ GST</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      ₹{formatInr(withGst(p.price_inr))} incl. 18% GST
                    </p>
                  </div>
                  <button
                    onClick={() => handleBuy(p)}
                    disabled={buyingId !== null}
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
        );
      })}

      {/* Transactions */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 lg:flex-nowrap lg:justify-start lg:gap-4">
          <h2 className="text-lg font-bold text-foreground">Recent transactions</h2>
          <div className="inline-flex rounded-lg border border-border bg-card p-1 text-xs font-semibold">
            {(["all", "job_post", "contact", "boost"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTxnFilter(f)}
                className={`rounded-md px-3 py-1.5 transition ${
                  txnFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "All" : BENEFIT_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {(() => {
            const filtered = txnFilter === "all" ? txns : txns.filter((t) => t.benefit_type === txnFilter);
            if (filtered.length === 0) {
              return (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  No transactions yet — buy your first credit pack above.
                </p>
              );
            }
            return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Balance</th>
                    <th className="px-4 py-3 text-right">Change</th>
                    <th className="px-4 py-3 text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {new Date(t.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground capitalize">{t.kind}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{BENEFIT_LABELS[t.benefit_type]}</td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                          t.delta >= 0 ? "text-success" : "text-foreground"
                        }`}
                      >
                        {t.delta >= 0 ? "+" : ""}
                        {t.delta}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {t.balance_after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            );
          })()}
        </div>
      </section>

      {/* Invoices */}
      <section className="mt-8">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">Invoices</h2>
            <p className="text-sm text-muted-foreground">
              GST tax invoices are issued automatically for every successful payment.
            </p>
          </div>
        </header>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {invoices.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-muted-foreground">
                No invoices yet — your first invoice appears here right after a purchase.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {invoices.map((inv) => {
                const items = Array.isArray(inv.line_items)
                  ? (inv.line_items as Array<{ description?: string }>)
                  : [];
                return (
                  <li
                    key={inv.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{inv.invoice_number}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            inv.payment_status === "Paid"
                              ? "bg-success-light text-success"
                              : "bg-surface text-muted-foreground"
                          }`}
                        >
                          {inv.payment_status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {items[0]?.description ?? "Billing transaction"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(inv.issue_date).toLocaleDateString("en-IN", {
                          dateStyle: "medium",
                        })}
                        {" · "}
                        {inv.payment_method}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <p className="text-lg font-bold tabular-nums text-foreground">
                        ₹{Number(inv.total_inr).toLocaleString("en-IN")}
                      </p>
                      <button
                        onClick={() => handleDownloadInvoice(inv)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-surface"
                      >
                        <Download className="h-4 w-4" /> Download PDF
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </EmployerShell>
  );
}

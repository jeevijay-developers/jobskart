import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Rocket, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyBoost, getJobBoostHistory, mapBoostError, type BoostResult } from "@/lib/boost.functions";

type BoostJobModalProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: { id: string; title: string; createdAt: string };
  balance: number;
  /** False while `balance` is only the page's zero default (overview not loaded) — then the
   *  client can't know it's insufficient, so it must not block; apply_boost decides. */
  balanceKnown?: boolean;
  /** Remaining this-month plan allowance — null means unlimited, 0/positive is exact. */
  monthlyPoolRemaining: number | null;
  settings: { costCredits: number; windowHours: number; enabled: boolean };
  onBoosted: (result: BoostResult) => void;
};

// A job can't be boosted on the day it goes live (Same Day Restriction) —
// freshness already gives it top visibility that day, see feed_jobs().
function isSameIstDay(iso: string): boolean {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // en-CA -> YYYY-MM-DD
  return fmt(new Date(iso)) === fmt(new Date());
}

type HistoryRow = { id: string; starts_at: string; ends_at: string; credits_spent: number };

export function BoostJobModal({
  open,
  onOpenChange,
  job,
  balance,
  balanceKnown = true,
  monthlyPoolRemaining,
  settings,
  onBoosted,
}: BoostJobModalProps) {
  const runApplyBoost = useServerFn(applyBoost);
  const runGetHistory = useServerFn(getJobBoostHistory);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(1);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setHistory(null);
    runGetHistory({ data: { jobId: job.id } })
      .then((rows) => setHistory(rows as HistoryRow[]))
      .catch(() => setHistory([]));
  }, [open, job.id, runGetHistory]);

  const createdToday = isSameIstDay(job.createdAt);
  // A company can have plan pool capacity left even while its wallet
  // boost_balance reads 0 — don't block the button on wallet balance alone.
  const hasPoolLeft = monthlyPoolRemaining === null || monthlyPoolRemaining > 0;
  // Unlimited allowance covers any duration; a limited monthly allowance covers a 1-day boost only.
  const poolCovers = monthlyPoolRemaining === null || (days === 1 && hasPoolLeft);
  const totalCredits = settings.costCredits * days;
  const insufficientBalance = balanceKnown && balance < totalCredits && !poolCovers;
  const canBoost = settings.enabled && !createdToday && !insufficientBalance;
  const willUsePool = poolCovers;
  const daysLabel = `${days} day${days === 1 ? "" : "s"}`;

  const submit = async () => {
    setBusy(true);
    try {
      const result = await runApplyBoost({ data: { jobId: job.id, days } });
      toast.success(
        result.source === "monthly_pool"
          ? `"${job.title}" is boosted for ${daysLabel} — used your plan's monthly allowance, no credits spent.`
          : `"${job.title}" is boosted for ${daysLabel}.`,
      );
      onBoosted(result);
      onOpenChange(false);
    } catch (e) {
      toast.error(mapBoostError(e instanceof Error ? e.message : "Couldn't boost this job."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" /> Boost "{job.title}"
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration (days)</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {[1, 2, 3, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`h-9 min-w-9 rounded-lg border px-3 text-sm font-semibold ${days === d ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface"}`}
                >
                  {d}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  if (Number.isFinite(n)) setDays(Math.min(30, Math.max(1, n)));
                }}
                aria-label="Custom number of days"
                className="h-9 w-20 rounded-lg border border-input bg-card px-2 text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {settings.costCredits} credit{settings.costCredits === 1 ? "" : "s"} per day · 24 hours = 1 day · up to 30 days
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {willUsePool ? "Free · plan allowance" : `${totalCredits} credit${totalCredits === 1 ? "" : "s"}`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Window</p>
              <p className="mt-1 text-lg font-bold text-foreground">{daysLabel} of priority</p>
            </div>
            <div className="col-span-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {willUsePool ? "Monthly boost allowance left" : "Your boost credits"}
              </p>
              <p className={`mt-1 text-lg font-bold ${insufficientBalance ? "text-destructive" : "text-foreground"}`}>
                {willUsePool
                  ? monthlyPoolRemaining === null
                    ? "Unlimited"
                    : `${monthlyPoolRemaining} left this month`
                  : balanceKnown
                    ? `${balance} credit${balance === 1 ? "" : "s"}`
                    : "—"}
              </p>
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Strongest in the first hours, tapering off over the window — a newer or better-matching
            job can still outrank a decayed boost. This isn't a permanent pin to the top.
          </p>

          {createdToday && (
            <p className="rounded-lg bg-warning-light px-3 py-2 text-xs font-medium text-warning">
              New jobs already get top visibility today — boost unlocks tomorrow.
            </p>
          )}
          {!createdToday && insufficientBalance && (
            <div className="flex items-center justify-between rounded-lg bg-destructive-light px-3 py-2 text-xs font-medium text-destructive">
              <span>Not enough credits to boost this job.</span>
              <Link to="/employer/credits" className="font-semibold underline">
                Buy credits
              </Link>
            </div>
          )}
          {!settings.enabled && (
            <p className="rounded-lg bg-surface px-3 py-2 text-xs font-medium text-muted-foreground">
              Boosting is temporarily unavailable.
            </p>
          )}

          {history === null ? (
            <div className="h-10 animate-pulse rounded-lg bg-surface" />
          ) : history.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Boost history
              </p>
              <ul className="space-y-1.5">
                {history.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(h.starts_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>
                    <span>{h.credits_spent} credit{h.credits_spent === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button onClick={submit} disabled={busy || !canBoost} className="w-full">
            {busy
              ? "Boosting…"
              : willUsePool
                ? `Boost for ${daysLabel} · free`
                : `Boost for ${daysLabel} · ${totalCredits} credit${totalCredits === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

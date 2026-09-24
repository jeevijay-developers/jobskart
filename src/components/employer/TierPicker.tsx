import { Check, Flame, Repeat } from "lucide-react";
import type { JobTier } from "@/lib/jobs.functions";
import type { getCompanyEntitlements } from "@/lib/jobs.functions";

type Entitlements = Awaited<ReturnType<typeof getCompanyEntitlements>>;

type TierOption = {
  id: JobTier;
  label: string;
  blurb: string;
};

const TIERS: TierOption[] = [
  { id: "classic", label: "Classic", blurb: "Standard 30-day posting" },
  { id: "classic_plus", label: "Classic+", blurb: "Reusable posting for frequent hiring" },
  { id: "trending", label: "Trending", blurb: "Higher ranking + stronger visibility" },
];

// availability() never blocks a selection the server would actually accept —
// it's a preview only. Wallet balance (for the "no_credits" case) isn't part
// of get_company_entitlements(), so a Trending pick that turns out to be
// unaffordable is still caught server-side by activate_job_with_tier() and
// surfaced as a toast (mapTierError), same as any other publish failure.
function availability(tier: JobTier, ent: Entitlements | null): { blocked: boolean; note: string } {
  if (!ent) return { blocked: false, note: "" };
  const { limits, tier_prices, usage } = ent;
  if (tier === "classic") {
    if (limits.classic_posts_per_month === -1) return { blocked: false, note: "Unlimited on your plan" };
    const left = Math.max(0, limits.classic_posts_per_month - usage.classic_posts_this_month);
    if (left > 0) return { blocked: false, note: `${left} left this month on your plan` };
    return {
      blocked: false,
      note: tier_prices.classic > 0 ? `Plan quota used — ${tier_prices.classic} credits` : "Plan quota used — free",
    };
  }
  if (tier === "classic_plus") {
    if (!limits.classic_plus_enabled) return { blocked: true, note: "Unlimited plan only" };
    return { blocked: false, note: "Included in your plan" };
  }
  // trending
  if (limits.trending_posts_per_month === -1) return { blocked: false, note: "Unlimited on your plan" };
  const left = Math.max(0, limits.trending_posts_per_month - usage.trending_posts_this_month);
  if (left > 0) return { blocked: false, note: `${left} left this month on your plan` };
  return { blocked: false, note: `Plan quota used — ${tier_prices.trending} credits` };
}

export function TierPicker({
  tier,
  onChange,
  entitlements,
}: {
  tier: JobTier;
  onChange: (t: JobTier) => void;
  entitlements: Entitlements | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Job type</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Pick how this job posts. Trending gets priority placement.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {TIERS.map((opt) => {
          const { blocked, note } = availability(opt.id, entitlements);
          const selected = tier === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={blocked}
              onClick={() => onChange(opt.id)}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-surface"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {opt.id === "trending" && <Flame className="h-3.5 w-3.5 text-warning" />}
                {opt.id === "classic_plus" && <Repeat className="h-3.5 w-3.5 text-muted-foreground" />}
                {opt.label}
                {selected && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground">{opt.blurb}</span>
              {note && <span className="text-xs font-medium text-foreground">{note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

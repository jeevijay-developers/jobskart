import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import {
  getSalarySuggestion,
  logSalarySuggestionEvent,
  type SalarySuggestion,
} from "@/lib/salary.functions";
import { getRoleBenchmarks } from "@/lib/salary-benchmarks";

type SalarySuggestionCardProps = {
  title: string;
  category: string;
  city: string;
  experienceBucket: string;
  payType: string;
  minSalary: string;
  maxSalary: string;
  companyId: string | null;
  onUseRange: (
    min: number,
    max: number,
    extra?: { payType?: string; avgIncentive?: number },
  ) => void;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Market-based salary suggestion for the wizard's "Location & Pay" step
// (salary-recommendation-engine-implementation.md, Phase 3):
//   - debounced (500ms) fetch of the DB fallback ladder once title+city exist
//   - advisory only: renders nothing when there is no data, never blocks
//   - one-click "Use this range" fills min/max (+ incentive for the static
//     fallback's pay model)
//   - once the recruiter types their own numbers, the card switches to an
//     inline market check (below p25 → amber nudge, otherwise → green)
// When the DB ladder has no band for this role/city, falls back to the
// pre-existing client-side category benchmark, labelled "Market estimate".
export function SalarySuggestionCard({
  title,
  category,
  city,
  experienceBucket,
  payType,
  minSalary,
  maxSalary,
  companyId,
  onUseRange,
}: SalarySuggestionCardProps) {
  const runSuggest = useServerFn(getSalarySuggestion);
  const runLog = useServerFn(logSalarySuggestionEvent);
  const [suggestion, setSuggestion] = useState<SalarySuggestion | null>(null);
  const loggedKey = useRef<string | null>(null);

  const ready = title.trim().length >= 2 && city.trim().length > 0;

  useEffect(() => {
    if (!ready) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      runSuggest({
        data: {
          title: title.trim(),
          category: category || null,
          city: city.trim(),
          experienceBucket: experienceBucket || "any",
          payType: payType || "fixed",
        },
      })
        .then((s) => {
          if (!cancelled) setSuggestion(s ?? null);
        })
        .catch(() => {
          if (!cancelled) setSuggestion(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, title, category, city, experienceBucket, payType, runSuggest]);

  // Telemetry: one "shown" event per distinct suggestion (plan Phase 4).
  useEffect(() => {
    if (!suggestion || !companyId) return;
    const key = `${suggestion.title_key}|${city}|${suggestion.source}|${suggestion.scope}`;
    if (loggedKey.current === key) return;
    loggedKey.current = key;
    runLog({
      data: {
        companyId,
        kind: "salary_suggestion_shown",
        meta: {
          title,
          city,
          source: suggestion.source,
          scope: suggestion.scope,
          median: suggestion.median,
        },
      },
    }).catch(() => {});
  }, [suggestion, companyId, city, title, runLog]);

  if (!ready) return null;

  const hasOwnNumbers = Number(minSalary) > 0 || Number(maxSalary) > 0;
  const hasBothNumbers = Number(minSalary) > 0 && Number(maxSalary) > 0;

  // Inline market check once the recruiter typed their own range.
  if (suggestion && hasBothNumbers) {
    const belowMarket = Number(maxSalary) < suggestion.p25;
    return belowMarket ? (
      <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">
            Below market for {title.trim()} in {city}
          </p>
          <p className="mt-0.5 text-xs">
            Similar posts pay {inr(suggestion.p25)}–{inr(suggestion.p75)}/mo and get significantly
            more applications. Consider raising your range.
          </p>
          <button
            type="button"
            onClick={() => {
              onUseRange(suggestion.p25, suggestion.p75);
              if (companyId) {
                runLog({
                  data: {
                    companyId,
                    kind: "salary_suggestion_applied",
                    meta: { title, city, source: suggestion.source, via: "market_check" },
                  },
                }).catch(() => {});
              }
            }}
            className="mt-1.5 text-xs font-semibold underline-offset-2 hover:underline"
          >
            Use market range {inr(suggestion.p25)}–{inr(suggestion.p75)}
          </button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Competitive for this market — similar posts in {city} pay {inr(suggestion.p25)}–
        {inr(suggestion.p75)}/mo.
      </div>
    );
  }

  // Suggestion (before the recruiter commits to numbers).
  if (suggestion && !hasOwnNumbers) {
    const computed = suggestion.source === "computed";
    return (
      <div className="rounded-xl border border-primary/20 bg-primary-light/40 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-primary">
          <TrendingUp className="h-4 w-4" />
          Market range in {city}: {inr(suggestion.p25)} – {inr(suggestion.p75)}/mo
          <span className="text-xs font-normal text-muted-foreground">
            (median {inr(suggestion.median)})
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {computed
            ? `Based on ${suggestion.sample_count} similar jobs in ${city}${suggestion.confidence === "high" ? " · high confidence" : ""}`
            : "Market estimate for this role"}
        </p>
        <button
          type="button"
          onClick={() => {
            onUseRange(suggestion.p25, suggestion.p75);
            if (companyId) {
              runLog({
                data: {
                  companyId,
                  kind: "salary_suggestion_applied",
                  meta: { title, city, source: suggestion.source, via: "use_range" },
                },
              }).catch(() => {});
            }
          }}
          className="mt-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Use this range
        </button>
      </div>
    );
  }

  // No DB band → keep the pre-existing static category benchmark, but only
  // as the pre-fill hint (never as a "market check" — those numbers are not
  // real market data).
  if (!suggestion && !hasOwnNumbers && category) {
    const bm = getRoleBenchmarks(title, category, city);
    return (
      <div className="rounded-xl border border-primary/20 bg-primary-light/40 p-3 text-sm">
        <p className="text-primary">
          💡 Market rate in {city || "India"} for {title}: {inr(bm.minSalary)} – {inr(bm.maxSalary)}
          /mo
        </p>
        <button
          type="button"
          onClick={() =>
            onUseRange(bm.minSalary, bm.maxSalary, {
              payType: bm.incentiveModel,
              avgIncentive: bm.avgIncentive || undefined,
            })
          }
          className="mt-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Apply suggested salary
        </button>
      </div>
    );
  }

  return null;
}

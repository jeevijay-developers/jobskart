import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IndianRupee, Sparkles } from "lucide-react";
import { getSalarySuggestion, type SalarySuggestion } from "@/lib/salary.functions";
import { supabase } from "@/integrations/supabase/client";

export type SalaryChoiceKind = "chip" | "custom" | "flexible" | "undisclosed";

type Props = {
  candidateId: string | null;
  role: string;
  city: string;
  experienceStatus: "fresher" | "experienced" | "student";
  value: number | "";
  choiceKind: SalaryChoiceKind | null;
  onChange: (value: number | "", choiceKind: SalaryChoiceKind | null) => void;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function logEvent(candidateId: string | null, eventKey: string, context: Record<string, unknown>) {
  if (!candidateId) return;
  supabase
    .from("candidate_profile_events")
    .insert({ candidate_id: candidateId, event_key: eventKey, context } as never)
    .then(() => {}, () => {});
}

// Feature 4 of resume-linkedin-salary-education-onboarding-implementation-plan.md.
// Reuses the existing employer-side salary-band engine (get_salary_suggestion)
// read-only — no separate AI estimate is invented for candidates. Advisory
// only: renders neutral fallback options (never blocks onboarding) when no
// band exists for this role/city yet.
export function SalaryPicker({ candidateId, role, city, experienceStatus, value, choiceKind, onChange }: Props) {
  const runSuggest = useServerFn(getSalarySuggestion);
  const [suggestion, setSuggestion] = useState<SalarySuggestion | null>(null);
  const [customOpen, setCustomOpen] = useState(choiceKind === "custom");
  const [customValue, setCustomValue] = useState(typeof value === "number" ? String(value) : "");
  const loggedKey = useRef<string | null>(null);

  const ready = role.trim().length >= 2 && city.trim().length > 0;
  const experienceBucket = experienceStatus === "experienced" ? "experienced" : "fresher";

  useEffect(() => {
    if (!ready) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      runSuggest({
        data: { title: role.trim(), city: city.trim(), experienceBucket, payType: "fixed" },
      })
        .then((s) => {
          if (!cancelled) setSuggestion(s ?? null);
        })
        .catch(() => {
          if (!cancelled) setSuggestion(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, role, city, experienceBucket, runSuggest]);

  useEffect(() => {
    if (!suggestion) return;
    const key = `${suggestion.title_key}|${city}|${suggestion.scope}`;
    if (loggedKey.current === key) return;
    loggedKey.current = key;
    logEvent(candidateId, "salary_suggestion_shown", {
      role, city, scope: suggestion.scope, source: suggestion.source, median: suggestion.median,
    });
  }, [suggestion, candidateId, city, role]);

  const pick = (amount: number) => {
    setCustomOpen(false);
    onChange(amount, "chip");
    logEvent(candidateId, "salary_chip_selected", { amount, scope: suggestion?.scope ?? null });
  };

  const applyCustom = () => {
    const n = Number(customValue);
    if (!Number.isFinite(n) || n <= 0) return;
    onChange(n, "custom");
    logEvent(candidateId, "salary_custom_entered", { amount: n });
  };

  const pickFlexible = () => {
    setCustomOpen(false);
    onChange("", "flexible");
    logEvent(candidateId, "salary_flexible_selected", {});
  };

  const pickUndisclosed = () => {
    setCustomOpen(false);
    onChange("", "undisclosed");
    logEvent(candidateId, "salary_undisclosed_selected", {});
  };

  const chips = suggestion
    ? [
        { label: "Below range", amount: suggestion.min },
        { label: "Lower", amount: suggestion.p25 },
        { label: "Typical", amount: suggestion.median },
        { label: "Upper", amount: suggestion.p75 },
        { label: "Above range", amount: suggestion.max },
      ]
    : [];

  return (
    <div className="space-y-3">
      {ready && suggestion && (
        <p className="flex items-start gap-1.5 rounded-lg bg-primary-light/50 px-3 py-2 text-xs text-primary">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Typical monthly range for <strong>{role}</strong> in <strong>{city}</strong>:{" "}
            {inr(suggestion.p25)}–{inr(suggestion.p75)}
            {suggestion.source === "computed"
              ? ` (based on ${suggestion.sample_count} similar jobs${suggestion.confidence === "high" ? ", high confidence" : ""})`
              : " (market estimate)"}
            . Pick a range below, enter your own figure, or say you're flexible.
          </span>
        </p>
      )}
      {ready && !suggestion && (
        <p className="text-xs text-muted-foreground">
          We don't have enough market data for this role/city yet — enter your own amount or choose flexible/prefer not to say.
        </p>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const active = choiceKind === "chip" && value === Math.round(c.amount);
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => pick(Math.round(c.amount))}
                className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                  active ? "border-primary bg-primary-light text-primary" : "border-border bg-card text-foreground/80 hover:border-primary/40"
                }`}
              >
                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</span>
                {inr(c.amount)}/mo
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!customOpen ? (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              choiceKind === "custom" ? "border-primary bg-primary-light text-primary" : "border-border bg-card text-foreground/70 hover:border-primary/40"
            }`}
          >
            <IndianRupee className="h-3.5 w-3.5" /> Enter exact amount
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              autoFocus
              className="form-input h-9 w-32 text-sm"
              placeholder="e.g. 25000"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onBlur={applyCustom}
              onKeyDown={(e) => e.key === "Enter" && applyCustom()}
            />
            <span className="text-xs text-muted-foreground">/mo</span>
          </div>
        )}
        <button
          type="button"
          onClick={pickFlexible}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            choiceKind === "flexible" ? "border-primary bg-primary-light text-primary" : "border-border bg-card text-foreground/70 hover:border-primary/40"
          }`}
        >
          I'm flexible
        </button>
        <button
          type="button"
          onClick={pickUndisclosed}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
            choiceKind === "undisclosed" ? "border-primary bg-primary-light text-primary" : "border-border bg-card text-foreground/70 hover:border-primary/40"
          }`}
        >
          Prefer not to say
        </button>
      </div>

      {choiceKind && (
        <p className="text-xs font-medium text-foreground">
          {choiceKind === "flexible"
            ? "You've said you're flexible on salary."
            : choiceKind === "undisclosed"
              ? "You've chosen not to disclose an expected salary."
              : `Your expected monthly salary: ${typeof value === "number" ? inr(value) : "—"}`}
        </p>
      )}
    </div>
  );
}

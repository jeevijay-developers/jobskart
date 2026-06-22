import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Briefcase, Loader2, ShieldCheck, Target } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import logoAsset from "@/assets/jobskart-logo.png.asset.json";
import { Link } from "@tanstack/react-router";

export type WizardStep = {
  key: string;
  title: string;
  hint?: string;
  /** Returns null if valid, error message if not. */
  validate?: () => string | null;
  render: () => ReactNode;
};

interface Props {
  steps: WizardStep[];
  index: number;
  onIndex: (n: number) => void;
  onSubmit: () => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
  side?: "candidate" | "employer";
  loginHref?: { to: string; search?: Record<string, string> };
  brandKicker?: string;
  brandLines?: string[];
}

const proofPoints = [
  { icon: Target, t: "Smart matches by role & city" },
  { icon: ShieldCheck, t: "Verified employers only" },
  { icon: Briefcase, t: "Apply in one tap" },
];

export function Questionnaire({
  steps,
  index,
  onIndex,
  onSubmit,
  submitting,
  submitLabel = "Finish",
  side = "candidate",
  loginHref,
  brandKicker = "JobsKart for everyone",
  brandLines = [
    "Join 50 lakh+ Indians who hire & get hired here.",
    "One question at a time — no boring forms.",
  ],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const total = steps.length;
  const current = steps[index];
  const isLast = index === total - 1;

  useEffect(() => {
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        "input, textarea, select, button[data-autofocus]",
      );
      el?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [index]);

  const goNext = async () => {
    if (current?.validate) {
      const err = current.validate();
      if (err) {
        const { toast } = await import("sonner");
        toast.error(err);
        return;
      }
    }
    if (isLast) {
      await onSubmit();
    } else {
      onIndex(index + 1);
    }
  };

  const goBack = () => {
    if (index > 0) onIndex(index - 1);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-primary-dark p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="inline-flex items-center gap-2 w-fit">
          <img src={logoAsset.url} alt="JobsKart" className="h-9 w-auto brightness-0 invert" />
        </Link>

        <div className="relative z-10 max-w-md">
          <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white ring-1 ring-white/25">
            {brandKicker}
          </span>
          <h2 className="mt-6 text-4xl font-bold leading-tight">
            {side === "employer" ? "Hire faster. Hire smarter." : "Find work that fits your life."}
          </h2>
          <p className="mt-4 text-base text-white/80">{brandLines[0]}</p>
          <p className="mt-1 text-sm text-white/60">{brandLines[1]}</p>

          <ul className="mt-10 space-y-4">
            {proofPoints.map((p) => (
              <li key={p.t} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-white/12 text-white ring-1 ring-white/25">
                  <p.icon className="h-4 w-4" strokeWidth={2.25} />
                </span>
                {p.t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-white/50">
          © {new Date().getFullYear()} JobsKart · Made in India
        </div>

        {/* subtle overlay grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
      </aside>

      {/* Question panel */}
      <main className="flex flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 lg:px-10">
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <img src={logoAsset.url} alt="JobsKart" className="h-7 w-auto" />
          </Link>
          <div className="hidden text-sm text-muted-foreground lg:block">
            Step <span className="font-semibold text-foreground">{index + 1}</span> of {total}
          </div>
          {loginHref ? (
            <Link
              to={loginHref.to}
              search={loginHref.search}
              className="text-sm font-semibold text-primary hover:text-primary-dark"
            >
              Already have an account? Log in
            </Link>
          ) : (
            <span />
          )}
        </div>

        <div className="px-6 pt-6 lg:px-10">
          <div className="flex gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => i < index && onIndex(i)}
                disabled={i > index}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  i < index
                    ? "bg-primary cursor-pointer"
                    : i === index
                      ? "bg-foreground"
                      : "bg-border"
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Question {index + 1} / {total}
          </p>
        </div>

        <div
          ref={containerRef}
          className="flex flex-1 items-start justify-center px-6 py-10 lg:px-10 lg:py-16"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
              e.preventDefault();
              void goNext();
            }
          }}
        >
          <div className="w-full max-w-xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={current?.key ?? index}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  {current?.title}
                </h1>
                {current?.hint && (
                  <p className="mt-3 text-sm text-muted-foreground">{current.hint}</p>
                )}
                <div className="mt-8">{current?.render()}</div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-border bg-background/95 px-6 py-4 backdrop-blur lg:px-10">
          <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={index === 0 || submitting}
              className="inline-flex h-11 items-center gap-1 rounded-lg px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={submitting}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-elegant)] transition-all hover:translate-y-[-1px] hover:bg-primary-dark disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLast ? submitLabel : "Continue"}
              {!isLast && !submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Press <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono">Enter</kbd> to continue
          </p>
        </div>
      </main>
    </div>
  );
}

/* ---------- Reusable inputs designed for big, friendly questions ---------- */

export function BigInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border-0 border-b-2 border-border bg-transparent px-1 py-3 text-2xl font-medium text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-0 ${props.className ?? ""}`}
    />
  );
}

export function BigTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full resize-none border-0 border-b-2 border-border bg-transparent px-1 py-3 text-lg text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-0 ${props.className ?? ""}`}
    />
  );
}

export function ChipChoice<T extends string>({
  value,
  onChange,
  options,
  multi,
}: {
  value: T | T[];
  onChange: (v: T | T[]) => void;
  options: { value: T; label: string; hint?: string }[];
  multi?: boolean;
}) {
  const isOn = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  const toggle = (v: T) => {
    if (multi && Array.isArray(value)) {
      onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    } else {
      onChange(v);
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`group rounded-xl border-2 p-4 text-left transition-all ${
              on
                ? "border-primary bg-primary/5 shadow-[0_4px_16px_-8px_rgba(26,85,189,0.4)]"
                : "border-border bg-card hover:border-foreground/30"
            }`}
          >
            <p className="text-base font-semibold text-foreground">{o.label}</p>
            {o.hint && <p className="mt-1 text-xs text-muted-foreground">{o.hint}</p>}
          </button>
        );
      })}
    </div>
  );
}

export function OtpInput({
  value,
  onChange,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  return (
    <div className="flex gap-2 sm:gap-3">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, "").slice(0, 1);
            const next = (value.slice(0, i) + ch + value.slice(i + 1)).slice(0, length);
            onChange(next);
            if (ch && i < length - 1) {
              const sibling = e.target.parentElement?.children[i + 1] as HTMLInputElement | undefined;
              sibling?.focus();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) {
              const sibling = (e.currentTarget.parentElement?.children[i - 1] as HTMLInputElement | undefined);
              sibling?.focus();
            }
          }}
          className="h-14 w-12 rounded-xl border-2 border-border bg-card text-center text-xl font-bold text-foreground focus:border-primary focus:outline-none"
        />
      ))}
    </div>
  );
}

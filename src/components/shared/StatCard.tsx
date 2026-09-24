import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

const TONES: Record<string, string> = {
  primary: "bg-primary-light text-primary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  muted: "bg-surface text-muted-foreground",
};

/** Single stat card shared by employer and candidate dashboards/reports — label → big number → hint/delta. */
export function StatCard({
  label,
  value,
  hint,
  delta,
  tone = "primary",
  icon: Icon,
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: number;
  tone?: "primary" | "success" | "warning" | "muted";
  /** Small tone-colored badge next to the label. */
  icon?: LucideIcon;
  /** Wraps the card in a Link when provided. */
  to?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
          {label}
        </p>
        {Icon ? (
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TONES[tone]}`}>
            <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground tabular-nums sm:text-3xl">{value}</p>
      <div className="mt-2 flex min-h-[22px] flex-wrap items-center gap-1.5 sm:gap-2">
        {hint ? (
          <span className={`inline-block truncate rounded-full px-2 py-0.5 text-[11px] font-medium sm:text-xs ${TONES[tone]}`}>
            {hint}
          </span>
        ) : null}
        {typeof delta === "number" && delta !== 0 ? (
          <span className={`text-xs font-semibold tabular-nums ${delta > 0 ? "text-success" : "text-destructive"}`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        ) : null}
      </div>
    </>
  );

  const className = `group flex min-w-0 flex-col rounded-2xl border border-border bg-card p-3.5 shadow-[var(--shadow-card)] sm:p-5${
    to ? " transition-all hover:-translate-y-0.5 hover:border-primary/40" : ""
  }`;

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}

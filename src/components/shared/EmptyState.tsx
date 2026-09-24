import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Shared empty-state block — dashed card with icon, message and an optional CTA. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  ctaLabel,
  ctaTo,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaTo?: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-light text-primary">
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <p className="mt-4 text-base font-bold text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      {ctaLabel && ctaTo ? (
        <Link
          to={ctaTo}
          className="mt-5 inline-flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-dark"
        >
          {ctaLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

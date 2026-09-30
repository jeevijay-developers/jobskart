import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

export function RoleGate({
  allowed,
  children,
  fallback,
}: {
  allowed: boolean;
  children?: ReactNode;
  fallback?: ReactNode;
}) {
  if (allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;
  return (
    <div className="rounded-2xl border border-border bg-card p-12 text-center shadow-[var(--shadow-card)]">
      <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
      <h2 className="mt-4 text-xl font-bold text-foreground">Access restricted</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Your role doesn't have permission to view or manage this section. Contact your
        company's Super Admin for access.
      </p>
      <Link
        to="/employer/dashboard"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
      >
        Return to dashboard
      </Link>
    </div>
  );
}

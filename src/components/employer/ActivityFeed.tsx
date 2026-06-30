import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Briefcase,
  Clock,
  Coins,
  FileEdit,
  Mail,
  ShieldCheck,
  Unlock,
  UserCheck,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ActivityItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  "application.received": { icon: UserPlus, tone: "bg-primary-light text-primary" },
  "application.status_changed": { icon: UserCheck, tone: "bg-warning-light text-warning" },
  "job.created": { icon: Briefcase, tone: "bg-success-light text-success" },
  "job.draft_saved": { icon: FileEdit, tone: "bg-surface text-muted-foreground" },
  "job.status_changed": { icon: Briefcase, tone: "bg-primary-light text-primary" },
  "credits.purchased": { icon: Coins, tone: "bg-success-light text-success" },
  "credits.spent": { icon: Coins, tone: "bg-warning-light text-warning" },
  "credits.granted": { icon: Coins, tone: "bg-primary-light text-primary" },
  "credits.adjusted": { icon: Coins, tone: "bg-surface text-muted-foreground" },
  "candidate.unlocked": { icon: Unlock, tone: "bg-primary-light text-primary" },
  "team.invited": { icon: Mail, tone: "bg-primary-light text-primary" },
  "team.joined": { icon: Users, tone: "bg-success-light text-success" },
  "team.role_changed": { icon: ShieldCheck, tone: "bg-warning-light text-warning" },
  "team.removed": { icon: XCircle, tone: "bg-surface text-muted-foreground" },
};

function iconFor(kind: string) {
  return ICONS[kind] ?? { icon: Activity, tone: "bg-surface text-muted-foreground" };
}

export function ActivityFeed({
  items,
  loading,
  emptyHint = "No activity yet — post your first job to start the timeline.",
  dense = false,
}: {
  items: ActivityItem[];
  loading?: boolean;
  emptyHint?: string;
  dense?: boolean;
}) {
  if (loading) {
    return (
      <ul className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex gap-3">
            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center">
        <Clock className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <ol className={`relative ${dense ? "space-y-2" : "space-y-3"}`}>
      <span aria-hidden className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
      {items.map((it) => {
        const { icon: Icon, tone } = iconFor(it.kind);
        const body = (
          <div className="relative flex min-w-0 gap-3">
            <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-card ${tone}`}>
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="truncate text-sm font-semibold text-foreground">{it.title}</p>
              {it.body && <p className="mt-0.5 truncate text-xs text-muted-foreground">{it.body}</p>}
              <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {formatDistanceToNow(new Date(it.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
        return (
          <li key={it.id}>
            {it.link ? (
              <Link to={it.link} className="block rounded-lg px-1 py-1.5 hover:bg-surface">
                {body}
              </Link>
            ) : (
              <div className="px-1 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

import { StateDropdown } from "@/components/candidate/StateDropdown";
import { LEAD_STATUSES } from "@/lib/leadStatus";

type Props = {
  value: string;
  onChange: (status: string) => void;
  className?: string;
};

/**
 * Same role as ApplicantStatusMenu, for unlock-only CRM leads that have no
 * applications row to carry a status — updates candidate_unlocks.lead_status
 * via update_lead_status() instead of applications.status.
 */
export function LeadStatusMenu({ value, onChange, className }: Props) {
  const selected = LEAD_STATUSES.find((s) => s.id === value)?.label || "";
  return (
    <StateDropdown
      value={selected}
      options={LEAD_STATUSES.map((s) => s.label)}
      menuMinWidth={160}
      onChange={(label) => {
        const next = LEAD_STATUSES.find((s) => s.label === label)?.id;
        if (next) onChange(next);
      }}
      triggerClassName={`h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 flex items-center justify-between text-left ${className ?? ""}`}
    />
  );
}

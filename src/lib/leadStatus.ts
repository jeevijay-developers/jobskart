export const LEAD_STATUSES = [
  { id: "new", label: "New Lead", tone: "bg-primary-light text-primary" },
  { id: "contacted", label: "Contacted", tone: "bg-blue-100 text-blue-700" },
  { id: "interested", label: "Interested", tone: "bg-success-light text-success" },
  { id: "follow_up_required", label: "Follow-up Required", tone: "bg-warning-light text-warning" },
  { id: "not_interested", label: "Not Interested", tone: "bg-surface text-muted-foreground" },
  { id: "unreachable", label: "Unreachable", tone: "bg-destructive-light text-destructive" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["id"];

export function leadStatusLabel(status: string) {
  return LEAD_STATUSES.find((s) => s.id === status)?.label ?? status;
}

export function leadStatusTone(status: string) {
  return LEAD_STATUSES.find((s) => s.id === status)?.tone ?? "bg-surface text-muted-foreground";
}

export const APPLICANT_STATUSES = [
  { id: "applied", label: "Applied", tone: "bg-primary-light text-primary" },
  { id: "shortlisted", label: "Shortlisted", tone: "bg-success-light text-success" },
  { id: "interview", label: "Interview", tone: "bg-warning-light text-warning" },
  { id: "hired", label: "Hired", tone: "bg-success text-success-foreground" },
  { id: "rejected", label: "Rejected", tone: "bg-surface text-muted-foreground" },
] as const;

export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number]["id"];

export function applicantStatusLabel(status: string) {
  return APPLICANT_STATUSES.find((s) => s.id === status)?.label ?? status;
}

export function applicantStatusTone(status: string) {
  return APPLICANT_STATUSES.find((s) => s.id === status)?.tone ?? "bg-surface text-muted-foreground";
}

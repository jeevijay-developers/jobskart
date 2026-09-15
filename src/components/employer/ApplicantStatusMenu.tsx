import { APPLICANT_STATUSES } from "@/lib/applicantStatus";

type Props = {
  value: string;
  onChange: (status: string) => void;
  className?: string;
};

export function ApplicantStatusMenu({ value, onChange, className }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={`h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 ${className ?? ""}`}
    >
      {APPLICANT_STATUSES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

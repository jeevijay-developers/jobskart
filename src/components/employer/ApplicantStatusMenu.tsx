import { APPLICANT_STATUSES } from "@/lib/applicantStatus";
import { StateDropdown } from "@/components/candidate/StateDropdown";

type Props = {
  value: string;
  onChange: (status: string) => void;
  className?: string;
};

// A native <select> was used here previously, but mobile browsers render its
// popup as an OS-level picker that ignores container CSS entirely — it can't
// be constrained to the applicant-details panel's width. StateDropdown (the
// same custom dropdown already used everywhere else in the app for this
// exact class of bug) is a CSS-positioned popover instead, so it stays fully
// inside whatever container it's placed in on both mobile and desktop.
export function ApplicantStatusMenu({ value, onChange, className }: Props) {
  const selected = APPLICANT_STATUSES.find((s) => s.id === value)?.label || "";
  return (
    <StateDropdown
      value={selected}
      options={APPLICANT_STATUSES.map((s) => s.label)}
      onChange={(label) => {
        const next = APPLICANT_STATUSES.find((s) => s.label === label)?.id;
        if (next) onChange(next);
      }}
      triggerClassName={`h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 flex items-center justify-between text-left ${className ?? ""}`}
    />
  );
}

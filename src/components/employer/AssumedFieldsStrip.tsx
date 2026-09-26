import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { JOB_TYPE_OPTIONS, WORK_MODES, GENDERS, JOB_CATEGORIES, INDUSTRIES } from "@/lib/options";
import type { FieldSource } from "@/lib/job-draft-infer";

export type AssumedChipKey =
  | "job_type"
  | "work_mode"
  | "category"
  | "industry"
  | "gender_pref"
  | "interview_type"
  | "joining_fee_required";

type StripValues = {
  job_type: string;
  work_mode: string;
  category: string;
  industry: string;
  gender_pref: string;
  interview_type: string;
  interview_same_as_company: boolean;
  joining_fee_required: boolean;
};

function chipLabel(key: AssumedChipKey, values: StripValues): string {
  switch (key) {
    case "job_type":
      return JOB_TYPE_OPTIONS.find((o) => o.id === values.job_type)?.label || "Job type";
    case "work_mode":
      return WORK_MODES.find((o) => o.id === values.work_mode)?.label || "Work mode";
    case "category":
      return values.category || "Category";
    case "industry":
      return values.industry || "Industry";
    case "gender_pref":
      return values.gender_pref === "male"
        ? "Male"
        : values.gender_pref === "female"
          ? "Female"
          : "Any gender";
    case "interview_type":
      if (values.interview_type === "telephonic") return "Telephonic";
      return values.interview_same_as_company
        ? "Interview at office"
        : "Interview at custom address";
    case "joining_fee_required":
      return values.joining_fee_required ? "Joining fee" : "No joining fee";
  }
}

function chipTooltip(source: FieldSource | undefined, matchedHistoryTitle: string | null): string {
  if (source === "company_history") return `From your last ${matchedHistoryTitle || "job"}`;
  if (source === "jd_library") return "Typical for this role";
  return "Default";
}

const chipClass =
  "rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground/80 hover:border-primary hover:text-primary";

const optionButtonClass = (on: boolean) =>
  `flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
    on ? "bg-primary-light font-medium text-primary" : "text-foreground/80 hover:bg-surface"
  }`;

function ChipOptionList({
  options,
  value,
  onSelect,
}: {
  options: readonly { id: string; label: string }[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="max-h-60 min-w-48 overflow-y-auto overflow-x-hidden p-1 [scrollbar-width:thin]">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className={optionButtonClass(selected)}
          >
            <span className="min-w-0 truncate">{option.label}</span>
            {selected && <Check className="h-4 w-4 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

export function AssumedFieldsStrip(props: {
  inferring: boolean;
  values: StripValues;
  sources: { [K in AssumedChipKey]?: FieldSource };
  matchedHistoryTitle: string | null;
  onChange: (key: AssumedChipKey, value: string | boolean) => void;
}) {
  const { inferring, values, sources, matchedHistoryTitle, onChange } = props;
  const [openChip, setOpenChip] = useState<AssumedChipKey | null>(null);

  const select = (key: AssumedChipKey, value: string | boolean) => {
    onChange(key, value);
    setOpenChip(null);
  };

  const chip = (key: AssumedChipKey, content: ReactNode) => (
    <Popover
      key={key}
      open={openChip === key}
      onOpenChange={(open) => setOpenChip(open ? key : null)}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={chipTooltip(sources[key], matchedHistoryTitle)}
          className={chipClass}
        >
          {chipLabel(key, values)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-auto max-w-[min(20rem,var(--radix-popover-content-available-width))] overflow-hidden rounded-xl border-primary/15 bg-popover p-1 shadow-xl shadow-primary/10"
      >
        {content}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface/60 p-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">We filled this in</p>
      {inferring && <p className="mb-2 text-xs text-muted-foreground">Drafting from this title…</p>}
      <div className="flex flex-wrap gap-1.5">
        {chip(
          "job_type",
          <ChipOptionList
            options={JOB_TYPE_OPTIONS}
            value={values.job_type}
            onSelect={(value) => select("job_type", value)}
          />,
        )}
        {chip(
          "work_mode",
          <ChipOptionList
            options={WORK_MODES}
            value={values.work_mode}
            onSelect={(value) => select("work_mode", value)}
          />,
        )}
        {chip(
          "category",
          <ChipOptionList
            options={JOB_CATEGORIES.map((label) => ({ id: label, label }))}
            value={values.category}
            onSelect={(value) => select("category", value)}
          />,
        )}
        {chip(
          "industry",
          <ChipOptionList
            options={INDUSTRIES.map((label) => ({ id: label, label }))}
            value={values.industry}
            onSelect={(value) => select("industry", value)}
          />,
        )}
        {chip(
          "gender_pref",
          <ChipOptionList
            options={GENDERS}
            value={values.gender_pref}
            onSelect={(value) => select("gender_pref", value)}
          />,
        )}
        {chip(
          "interview_type",
          <ChipOptionList
            options={[
              { id: "in_person", label: "In-person" },
              { id: "telephonic", label: "Telephonic" },
            ]}
            value={values.interview_type}
            onSelect={(value) => select("interview_type", value)}
          />,
        )}
        {chip(
          "joining_fee_required",
          <ChipOptionList
            options={[
              { id: "false", label: "No joining fee" },
              { id: "true", label: "Joining fee" },
            ]}
            value={String(values.joining_fee_required)}
            onSelect={(value) => select("joining_fee_required", value === "true")}
          />,
        )}
      </div>
    </div>
  );
}

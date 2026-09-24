import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { StateDropdown } from "@/components/candidate/StateDropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { JOB_TYPE_OPTIONS, WORK_MODES, GENDERS, JOB_CATEGORIES, INDUSTRIES } from "@/lib/options";
import type { FieldSource } from "@/lib/job-draft-infer";

export type AssumedChipKey =
  | "job_type" | "work_mode" | "category" | "industry"
  | "gender_pref" | "interview_type" | "joining_fee_required";

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
      return values.gender_pref === "male" ? "Male" : values.gender_pref === "female" ? "Female" : "Any gender";
    case "interview_type":
      if (values.interview_type === "telephonic") return "Telephonic";
      return values.interview_same_as_company ? "Interview at office" : "Interview at custom address";
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
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`;

export function AssumedFieldsStrip(props: {
  inferring: boolean;
  values: StripValues;
  sources: { [K in AssumedChipKey]?: FieldSource };
  matchedHistoryTitle: string | null;
  onChange: (key: AssumedChipKey, value: string | boolean) => void;
}) {
  const { inferring, values, sources, matchedHistoryTitle, onChange } = props;

  const chip = (key: AssumedChipKey, content: ReactNode) => (
    <Popover key={key}>
      <PopoverTrigger asChild>
        <button type="button" title={chipTooltip(sources[key], matchedHistoryTitle)} className={chipClass}>
          {chipLabel(key, values)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">{content}</PopoverContent>
    </Popover>
  );

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface/60 p-3">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">We filled this in</p>
      {inferring && <p className="mb-2 text-xs text-muted-foreground">Drafting from this title…</p>}
      <div className="flex flex-wrap gap-1.5">
        {chip(
          "job_type",
          <div className="flex flex-wrap gap-1.5">
            {JOB_TYPE_OPTIONS.map((o) => (
              <button key={o.id} type="button" onClick={() => onChange("job_type", o.id)} className={optionButtonClass(values.job_type === o.id)}>
                {o.label}
              </button>
            ))}
          </div>,
        )}
        {chip(
          "work_mode",
          <div className="flex flex-wrap gap-1.5">
            {WORK_MODES.map((o) => (
              <button key={o.id} type="button" onClick={() => onChange("work_mode", o.id)} className={optionButtonClass(values.work_mode === o.id)}>
                {o.label}
              </button>
            ))}
          </div>,
        )}
        {chip(
          "category",
          <StateDropdown value={values.category} options={JOB_CATEGORIES} placeholder="Select…" onChange={(v) => onChange("category", v)} />,
        )}
        {chip(
          "industry",
          <StateDropdown value={values.industry} options={INDUSTRIES} placeholder="Select…" onChange={(v) => onChange("industry", v)} />,
        )}
        {chip(
          "gender_pref",
          <div className="flex flex-wrap gap-1.5">
            {GENDERS.map((g) => (
              <button key={g.id} type="button" onClick={() => onChange("gender_pref", g.id)} className={optionButtonClass(values.gender_pref === g.id)}>
                {g.label}
              </button>
            ))}
          </div>,
        )}
        {chip(
          "interview_type",
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onChange("interview_type", "in_person")} className={optionButtonClass(values.interview_type === "in_person")}>
              In-person
            </button>
            <button type="button" onClick={() => onChange("interview_type", "telephonic")} className={optionButtonClass(values.interview_type === "telephonic")}>
              Telephonic
            </button>
          </div>,
        )}
        {chip(
          "joining_fee_required",
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onChange("joining_fee_required", false)} className={optionButtonClass(!values.joining_fee_required)}>
              {!values.joining_fee_required && <Check className="mr-1 inline h-3 w-3" />} No joining fee
            </button>
            <button type="button" onClick={() => onChange("joining_fee_required", true)} className={optionButtonClass(values.joining_fee_required)}>
              {values.joining_fee_required && <Check className="mr-1 inline h-3 w-3" />} Joining fee
            </button>
          </div>,
        )}
      </div>
    </div>
  );
}

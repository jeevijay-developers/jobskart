// Pure inference: company history + JD library + hard defaults → a patch of
// pre-filled fields for the job wizard. No I/O — the wizard owns the history
// fetch and passes it in.
import { findRoleTemplate, suggestedSkillsFor } from "./jd-library";

export type CompanyHistoryJob = {
  title: string;
  category: string | null;
  industry: string | null;
  job_type: string | null;
  work_mode: string | null;
  city: string | null;
  pay_type: string | null;
  min_salary: number | null;
  max_salary: number | null;
  avg_incentive_monthly: number | null;
  experience_bucket: string | null;
  min_experience_years: number | null;
  max_experience_years: number | null;
  skills: string[] | null;
  perks: string[] | null;
  shift: string | null;
  working_days: number | null;
  english_level: string | null;
};

export type DraftPatch = {
  category?: string;
  industry?: string;
  job_type?: string;
  work_mode?: string;
  gender_pref?: string;
  interview_type?: "in_person" | "telephonic";
  interview_same_as_company?: boolean;
  joining_fee_required?: boolean;
  city?: string;
  pay_type?: "fixed" | "fixed_incentive" | "incentive_only";
  min_salary?: string;
  max_salary?: string;
  avg_incentive?: string;
  experience_bucket?: "any" | "fresher" | "experienced";
  min_experience_years?: string;
  max_experience_years?: string;
  skills?: string[];
  perks?: string[];
  shift?: string;
  working_days?: string;
  english_level?: string;
};

export type FieldSource = "company_history" | "jd_library" | "default";

export type InferResult = {
  patch: DraftPatch;
  sources: { [K in keyof DraftPatch]?: FieldSource };
  matchedHistoryTitle: string | null;
  libraryTitle: string | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Tier 0: exact/alias titles -> category, checked before the loose keyword
// scan below so short aliases ("bde", "rider") that don't share a substring
// with their category name still resolve correctly. Keys are normalised
// (norm()) full titles or short aliases actually used in Indian blue/grey-
// collar postings. Extend alphabetically by category as new aliases surface;
// avoid ambiguous single-word aliases that could collide across categories.
const TITLE_ALIASES: Record<string, string> = {
  // Sales
  "bde": "Sales", "business development executive": "Sales",
  "relationship manager": "Sales", "sales executive": "Sales",
  "field sales executive": "Sales", "inside sales executive": "Sales",
  "business development associate": "Sales",
  // Delivery
  "delivery executive": "Delivery", "delivery boy": "Delivery",
  "delivery partner": "Delivery", "delivery associate": "Delivery",
  "two wheeler rider": "Delivery", "rider": "Delivery",
  "last mile delivery associate": "Delivery", "courier executive": "Delivery",
  // Driver
  "driver": "Driver", "cab driver": "Driver", "commercial driver": "Driver",
  "personal driver": "Driver", "heavy vehicle driver": "Driver",
  "truck driver": "Driver",
  // Telecaller
  "telecaller": "Telecaller", "telesales executive": "Telecaller",
  "tele caller": "Telecaller", "bpo executive": "Telecaller",
  // Customer Support
  "customer support executive": "Customer Support",
  "customer service associate": "Customer Support",
  "call center executive": "Customer Support",
  "front desk executive": "Customer Support", "receptionist": "Customer Support",
  "front office executive": "Customer Support",
  // Data Entry
  "data entry operator": "Data Entry", "back office executive": "Data Entry",
  "computer operator": "Data Entry",
  // Security
  "security guard": "Security", "security supervisor": "Security",
  "bouncer": "Security", "watchman": "Security",
  // Housekeeping
  "housekeeping staff": "Housekeeping", "housekeeping supervisor": "Housekeeping",
  "office boy": "Housekeeping", "cleaner": "Housekeeping",
  // Cook
  "cook": "Cook", "kitchen helper": "Cook", "chef": "Cook",
  "catering staff": "Cook",
  // Field Agent
  "field agent": "Field Agent", "collection agent": "Field Agent",
  "field executive": "Field Agent", "field officer": "Field Agent",
  // Retail
  "retail sales associate": "Retail", "store executive": "Retail",
  "cashier": "Retail", "store manager": "Retail", "billing executive": "Retail",
  // Warehouse
  "warehouse associate": "Warehouse", "warehouse supervisor": "Warehouse",
  "packer": "Warehouse", "inventory executive": "Warehouse",
  "forklift operator": "Warehouse",
  // Nursing
  "staff nurse": "Nursing", "nursing assistant": "Nursing",
  "home care nurse": "Nursing", "ward assistant": "Nursing",
  // Teaching
  "teacher": "Teaching", "tutor": "Teaching",
  "academic counsellor": "Teaching",
  // IT
  "software developer": "IT", "frontend developer": "IT",
  "backend developer": "IT", "full stack developer": "IT",
  "software engineer": "IT", "qa engineer": "IT", "devops engineer": "IT",
};

// Tier 1: loose keyword -> category, checked as a substring of the
// normalised title when no exact alias hit.
const TITLE_CATEGORY: [string, string][] = [
  ["deliver", "Delivery"], ["courier", "Delivery"],
  ["driver", "Driver"], ["driving", "Driver"],
  ["security", "Security"], ["guard", "Security"],
  ["telecall", "Telecaller"], ["tele sales", "Telecaller"],
  ["data entry", "Data Entry"],
  ["housekeep", "Housekeeping"],
  ["cook", "Cook"], ["chef", "Cook"], ["kitchen", "Cook"],
  ["warehouse", "Warehouse"], ["inventory", "Warehouse"], ["forklift", "Warehouse"],
  ["nurse", "Nursing"], ["nurs", "Nursing"], ["patient care", "Nursing"],
  ["teach", "Teaching"], ["tutor", "Teaching"], ["faculty", "Teaching"],
  ["retail", "Retail"], ["cashier", "Retail"], ["store", "Retail"],
  ["field", "Field Agent"],
  ["developer", "IT"], ["software", "IT"], ["engineer", "IT"],
  ["customer support", "Customer Support"], ["customer service", "Customer Support"],
  ["call center", "Customer Support"], ["receptionist", "Customer Support"],
  ["front desk", "Customer Support"],
  ["sales", "Sales"], ["business development", "Sales"],
];

const INDUSTRY_CATEGORY: Record<string, string> = {
  retail: "Retail",
  "e-commerce": "Retail",
  "e commerce": "Retail",
  logistics: "Delivery",
  healthcare: "Nursing",
  education: "Teaching",
  "it / software": "IT",
  "it/software": "IT",
  hospitality: "Housekeeping",
  "food & beverage": "Cook",
  "food and beverage": "Cook",
  insurance: "Sales",
  telecom: "Telecaller",
  manufacturing: "Warehouse",
  "real estate": "Field Agent",
};

export function mapTitleToCategory(title: string, industry?: string | null): string {
  const t = norm(title);
  const alias = TITLE_ALIASES[t];
  if (alias) return alias;
  for (const [kw, cat] of TITLE_CATEGORY) {
    if (t.includes(kw)) return cat;
  }
  const i = norm(industry || "");
  if (i && INDUSTRY_CATEGORY[i]) return INDUSTRY_CATEGORY[i];
  return "Other";
}

function fromHistory(h: CompanyHistoryJob): DraftPatch {
  const patch: DraftPatch = {};
  if (h.category) patch.category = h.category;
  if (h.industry) patch.industry = h.industry;
  if (h.job_type) patch.job_type = h.job_type;
  if (h.work_mode) patch.work_mode = h.work_mode;
  if (h.city) patch.city = h.city;
  if (h.pay_type === "fixed" || h.pay_type === "fixed_incentive" || h.pay_type === "incentive_only") {
    patch.pay_type = h.pay_type;
  }
  if (h.min_salary != null) patch.min_salary = String(h.min_salary);
  if (h.max_salary != null) patch.max_salary = String(h.max_salary);
  if (h.avg_incentive_monthly != null) patch.avg_incentive = String(h.avg_incentive_monthly);
  if (h.experience_bucket === "any" || h.experience_bucket === "fresher" || h.experience_bucket === "experienced") {
    patch.experience_bucket = h.experience_bucket;
  }
  if (h.min_experience_years != null) patch.min_experience_years = String(h.min_experience_years);
  if (h.max_experience_years != null) patch.max_experience_years = String(h.max_experience_years);
  if (h.skills?.length) patch.skills = h.skills;
  if (h.perks?.length) patch.perks = h.perks;
  if (h.shift) patch.shift = h.shift;
  if (h.working_days != null) patch.working_days = String(h.working_days);
  if (h.english_level) patch.english_level = h.english_level;
  return patch;
}

const DEFAULTS: DraftPatch = {
  job_type: "full_time",
  work_mode: "onsite",
  gender_pref: "any",
  interview_type: "in_person",
  interview_same_as_company: true,
  joining_fee_required: false,
  pay_type: "fixed",
  experience_bucket: "any",
};

export function inferJobDraft(args: {
  title: string;
  history: CompanyHistoryJob[];
  dirty: ReadonlySet<string>;
}): InferResult {
  const { title, history, dirty } = args;
  const sources: InferResult["sources"] = {};
  const patch: DraftPatch = {};

  const set = <K extends keyof DraftPatch>(key: K, value: DraftPatch[K] | undefined, source: FieldSource) => {
    if (value === undefined || patch[key] !== undefined || dirty.has(key)) return;
    patch[key] = value;
    sources[key] = source;
  };

  // Priority 1: most recent job with the same (normalised) title. Priority 2:
  // most recent job overall, for whatever fields (1) left empty.
  const sameTitle = history.find((h) => norm(h.title) === norm(title)) ?? null;
  const mostRecent = history[0] ?? null;

  let usedHistory = false;
  for (const hist of [sameTitle, mostRecent]) {
    if (!hist) continue;
    const hp = fromHistory(hist);
    for (const k of Object.keys(hp) as (keyof DraftPatch)[]) {
      const before = patch[k];
      set(k, hp[k], "company_history");
      if (patch[k] !== before) usedHistory = true;
    }
  }
  const matchedHistoryTitle = usedHistory ? (sameTitle ?? mostRecent)!.title : null;

  // Priority 3: JD library, only for industry/category/skills.
  const tpl = findRoleTemplate(title);
  set("industry", tpl?.industry, "jd_library");
  set("category", tpl ? mapTitleToCategory(title, tpl.industry) : undefined, "jd_library");
  set("skills", tpl ? suggestedSkillsFor(title, tpl.industry) : undefined, "jd_library");

  // category can still be missing (no library hit, no history) — derive it
  // from whatever industry we did land on, or "Other".
  set("category", patch.category === undefined ? mapTitleToCategory(title, patch.industry) : undefined, "default");
  if (patch.skills === undefined) set("skills", [], "default");

  // Priority 4: hard defaults for anything still unset.
  for (const k of Object.keys(DEFAULTS) as (keyof DraftPatch)[]) {
    set(k, DEFAULTS[k], "default");
  }

  return {
    patch,
    sources,
    matchedHistoryTitle,
    libraryTitle: tpl?.title ?? null,
  };
}

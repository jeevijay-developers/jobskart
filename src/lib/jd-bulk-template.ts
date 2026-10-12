// Bulk job posting Excel template + parser.
import * as XLSX from "xlsx";
import { JOB_CATEGORIES, INDUSTRIES, PAY_TYPES, WEEKDAYS, INTERVIEW_TYPES } from "@/lib/options";

export type BulkJobRow = {
  title: string;
  city: string;
  job_type: string;
  work_mode: string;
  min_salary: number | null;
  max_salary: number | null;
  min_experience_years: number | null;
  max_experience_years: number | null;
  education: string;
  skills: string;
  description: string;
  openings: number;
  // Optional. Blank = the database infers it from the title (see jobs_infer_missing_category).
  category: string;
  pincode: string;
  // New fields added to match JobWizard's publish-time required set (point 27).
  industry: string;
  pay_type: string;
  working_weekdays: string; // comma-separated, e.g. "monday,tuesday"
  hiring_contact_mode: string; // "myself" | "other"
  hiring_contact_name: string;
  hiring_contact_phone: string;
  hiring_contact_email: string;
  interview_type: string; // "in_person" | "telephonic"
  interview_city: string;
  interview_address: string;
  certifications: string; // comma-separated
  certifications_not_required: boolean;
};

const PAY_TYPE_IDS = PAY_TYPES.map((p) => p.id);
const WEEKDAY_IDS = WEEKDAYS.map((w) => w.id);
const INTERVIEW_TYPE_IDS = INTERVIEW_TYPES.map((t) => t.id);

// The columns a valid template must have — used both to build the download
// and to detect an old template on upload (point 27: "clear message instead
// of crashing or publishing incomplete jobs").
const HEADERS = [
  "title", "city", "job_type", "work_mode",
  "min_salary", "max_salary",
  "min_experience_years", "max_experience_years",
  "education", "skills (comma separated)", "description", "openings",
  "category", "pincode",
  "industry", "pay_type", "working_weekdays (comma separated)",
  "hiring_contact_mode", "hiring_contact_name", "hiring_contact_phone", "hiring_contact_email",
  "interview_type", "interview_city", "interview_address",
  "certifications (comma separated)", "certifications_not_required (yes/no)",
];

// Columns that must be present for the sheet to be treated as the current
// template — anything missing means an old template was uploaded.
const REQUIRED_HEADERS = [
  "title", "industry", "pay_type", "working_weekdays (comma separated)",
  "hiring_contact_mode", "hiring_contact_name", "hiring_contact_phone", "hiring_contact_email",
  "interview_type", "certifications_not_required (yes/no)",
];

const SAMPLE: (string | number)[][] = [
  [
    "Field Sales Executive", "Delhi", "full_time", "onsite", 20000, 35000, 0, 2, "12th Pass",
    "Sales, Communication, Field Work", "Meet clients daily and close deals.", 3, "Sales", "110001",
    "Retail", "fixed_incentive", "monday,tuesday,wednesday,thursday,friday",
    "other", "Priya Sharma", "9876543210", "priya@example.com",
    "in_person", "Delhi", "12 MG Road, Delhi",
    "", "yes",
  ],
  [
    "Telecaller", "Mumbai", "full_time", "onsite", 18000, 28000, 0, 1, "12th Pass",
    "Cold Calling, Hindi, English", "Outbound calls to leads.", 5, "Telecaller", "400001",
    "Telecom", "fixed", "monday,tuesday,wednesday,thursday,friday,saturday",
    "myself", "Rahul Verma", "9123456780", "rahul@example.com",
    "telephonic", "", "",
    "", "yes",
  ],
];

export function downloadBulkJobTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...SAMPLE]);
  ws["!cols"] = HEADERS.map(() => ({ wch: 24 }));
  const notes = XLSX.utils.aoa_to_sheet([
    ["Field", "Allowed values"],
    ["job_type", "full_time, part_time, contract, internship, temporary"],
    ["work_mode", "onsite, remote, hybrid, field"],
    ["salary", "Monthly ₹, numeric"],
    ["skills", "Comma-separated, e.g. Sales, Excel"],
    ["category", `Optional. ${JOB_CATEGORIES.join(", ")}. Leave blank and we pick one from the job title; set it for roles we cannot classify.`],
    ["pincode", "Optional. 6 digits if given."],
    ["industry", INDUSTRIES.join(", ")],
    ["pay_type", PAY_TYPES.map((p) => `${p.id} (${p.label})`).join(", ")],
    ["working_weekdays", `Comma-separated. One or more of: ${WEEKDAY_IDS.join(", ")}`],
    ["hiring_contact_mode", `"myself" or "other"`],
    ["interview_type", `${INTERVIEW_TYPE_IDS.join(", ")}. If "in_person" and the interview isn't at the company address, fill interview_city and interview_address too.`],
    ["certifications", "Comma-separated, or leave blank and set certifications_not_required to \"yes\"."],
    ["certifications_not_required", `"yes" or "no" — must be "yes" if certifications is left blank.`],
  ]);
  notes["!cols"] = [{ wch: 24 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jobs");
  XLSX.utils.book_append_sheet(wb, notes, "Reference");
  XLSX.writeFile(wb, "jobskart-bulk-jobs-template.xlsx");
}

// Thrown when an uploaded sheet is missing columns the current template
// requires — i.e. the employer uploaded an old template.
export class OutdatedBulkTemplateError extends Error {
  constructor() {
    super("This sheet is missing some columns. Please download the latest template and try again.");
  }
}

function toYesNo(v: unknown): boolean {
  const s = String(v || "").trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1";
}

export function parseBulkJobsFile(file: File): Promise<BulkJobRow[]> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets["Jobs"] || wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

        // Detect an old template: the sheet's own header row, not just the
        // parsed data (an empty sheet would otherwise look "valid").
        const sheetHeaders = new Set(
          (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map((h) =>
            String(h).trim().toLowerCase(),
          ),
        );
        const missingRequired = REQUIRED_HEADERS.filter(
          (h) => !sheetHeaders.has(h.toLowerCase()),
        );
        if (missingRequired.length > 0) {
          return reject(new OutdatedBulkTemplateError());
        }

        const out: BulkJobRow[] = rows
          .filter((r) => String(r["title"] || "").trim())
          .map((r) => ({
            title: String(r["title"] || "").trim(),
            city: String(r["city"] || "").trim(),
            job_type: String(r["job_type"] || "full_time").trim(),
            work_mode: String(r["work_mode"] || "on_site").trim(),
            min_salary: Number(r["min_salary"]) || null,
            max_salary: Number(r["max_salary"]) || null,
            min_experience_years: Number(r["min_experience_years"]) || null,
            max_experience_years: Number(r["max_experience_years"]) || null,
            education: String(r["education"] || "").trim(),
            skills: String(r["skills (comma separated)"] || r["skills"] || "").trim(),
            description: String(r["description"] || "").trim(),
            openings: Number(r["openings"]) || 1,
            category: String(r["category"] || "").trim(),
            pincode: String(r["pincode"] || "").trim(),
            industry: String(r["industry"] || "").trim(),
            pay_type: String(r["pay_type"] || "").trim(),
            working_weekdays: String(
              r["working_weekdays (comma separated)"] || r["working_weekdays"] || "",
            ).trim(),
            hiring_contact_mode: String(r["hiring_contact_mode"] || "").trim(),
            hiring_contact_name: String(r["hiring_contact_name"] || "").trim(),
            hiring_contact_phone: String(r["hiring_contact_phone"] || "").trim(),
            hiring_contact_email: String(r["hiring_contact_email"] || "").trim(),
            interview_type: String(r["interview_type"] || "").trim(),
            interview_city: String(r["interview_city"] || "").trim(),
            interview_address: String(r["interview_address"] || "").trim(),
            certifications: String(r["certifications (comma separated)"] || r["certifications"] || "").trim(),
            certifications_not_required: toYesNo(
              r["certifications_not_required (yes/no)"] ?? r["certifications_not_required"],
            ),
          }));
        resolve(out);
      } catch (err) { reject(err); }
    };
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsArrayBuffer(file);
  });
}

// Same publish-time rules as JobWizard.validateStep (JobWizard.tsx:790-827),
// applied per bulk row — returns null when the row is valid, else the exact
// reason to show in the preview table. No new email/phone format checks:
// hiring contact fields are only checked for non-emptiness, matching
// JobWizard's own step-2 check.
export function validateBulkRow(r: BulkJobRow): string | null {
  if (!r.title.trim()) return "Missing title";
  if (!r.city.trim()) return "Missing city";
  if (!r.education.trim()) return "Missing education";
  if (!r.openings || r.openings < 1) return "Openings must be at least 1";
  if (!r.pay_type || !PAY_TYPE_IDS.includes(r.pay_type)) return "Invalid or missing pay_type";
  if (r.pincode && r.pincode.length !== 6) return "Pincode must be 6 digits";
  if (r.min_salary != null && r.max_salary != null && r.max_salary < r.min_salary)
    return "Max salary must be ≥ min salary";
  const skillsList = r.skills ? r.skills.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!skillsList.length) return "Add at least one skill";
  const weekdays = r.working_weekdays
    ? r.working_weekdays.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  if (!weekdays.length) return "Select at least one working day";
  if (weekdays.some((d) => !WEEKDAY_IDS.includes(d))) return "Invalid working day value";
  if (r.hiring_contact_mode !== "myself" && r.hiring_contact_mode !== "other")
    return "hiring_contact_mode must be \"myself\" or \"other\"";
  if (!r.hiring_contact_name.trim() || !r.hiring_contact_phone.trim() || !r.hiring_contact_email.trim())
    return "Add the hiring contact's name, phone and email";
  const certifications = r.certifications ? r.certifications.split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (!r.certifications_not_required && !certifications.length)
    return "Add a certification, or set certifications_not_required to yes";
  if (!r.interview_type || !INTERVIEW_TYPE_IDS.includes(r.interview_type))
    return "Invalid or missing interview_type";
  if (r.interview_type === "in_person" && !(r.interview_city && r.interview_address)) {
    // Bulk has no "same as company" toggle like JobWizard's wizard step —
    // an in-person interview always needs its own city + address here.
    return "Add interview_city and interview_address for an in-person interview";
  }
  return null;
}

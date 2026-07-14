// Bulk job posting Excel template + parser.
import * as XLSX from "xlsx";

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
};

const HEADERS = [
  "title", "city", "job_type", "work_mode",
  "min_salary", "max_salary",
  "min_experience_years", "max_experience_years",
  "education", "skills (comma separated)", "description", "openings",
];

const SAMPLE: (string | number)[][] = [
  ["Field Sales Executive", "Delhi", "full_time", "onsite", 20000, 35000, 0, 2, "12th Pass", "Sales, Communication, Field Work", "Meet clients daily and close deals.", 3],
  ["Telecaller", "Mumbai", "full_time", "onsite", 18000, 28000, 0, 1, "12th Pass", "Cold Calling, Hindi, English", "Outbound calls to leads.", 5],
];

export function downloadBulkJobTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...SAMPLE]);
  ws["!cols"] = HEADERS.map(() => ({ wch: 22 }));
  const notes = XLSX.utils.aoa_to_sheet([
    ["Field", "Allowed values"],
    ["job_type", "full_time, part_time, contract, internship, temporary"],
    ["work_mode", "onsite, remote, hybrid, field"],
    ["salary", "Monthly ₹, numeric"],
    ["skills", "Comma-separated, e.g. Sales, Excel"],
  ]);
  notes["!cols"] = [{ wch: 20 }, { wch: 60 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jobs");
  XLSX.utils.book_append_sheet(wb, notes, "Reference");
  XLSX.writeFile(wb, "jobskart-bulk-jobs-template.xlsx");
}

export function parseBulkJobsFile(file: File): Promise<BulkJobRow[]> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const ws = wb.Sheets["Jobs"] || wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
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
          }));
        resolve(out);
      } catch (err) { reject(err); }
    };
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsArrayBuffer(file);
  });
}

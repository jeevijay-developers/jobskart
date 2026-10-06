// Regenerates src/lib/jd-library-data.json from "Data JD.xlsx".
// Usage: node scripts/build-jd-library.mjs [path/to/sheet.xlsx]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const src = process.argv[2] ?? "Data JD.xlsx";
const out = "src/lib/jd-library-data.json";
const wb = XLSX.readFile(src);
const rows = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });

const roles = rows("ROLE_MASTER").map((r) => ({
  role_id: r.Role_ID,
  title: r.Job_Title,
  industry: r.Industry,
  department: r.Department,
  summary: r["2-Line_Role_Summary"],
  skills: [],
  fixed_responsibilities: [],
}));
const byId = new Map(roles.map((r) => [r.role_id, r]));

for (const s of rows("ROLE_SKILL_MAPPING")) {
  byId.get(s.Role_ID)?.skills.push({
    group_id: s.Skill_Group_ID,
    skill: s.Skills,
    skill_ids: s.Skill_IDs,
    priority: s.Priority,
    jd_line: s.JD_Line,
    binding: s.Binding_Type,
  });
}
for (const f of rows("FIXED_RESPONSIBILITIES")) {
  byId.get(f.Role_ID)?.fixed_responsibilities.push({
    id: f.Fixed_Responsibility_ID,
    text: f.Fixed_Responsibility,
  });
}

writeFileSync(out, JSON.stringify(roles, null, 1) + "\n");
console.log(`Wrote ${roles.length} roles to ${out}`);

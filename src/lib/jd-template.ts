// JD auto-generation. Turns structured wizard input into a rendered
// job description (markdown + HTML). Pure client-side, no AI call.

export type JdInput = {
  title: string;
  companyName: string;
  industry?: string;
  category?: string;
  workMode?: string;
  jobType?: string;

  payType: "fixed" | "fixed_incentive" | "incentive_only";
  minSalary?: number;
  maxSalary?: number;
  avgIncentive?: number;

  experienceBucket: "any" | "fresher" | "experienced";
  minExp?: number;
  maxExp?: number;

  degree?: string;
  specialisation?: string;
  skills?: string[];
  englishLevel?: "basic" | "good" | "speaks_good";
  gender?: "any" | "male" | "female";
  shift?: string;
  workingDays?: number;
  assets?: string[];

  perks?: string[];
  joiningFeeRequired?: boolean;
  certifications?: string[];
  ageMin?: number;
  ageMax?: number;
  preferredLanguages?: string[];
  preferredIndustries?: string[];
};

const ROLE_SUMMARY_BANK: Record<string, string> = {
  sales: "The role involves reaching out to prospective customers, closing sales, and maintaining strong client relationships to hit monthly targets.",
  delivery: "The role involves timely pickup and delivery of orders, following the app-assigned routes and ensuring excellent customer experience.",
  driver: "The role involves safely driving assigned vehicles, following schedules and traffic rules, and maintaining basic vehicle upkeep.",
  telecaller: "The role involves making outbound calls, handling customer queries, converting leads and maintaining daily call records.",
  "customer support": "The role involves assisting customers on calls or chat, resolving queries end-to-end and maintaining high CSAT.",
  "data entry": "The role involves accurately entering, verifying and maintaining records across our internal systems.",
  security: "The role involves guarding the premises, monitoring entry/exit and maintaining daily security logs.",
  housekeeping: "The role involves keeping the premises clean, restocking supplies and supporting day-to-day facility upkeep.",
  cook: "The role involves preparing meals as per menu, maintaining kitchen hygiene and managing basic inventory.",
  "field agent": "The role involves visiting assigned locations, meeting customers or partners on the ground and reporting daily activity.",
  retail: "The role involves attending to walk-in customers, managing store inventory and ensuring smooth billing operations.",
  warehouse: "The role involves inward/outward handling of stock, packaging and maintaining accurate inventory records.",
  nursing: "The role involves patient care, administering medication under supervision and maintaining accurate patient records.",
  teaching: "The role involves preparing lesson plans, teaching students and assessing their progress regularly.",
  it: "The role involves building and maintaining software, collaborating with the team and delivering features on schedule.",
};

const RESPONSIBILITIES_BANK: Record<string, string[]> = {
  sales: [
    "Reach out to prospective customers and understand their requirements.",
    "Present products/services and close deals to meet monthly targets.",
    "Maintain accurate records of leads, follow-ups and conversions.",
    "Build long-term relationships with customers for repeat business.",
  ],
  delivery: [
    "Pick up and deliver orders as per app-assigned routes.",
    "Ensure on-time delivery and a good customer experience.",
    "Handle cash-on-delivery collections responsibly.",
    "Maintain your vehicle in good condition.",
  ],
  driver: [
    "Drive assigned vehicles safely as per schedule.",
    "Follow all traffic rules and route instructions.",
    "Maintain basic upkeep and cleanliness of the vehicle.",
    "Report any issues or accidents immediately.",
  ],
  telecaller: [
    "Make outbound calls to prospective customers.",
    "Explain products/services and address queries.",
    "Convert leads and schedule follow-ups.",
    "Maintain daily call logs and reports.",
  ],
  "customer support": [
    "Assist customers on calls/chat and resolve their queries end-to-end.",
    "Escalate complex issues to the right team with proper context.",
    "Maintain CSAT and first-response SLAs.",
    "Document recurring issues for process improvement.",
  ],
  "data entry": [
    "Enter and update information accurately across internal systems.",
    "Verify data and fix discrepancies in a timely manner.",
    "Maintain physical and digital records for easy retrieval.",
    "Generate periodic reports for internal teams.",
  ],
  security: [
    "Guard the assigned premises during shift hours.",
    "Monitor entry and exit of people and vehicles.",
    "Maintain daily security logs and incident reports.",
    "Respond quickly to any security concerns.",
  ],
  housekeeping: [
    "Clean and sanitize assigned areas as per schedule.",
    "Restock supplies and report shortages.",
    "Support day-to-day facility upkeep.",
    "Follow hygiene and safety protocols.",
  ],
  cook: [
    "Prepare meals as per the daily menu.",
    "Maintain kitchen hygiene and food safety standards.",
    "Manage basic inventory of ingredients.",
    "Coordinate with helpers for smooth service.",
  ],
  "field agent": [
    "Visit assigned locations to meet customers or partners.",
    "Complete daily targets and report activity in the app.",
    "Handle documentation and basic paperwork.",
    "Build strong on-ground relationships.",
  ],
  retail: [
    "Attend to walk-in customers and assist with their needs.",
    "Manage store inventory and display.",
    "Handle billing and payment collections accurately.",
    "Maintain a clean, welcoming store environment.",
  ],
  warehouse: [
    "Handle inward and outward movement of stock.",
    "Pack, label and dispatch orders as per SOP.",
    "Maintain accurate inventory records.",
    "Keep the warehouse organised and safe.",
  ],
  nursing: [
    "Provide patient care under doctor supervision.",
    "Administer medication and monitor vitals.",
    "Maintain accurate patient records.",
    "Support emergency response as needed.",
  ],
  teaching: [
    "Prepare and deliver lesson plans effectively.",
    "Assess student progress and share feedback.",
    "Coordinate with parents and other faculty.",
    "Participate in school activities and events.",
  ],
  it: [
    "Design, build and maintain features end-to-end.",
    "Collaborate with product and design in agile sprints.",
    "Write clean, tested and well-documented code.",
    "Support production systems and resolve issues.",
  ],
};

const FALLBACK_RESPONSIBILITIES = [
  "Perform day-to-day tasks assigned by the reporting manager.",
  "Coordinate with the team to meet daily/weekly targets.",
  "Maintain accurate records of your work.",
  "Follow company processes and safety guidelines.",
];

function keyForCategory(cat?: string) {
  if (!cat) return "";
  const k = cat.toLowerCase().trim();
  if (RESPONSIBILITIES_BANK[k]) return k;
  // fuzzy: match by contains
  for (const bankKey of Object.keys(RESPONSIBILITIES_BANK)) {
    if (k.includes(bankKey) || bankKey.includes(k)) return bankKey;
  }
  return "";
}

function fmtInr(n?: number) {
  if (!n || n <= 0) return "";
  return `₹${n.toLocaleString("en-IN")}`;
}

function salaryRange(input: JdInput): string {
  const { payType, minSalary, maxSalary, avgIncentive } = input;
  if (payType === "incentive_only") {
    return avgIncentive ? `up to ${fmtInr(avgIncentive)}/month in incentives` : "attractive incentives";
  }
  const min = fmtInr(minSalary);
  const max = fmtInr(maxSalary);
  const base = min && max ? `${min} – ${max}/month` : min || max ? `${min || max}/month` : "a competitive salary";
  if (payType === "fixed_incentive" && avgIncentive) return `${base} + incentives up to ${fmtInr(avgIncentive)}/month`;
  return base;
}

function experienceLine(input: JdInput): string {
  if (input.experienceBucket === "fresher") return "Freshers welcome";
  const min = input.minExp ?? 0;
  const max = input.maxExp;
  if (max && max > min) return `${min} – ${max} years of experience required`;
  if (min > 0) return `${min}+ years of experience required`;
  return "Any experience";
}

function englishLine(level?: JdInput["englishLevel"]): string {
  if (!level) return "";
  if (level === "basic") return "Understands basic English";
  if (level === "good") return "Understands good English";
  return "Understands & speaks good English";
}

function genderLine(g?: JdInput["gender"]): string {
  if (!g || g === "any") return "";
  return g === "male" ? "Open to male candidates" : "Open to female candidates";
}

export function buildJd(input: JdInput): { markdown: string; html: string } {
  const catKey = keyForCategory(input.category);
  const summary = ROLE_SUMMARY_BANK[catKey] || "The role involves working closely with the team to deliver on daily responsibilities and grow within the company.";
  const responsibilities =
    (catKey && RESPONSIBILITIES_BANK[catKey]) ||
    (input.skills && input.skills.length
      ? input.skills.slice(0, 5).map((s) => `Apply your ${s} skills to deliver day-to-day tasks.`)
      : FALLBACK_RESPONSIBILITIES);

  const industryClause = input.industry ? `, in ${input.industry}` : "";
  const opening = `We are looking for a ${input.title || "candidate"} to join ${input.companyName || "our team"}${industryClause}. ${summary} The position offers ${salaryRange(input)} and opportunities for growth.`;

  const reqBits: string[] = [];
  if (input.degree) reqBits.push(`Minimum qualification: ${input.degree}${input.specialisation ? ` (${input.specialisation})` : ""}.`);
  reqBits.push(`${experienceLine(input)}.`);
  if (input.skills?.length) reqBits.push(`Key skills: ${input.skills.slice(0, 8).join(", ")}.`);
  const eng = englishLine(input.englishLevel);
  if (eng) reqBits.push(`${eng}.`);
  const gnd = genderLine(input.gender);
  if (gnd) reqBits.push(`${gnd}.`);
  const availability: string[] = [];
  if (input.shift) availability.push(input.shift);
  if (input.workingDays) availability.push(`${input.workingDays}-day working`);
  if (input.assets?.length) availability.push(`own ${input.assets.join("/")}`);
  if (availability.length) reqBits.push(`Available for ${availability.join(", ")}.`);

  const notes: string[] = [];
  if (input.joiningFeeRequired) notes.push("Joining fee applicable");
  if (input.certifications?.length) notes.push(`Certification: ${input.certifications.join(", ")}`);
  if (input.ageMin || input.ageMax) notes.push(`${input.ageMin ?? 18} – ${input.ageMax ?? 45} years preferred`);
  if (input.preferredLanguages?.length) notes.push(`Preferred Language: ${input.preferredLanguages.join(", ")}`);
  if (input.preferredIndustries?.length) notes.push(`Preferred Industry: ${input.preferredIndustries.join(", ")}`);
  if (input.workMode && input.workMode !== "onsite") notes.push(`Work Mode: ${input.workMode === "remote" ? "Remote" : "Hybrid"}`);

  const md: string[] = [];
  md.push(opening, "");
  md.push("**Key Responsibilities:**");
  responsibilities.forEach((r) => md.push(`- ${r}`));
  md.push("");
  md.push("**Job Requirements:**");
  md.push(reqBits.join(" "));
  if (input.perks?.length) {
    md.push("");
    md.push("**Perks:**");
    md.push(input.perks.join(" · "));
  }
  if (notes.length) {
    md.push("");
    md.push("**Notes:**");
    notes.forEach((n) => md.push(`- ${n}`));
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html: string[] = [];
  html.push(`<p>${esc(opening)}</p>`);
  html.push(`<h4>Key Responsibilities</h4><ul>${responsibilities.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`);
  html.push(`<h4>Job Requirements</h4><p>${esc(reqBits.join(" "))}</p>`);
  if (input.perks?.length) html.push(`<h4>Perks</h4><p>${input.perks.map(esc).join(" · ")}</p>`);
  if (notes.length) html.push(`<h4>Notes</h4><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);

  return { markdown: md.join("\n"), html: html.join("") };
}

export function earningPotentialLabel(input: Pick<JdInput, "payType" | "minSalary" | "maxSalary" | "avgIncentive">) {
  if (input.payType !== "fixed_incentive" || !input.avgIncentive) return null;
  const lo = (input.minSalary || 0) + 0;
  const hi = (input.maxSalary || input.minSalary || 0) + input.avgIncentive;
  if (!hi) return null;
  return `Earn up to ${fmtInr(hi)}/month`;
}

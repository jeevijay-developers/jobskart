// Suggestion datasets used across onboarding & profile
export const INDIAN_CITIES = [
  "Mumbai","Delhi","Bengaluru","Hyderabad","Ahmedabad","Chennai","Kolkata","Pune","Jaipur",
  "Lucknow","Kanpur","Nagpur","Indore","Bhopal","Patna","Vadodara","Ghaziabad","Ludhiana",
  "Agra","Nashik","Faridabad","Meerut","Rajkot","Varanasi","Srinagar","Aurangabad","Amritsar",
  "Navi Mumbai","Allahabad","Ranchi","Coimbatore","Vijayawada","Jodhpur","Madurai","Raipur",
  "Kota","Guwahati","Chandigarh","Thiruvananthapuram","Surat",
];

export const SUGGESTED_SKILLS = [
  "Driving","Customer Service","Sales","Cash Handling","MS Office","Tally","Hindi","English",
  "Telecalling","Computer Basics","Inventory","Housekeeping","Cooking","Welding","Electrician",
  "Plumbing","Data Entry","Photography","Carpentry","Security","Forklift","Bike Riding","Delivery",
];

export const SUGGESTED_LANGUAGES = ["Hindi","English","Tamil","Telugu","Marathi","Gujarati","Bengali","Kannada","Malayalam","Punjabi","Odia","Urdu","Bhojpuri"];

/**
 * Role-family -> related job roles, keyed by a keyword matched against
 * whatever the candidate has typed/selected as an interested role. Used to
 * make "Interested job roles" suggestions relevant to what's already
 * selected instead of a single fixed list (skills suggestions already do
 * this dynamically via suggest_skills_for_roles; this is the role-side
 * equivalent, since no role-relatedness data exists in the DB).
 */
export const ROLE_SUGGESTIONS: { keyword: string; roles: string[] }[] = [
  { keyword: "driver", roles: ["Delivery Driver", "Cab Driver", "Commercial Driver", "Personal Driver", "Transport Driver", "Heavy Vehicle Driver"] },
  { keyword: "delivery", roles: ["Delivery Executive", "Delivery Driver", "Delivery Boy", "Courier Executive", "Last Mile Delivery Associate"] },
  { keyword: "sales", roles: ["Sales Executive", "Field Sales Executive", "Sales Associate", "Business Development Executive", "Retail Sales Associate"] },
  { keyword: "telecaller", roles: ["Telecaller", "Telesales Executive", "Customer Support Executive", "Inside Sales Executive"] },
  { keyword: "customer support", roles: ["Customer Support Executive", "Customer Service Associate", "Telecaller", "Call Center Executive"] },
  { keyword: "data entry", roles: ["Data Entry Operator", "Back Office Executive", "Computer Operator"] },
  { keyword: "security", roles: ["Security Guard", "Security Supervisor", "Bouncer"] },
  { keyword: "housekeeping", roles: ["Housekeeping Staff", "Housekeeping Supervisor", "Office Boy"] },
  { keyword: "cook", roles: ["Cook", "Kitchen Helper", "Chef", "Catering Staff"] },
  { keyword: "field", roles: ["Field Sales Executive", "Field Agent", "Delivery Executive", "Collection Agent"] },
  { keyword: "retail", roles: ["Retail Sales Associate", "Store Executive", "Cashier", "Store Manager"] },
  { keyword: "warehouse", roles: ["Warehouse Associate", "Warehouse Supervisor", "Packer", "Inventory Executive"] },
  { keyword: "nurse", roles: ["Staff Nurse", "Nursing Assistant", "Home Care Nurse"] },
  { keyword: "teach", roles: ["Teacher", "Tutor", "Academic Counsellor"] },
  { keyword: "receptionist", roles: ["Receptionist", "Front Office Executive", "Office Assistant"] },
  { keyword: "office assistant", roles: ["Office Assistant", "Back Office Executive", "Receptionist", "Peon"] },
  { keyword: "beautician", roles: ["Beautician", "Hair Stylist", "Salon Assistant"] },
  { keyword: "cashier", roles: ["Cashier", "Billing Executive", "Store Executive"] },
  { keyword: "electric", roles: ["Electrician", "Electrical Technician", "Wireman"] },
  { keyword: "plumb", roles: ["Plumber", "Plumbing Technician"] },
  { keyword: "mechanic", roles: ["Mechanic", "Automobile Technician", "Service Technician"] },
  { keyword: "developer", roles: ["Frontend Developer", "Backend Developer", "Full Stack Developer", "Web Developer", "Software Developer"] },
  { keyword: "engineer", roles: ["Software Engineer", "Support Engineer", "QA Engineer", "DevOps Engineer"] },
  { keyword: "designer", roles: ["Graphic Designer", "UI/UX Designer", "Web Designer"] },
  { keyword: "hr", roles: ["HR Executive", "HR Recruiter", "HR Generalist"] },
  { keyword: "accountant", roles: ["Accountant", "Accounts Executive", "Bookkeeper"] },
  { keyword: "marketing", roles: ["Marketing Executive", "Digital Marketing Executive", "Social Media Executive"] },
];

const DEFAULT_ROLE_SUGGESTIONS = [
  "Sales Executive", "Telecaller", "Customer Support Executive", "Delivery Executive",
  "Data Entry Operator", "Receptionist", "Office Assistant", "Beautician", "Driver", "Cashier",
];

/**
 * Merges related-role suggestions for every selected/typed interested role,
 * de-duplicated and excluding roles already selected. Falls back to the
 * original static starter list when nothing is selected yet.
 */
export function suggestRelatedRoles(selectedRoles: string[]): string[] {
  const selected = selectedRoles.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!selected.length) return DEFAULT_ROLE_SUGGESTIONS;

  const out: string[] = [];
  const seen = new Set<string>(selected);
  for (const role of selected) {
    for (const { keyword, roles } of ROLE_SUGGESTIONS) {
      if (!role.includes(keyword)) continue;
      for (const suggestion of roles) {
        const key = suggestion.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(suggestion);
      }
    }
  }
  return out.length ? out : DEFAULT_ROLE_SUGGESTIONS.filter((r) => !seen.has(r.toLowerCase()));
}

/**
 * Role-family -> relevant skills, same keyword-matching shape as
 * ROLE_SUGGESTIONS above. This is a client-side supplement to the DB/AI-driven
 * suggestSkills server function (which ranks skills by real employer job
 * postings) — it fills in immediately and deterministically for roles that
 * don't yet have matching live job postings, instead of falling through to
 * the fully generic master-list fallback.
 */
export const ROLE_SKILL_SUGGESTIONS: { keyword: string; skills: string[] }[] = [
  { keyword: "driver", skills: ["Defensive Driving", "GPS Navigation", "Traffic Rules Compliance", "Vehicle Maintenance", "Route Planning", "Commercial Driving", "Manual Transmission", "Time Management", "Customer Service"] },
  { keyword: "delivery", skills: ["Route Planning", "GPS Navigation", "Time Management", "Bike Riding", "Customer Service", "Cash Handling", "Order Tracking"] },
  { keyword: "sales", skills: ["Sales", "Negotiation", "Lead Generation", "Customer Relationship Management", "Cold Calling", "Target Achievement", "Communication", "Product Knowledge"] },
  { keyword: "telecaller", skills: ["Telecalling", "Communication", "Cold Calling", "Customer Service", "CRM Software", "Objection Handling"] },
  { keyword: "customer support", skills: ["Customer Service", "Communication", "Problem Solving", "CRM Software", "Patience", "Multitasking"] },
  { keyword: "data entry", skills: ["Data Entry", "MS Excel", "Typing Speed", "Computer Basics", "Attention to Detail"] },
  { keyword: "security", skills: ["Security", "Surveillance", "Access Control", "Incident Reporting", "Physical Fitness"] },
  { keyword: "housekeeping", skills: ["Housekeeping", "Cleaning", "Time Management", "Attention to Detail"] },
  { keyword: "cook", skills: ["Cooking", "Food Safety", "Menu Planning", "Kitchen Management", "Hygiene Practices"] },
  { keyword: "retail", skills: ["Sales", "Cash Handling", "Inventory", "Customer Service", "Visual Merchandising"] },
  { keyword: "warehouse", skills: ["Inventory", "Forklift", "Stock Management", "Packing", "Safety Compliance"] },
  { keyword: "nurse", skills: ["Patient Care", "Medical Terminology", "Vital Signs Monitoring", "First Aid", "Record Keeping"] },
  { keyword: "teach", skills: ["Lesson Planning", "Classroom Management", "Communication", "Subject Expertise", "Student Assessment"] },
  { keyword: "receptionist", skills: ["Front Desk Management", "Communication", "MS Office", "Scheduling", "Customer Service"] },
  { keyword: "office assistant", skills: ["MS Office", "Data Entry", "Filing", "Communication", "Scheduling"] },
  { keyword: "beautician", skills: ["Hair Styling", "Skin Care", "Makeup", "Customer Service", "Hygiene Practices"] },
  { keyword: "cashier", skills: ["Cash Handling", "Billing Software", "Customer Service", "Attention to Detail"] },
  { keyword: "electric", skills: ["Wiring", "Circuit Testing", "Electrical Safety", "Troubleshooting", "Panel Installation"] },
  { keyword: "plumb", skills: ["Pipe Fitting", "Leak Repair", "Blueprint Reading", "Troubleshooting"] },
  { keyword: "mechanic", skills: ["Engine Repair", "Diagnostics", "Vehicle Maintenance", "Troubleshooting", "Hand Tools"] },
  { keyword: "developer", skills: ["JavaScript", "React", "HTML", "CSS", "Git", "API Integration", "TypeScript", "Node.js"] },
  { keyword: "engineer", skills: ["Problem Solving", "Debugging", "Git", "System Design", "Testing"] },
  { keyword: "designer", skills: ["Figma", "Adobe Photoshop", "UI/UX Design", "Typography", "Wireframing"] },
  { keyword: "hr", skills: ["Recruitment", "Talent Acquisition", "Candidate Screening", "Interviewing", "Sourcing", "HRMS / ATS", "Onboarding", "Employee Relations", "Communication"] },
  { keyword: "accountant", skills: ["Tally", "Bookkeeping", "GST Filing", "MS Excel", "Financial Reporting"] },
  { keyword: "marketing", skills: ["Social Media Marketing", "Content Creation", "SEO", "Campaign Management", "Analytics"] },
];

export const DEFAULT_SKILL_SUGGESTIONS = ["Communication", "MS Office", "Customer Service", "Sales", "Hindi", "English"];

/**
 * Merges relevant skills for every selected interested role, de-duplicated.
 * Falls back to the general starter list when no role matches (or none are
 * selected yet) so the field never shows an empty/broken suggestion state.
 */
export function suggestSkillsForRoles(selectedRoles: string[]): string[] {
  const selected = selectedRoles.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!selected.length) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const role of selected) {
    for (const { keyword, skills } of ROLE_SKILL_SUGGESTIONS) {
      if (!role.includes(keyword)) continue;
      for (const skill of skills) {
        const key = skill.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(skill);
      }
    }
  }
  return out.length ? out : DEFAULT_SKILL_SUGGESTIONS;
}

export const ASSETS = [
  { id: "bike", label: "Two-wheeler" },
  { id: "car", label: "Car" },
  { id: "laptop", label: "Laptop" },
  { id: "smartphone", label: "Smartphone" },
  { id: "wifi", label: "WiFi at home" },
];

export const JOB_TYPE_OPTIONS = [
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "contract", label: "Contract" },
  { id: "internship", label: "Internship" },
  { id: "temporary", label: "Temporary" },
];

export const WORK_MODES = [
  { id: "onsite", label: "On-site" },
  { id: "hybrid", label: "Hybrid" },
  { id: "remote", label: "Remote" },
  { id: "field", label: "Field job" },
];

export const EDUCATION_LEVELS = ["10th","12th","Diploma","ITI","Graduate","Post-graduate","Doctorate"];
export const ID_TYPES = ["Aadhaar","PAN","Driving License","Voter ID","Passport"];

export const JOB_CATEGORIES = [
  "Sales","Delivery","Driver","Telecaller","Customer Support","Data Entry","Security",
  "Housekeeping","Cook","Field Agent","Retail","Warehouse","Nursing","Teaching","IT","Other",
];

export const INDUSTRIES = [
  "Retail","E-commerce","Logistics","Manufacturing","Real Estate","Healthcare","Education",
  "IT / Software","Banking & Finance","Hospitality","Food & Beverage","Automobile",
  "Telecom","Media & Advertising","Insurance","Construction","FMCG","Other",
];

export const PERKS = [
  "Flexible Working Hours","Weekly Payout","Overtime Pay","Joining Bonus","Annual Bonus",
  "PF","Travel Allowance (TA)","Petrol Allowance","Mobile Allowance","Internet Allowance",
  "Laptop","Health Insurance","ESI (ESIC)","Food/Meals","Accommodation","5 Working Days",
  "One-Way Cab","Two-Way Cab",
];

export const PAY_TYPES = [
  { id: "fixed", label: "Fixed Only" },
  { id: "fixed_incentive", label: "Fixed + Incentive" },
  { id: "incentive_only", label: "Incentive Only" },
];

export const GENDERS = [
  { id: "any", label: "Any" },
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
];

export const EXPERIENCE_BUCKETS = [
  { id: "any", label: "Any" },
  { id: "fresher", label: "Fresher Only" },
  { id: "experienced", label: "Experienced Only" },
];

export const ENGLISH_LEVELS = [
  { id: "basic", label: "Understands basic English" },
  { id: "good", label: "Understands Good English" },
  { id: "speaks_good", label: "Understands & Speaks Good English" },
];

export const INTERVIEW_TYPES = [
  { id: "in_person", label: "In-person" },
  { id: "telephonic", label: "Telephonic" },
];

export const SHIFTS: { id: string; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
  { id: "rotational", label: "Rotational" },
  { id: "flexible", label: "Flexible" },
];

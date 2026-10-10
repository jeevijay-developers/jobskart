// Role-based resume templates: which roles exist, which template each one recommends, and how a
// role template arranges/labels the (already built) sections. Pure + browser/server-safe, so the
// guided builder, the live preview and the server-side version save all agree.
import type { ResumeSection } from "../schema";

export type RoleCategory = "white" | "blue" | "grey";

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  white: "White-collar",
  blue: "Blue-collar",
  grey: "Grey-collar",
};

export interface ResumeRole {
  id: string;
  label: string;
  category: RoleCategory;
  templateId: string; // recommended template
  // Example wording shown as guidance only - never inserted into the resume automatically.
  summaryExample: string;
  skillHint: string;
}

export const RESUME_ROLES: ResumeRole[] = [
  {
    id: "developer",
    label: "Developer",
    category: "white",
    templateId: "professional",
    summaryExample:
      "Software developer skilled in React and Node.js, with hands-on project experience.",
    skillHint: "Languages, frameworks, databases, tools",
  },
  {
    id: "accountant",
    label: "Accountant",
    category: "white",
    templateId: "professional",
    summaryExample:
      "Accounts professional experienced in Tally, GST filing and monthly reconciliations.",
    skillHint: "Tally, GST, Excel, bookkeeping",
  },
  {
    id: "hr",
    label: "HR Executive",
    category: "white",
    templateId: "professional",
    summaryExample: "HR executive with experience in recruitment, onboarding and employee records.",
    skillHint: "Recruitment, onboarding, payroll basics, MS Office",
  },
  {
    id: "driver",
    label: "Driver",
    category: "blue",
    templateId: "practical",
    summaryExample:
      "Careful driver with a valid licence and experience on city and highway routes.",
    skillHint: "Vehicle types, routes, safe driving, vehicle upkeep",
  },
  {
    id: "delivery",
    label: "Delivery Executive",
    category: "blue",
    templateId: "practical",
    summaryExample: "Reliable delivery executive who knows the local area and delivers on time.",
    skillHint: "Route knowledge, two-wheeler, delivery apps, customer handling",
  },
  {
    id: "warehouse",
    label: "Warehouse Associate",
    category: "blue",
    templateId: "practical",
    summaryExample:
      "Warehouse associate experienced in picking, packing, loading and stock checks.",
    skillHint: "Picking, packing, inventory, forklift, loading",
  },
  {
    id: "electrician",
    label: "Electrician",
    category: "blue",
    templateId: "practical",
    summaryExample: "Electrician experienced in wiring, fault finding and maintenance work.",
    skillHint: "Wiring, fault finding, panels, safety practices",
  },
  {
    id: "security",
    label: "Security Guard",
    category: "blue",
    templateId: "practical",
    summaryExample:
      "Alert security guard experienced in gate duty, patrolling and visitor records.",
    skillHint: "Patrolling, access control, CCTV, first aid",
  },
  {
    id: "field-technician",
    label: "Field / Maintenance Technician",
    category: "grey",
    templateId: "technical",
    summaryExample:
      "Field technician experienced in installation, servicing and repair of equipment.",
    skillHint: "Equipment you service, tools, safety, reporting",
  },
  {
    id: "tech-support",
    label: "Technical Support",
    category: "grey",
    templateId: "technical",
    summaryExample:
      "Support executive experienced in troubleshooting hardware, software and network issues.",
    skillHint: "Troubleshooting, ticketing tools, networking, OS",
  },
];

export function getRole(id: string | null | undefined): ResumeRole | undefined {
  return RESUME_ROLES.find((r) => r.id === id);
}

// Optional extra sections a category usually wants. They become ordinary custom sections
// (resume_drafts.extras.customSections), hidden until the candidate writes something.
export const CATEGORY_EXTRA_SECTIONS: Record<RoleCategory, string[]> = {
  white: ["Projects", "Achievements"],
  blue: [],
  grey: ["Tools & Equipment", "Training"],
};

interface RoleTemplateConfig {
  // Section ids in display order. "custom" stands for every custom-* section.
  order: string[];
  titles: Record<string, string>;
}

const ROLE_TEMPLATE_CONFIG: Record<string, RoleTemplateConfig> = {
  professional: {
    order: [
      "summary",
      "education",
      "experience",
      "custom",
      "skills",
      "certifications",
      "languages",
      "links",
      "hobbies",
    ],
    titles: {},
  },
  practical: {
    order: [
      "summary",
      "skills",
      "certifications",
      "experience",
      "education",
      "languages",
      "custom",
      "links",
      "hobbies",
    ],
    titles: {
      skills: "Key Skills",
      certifications: "Licences & Certifications",
      experience: "Work Experience",
    },
  },
  technical: {
    order: [
      "summary",
      "skills",
      "experience",
      "certifications",
      "custom",
      "education",
      "languages",
      "links",
      "hobbies",
    ],
    titles: { skills: "Technical Skills", certifications: "Training & Certifications" },
  },
};

/**
 * Arrange and label sections for a role template. Templates without a config (Classic ATS,
 * Modern) are returned untouched. Empty sections never exist here, so nothing empty is shown.
 */
export function applyRoleTemplate(sections: ResumeSection[], templateId: string): ResumeSection[] {
  const config = ROLE_TEMPLATE_CONFIG[templateId];
  if (!config) return sections;
  const rank = (s: ResumeSection) => {
    const i = config.order.indexOf(s.id.startsWith("custom-") ? "custom" : s.id);
    return i < 0 ? config.order.length : i;
  };
  return sections
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.idx - b.idx)
    .map(({ s }) => (config.titles[s.id] ? { ...s, title: config.titles[s.id] } : s));
}

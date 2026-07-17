// JD library — per-role templates matching the "Final JD Format" spec.
// Each role: 2-line summary + list of Skill → Responsibility pairs.
// The wizard picks the closest role and renders responsibilities for the
// skills the employer selected.

import sheetTemplates from "./jd-library-sheet.json";

export type SkillResponsibility = { skill: string; responsibility: string };

export type RoleTemplate = {
  title: string;
  industry: string;
  summary: [string, string];
  /** Optional 1:1 skill→responsibility mapping (used by curated roles). */
  skills: SkillResponsibility[];
  /** Optional bulk skill-based responsibility bullets (from JD sheet). */
  skillResponsibilities?: string[];
  /** Fixed responsibilities appended after skill-based ones. */
  fixedResponsibilities?: string[];
  /** Flat skill chip list (from JD sheet) when per-skill mapping isn't available. */
  skillList?: string[];
};

type SheetRow = {
  title: string;
  industry: string;
  summary: [string, string];
  skillList: string[];
  skillResponsibilities: string[];
  fixedResponsibilities: string[];
};

const SHEET_TEMPLATES: RoleTemplate[] = (sheetTemplates as SheetRow[]).map((r) => ({
  title: r.title,
  industry: r.industry,
  summary: [r.summary[0] || "", r.summary[1] || ""] as [string, string],
  skills: r.skillList.map((s) => ({ skill: s, responsibility: `Handle day-to-day tasks related to ${s}.` })),
  skillResponsibilities: r.skillResponsibilities,
  fixedResponsibilities: r.fixedResponsibilities,
  skillList: r.skillList,
}));

const CURATED: RoleTemplate[] = [
  {
    title: "HR Recruiter",
    industry: "Recruitment & Staffing",
    summary: [
      "Join our growing HR team to identify, attract, and hire talented professionals across multiple functions.",
      "You will manage the complete recruitment lifecycle, coordinate with hiring managers, and ensure an excellent candidate experience.",
    ],
    skills: [
      { skill: "Calling", responsibility: "Conduct telephonic interviews and initial HR screening rounds." },
      { skill: "Follow-up", responsibility: "Follow up with candidates throughout the recruitment process." },
      { skill: "ATS", responsibility: "Maintain candidate records in ATS and recruitment trackers." },
      { skill: "Job Posting", responsibility: "Publish and manage job postings across multiple hiring platforms." },
      { skill: "Documentation", responsibility: "Collect and verify candidate documents before joining." },
      { skill: "Offer", responsibility: "Prepare and communicate offer letters to selected candidates." },
      { skill: "Employer Branding", responsibility: "Promote job openings through social media and employer branding initiatives." },
      { skill: "Pipeline", responsibility: "Build and maintain a strong talent pipeline for future hiring needs." },
      { skill: "Stakeholder Management", responsibility: "Coordinate with department heads to understand manpower requirements." },
      { skill: "Reports", responsibility: "Prepare recruitment reports and hiring dashboards." },
      { skill: "Compliance", responsibility: "Ensure recruitment processes comply with company policies." },
      { skill: "Bulk Hiring", responsibility: "Handle mass hiring drives for blue-collar and white-collar positions." },
    ],
  },
  {
    title: "Sales Executive",
    industry: "Sales & Business Development",
    summary: [
      "Drive revenue growth by acquiring new customers and building long-term client relationships across your assigned territory.",
      "You will own the full sales cycle — from prospecting and pitching to closure and post-sale follow-up.",
    ],
    skills: [
      { skill: "Lead Generation", responsibility: "Identify and qualify new business leads from calls, walk-ins and referrals." },
      { skill: "Cold Calling", responsibility: "Make outbound calls to prospective customers and pitch products/services." },
      { skill: "Field Visits", responsibility: "Meet clients on the field to demonstrate products and close deals." },
      { skill: "Negotiation", responsibility: "Negotiate pricing and commercial terms within approved limits." },
      { skill: "Target Achievement", responsibility: "Achieve monthly and quarterly sales targets consistently." },
      { skill: "CRM", responsibility: "Log leads, follow-ups and closures accurately in the CRM." },
      { skill: "Product Demo", responsibility: "Explain features, benefits and pricing clearly to prospects." },
      { skill: "Follow-up", responsibility: "Follow up on open opportunities until closure or drop." },
      { skill: "Customer Retention", responsibility: "Maintain relationships with existing clients for repeat business." },
      { skill: "Reporting", responsibility: "Share daily sales reports with the reporting manager." },
    ],
  },
  {
    title: "Delivery Executive",
    industry: "Logistics & Delivery",
    summary: [
      "Deliver customer orders on time, safely and with a great on-ground experience.",
      "You'll follow app-assigned routes, handle payments where required, and represent our brand at every doorstep.",
    ],
    skills: [
      { skill: "Bike Riding", responsibility: "Ride a two-wheeler safely across assigned delivery zones." },
      { skill: "Navigation", responsibility: "Use the delivery app and maps to reach addresses efficiently." },
      { skill: "Customer Service", responsibility: "Interact politely with customers at every delivery point." },
      { skill: "Cash Handling", responsibility: "Collect and remit cash-on-delivery payments accurately." },
      { skill: "Time Management", responsibility: "Complete all assigned deliveries within promised time slots." },
      { skill: "App Usage", responsibility: "Update order status in the app in real time." },
      { skill: "Vehicle Upkeep", responsibility: "Maintain the delivery vehicle in clean, working condition." },
      { skill: "Route Planning", responsibility: "Plan the shortest route to reduce delivery time and fuel." },
      { skill: "Documentation", responsibility: "Verify invoices, POD and customer signatures on delivery." },
      { skill: "Safety", responsibility: "Follow all traffic rules and wear safety gear at all times." },
    ],
  },
  {
    title: "Telecaller",
    industry: "BPO & Customer Service",
    summary: [
      "Speak with customers over the phone to convert leads, resolve queries and build trust in the brand.",
      "You will handle inbound and outbound calls following defined scripts and daily call targets.",
    ],
    skills: [
      { skill: "Outbound Calling", responsibility: "Make outbound calls to prospective and existing customers." },
      { skill: "Inbound Calling", responsibility: "Attend inbound customer calls and resolve queries end-to-end." },
      { skill: "Script Handling", responsibility: "Follow approved calling scripts while personalising conversations." },
      { skill: "Lead Conversion", responsibility: "Convert warm leads into confirmed customers." },
      { skill: "Follow-up", responsibility: "Follow up with interested customers as per the schedule." },
      { skill: "CRM", responsibility: "Log every call outcome and next action into the CRM." },
      { skill: "Objection Handling", responsibility: "Respond confidently to common objections and doubts." },
      { skill: "Language Fluency", responsibility: "Communicate clearly in the required language(s)." },
      { skill: "Reports", responsibility: "Share daily call and conversion reports with the team lead." },
      { skill: "Compliance", responsibility: "Follow calling guidelines and DND regulations strictly." },
    ],
  },
  {
    title: "Field Sales Executive",
    industry: "Sales & Business Development",
    summary: [
      "Grow the business by meeting customers directly at their location and closing deals on the ground.",
      "You will cover an assigned territory, build local relationships and consistently hit monthly targets.",
    ],
    skills: [
      { skill: "Field Visits", responsibility: "Visit assigned customers and prospects daily." },
      { skill: "Lead Generation", responsibility: "Generate fresh leads through market walks and referrals." },
      { skill: "Product Demo", responsibility: "Demonstrate products on-site and answer customer questions." },
      { skill: "Order Booking", responsibility: "Book orders and coordinate delivery timelines." },
      { skill: "Payment Collection", responsibility: "Collect outstanding payments from assigned accounts." },
      { skill: "Route Planning", responsibility: "Plan daily beat plans for maximum territory coverage." },
      { skill: "Reporting", responsibility: "Update sales activity in the app or CRM daily." },
      { skill: "Relationship Building", responsibility: "Build long-term relationships with retailers and distributors." },
      { skill: "Target Achievement", responsibility: "Consistently meet monthly primary and secondary sales targets." },
      { skill: "Market Intelligence", responsibility: "Share competitor activity and market feedback with the manager." },
    ],
  },
  {
    title: "Data Entry Operator",
    industry: "IT & Software",
    summary: [
      "Keep our records accurate and up to date by entering, verifying and organising business data every day.",
      "You will work across spreadsheets, internal tools and portals with a strong focus on quality and speed.",
    ],
    skills: [
      { skill: "Typing", responsibility: "Enter data accurately with a high typing speed." },
      { skill: "MS Excel", responsibility: "Maintain and update data across Excel workbooks." },
      { skill: "Data Verification", responsibility: "Cross-verify entries to eliminate errors and duplicates." },
      { skill: "Documentation", responsibility: "Digitise and file physical documents in the right folders." },
      { skill: "Reports", responsibility: "Generate periodic MIS reports for internal teams." },
      { skill: "Portal Updates", responsibility: "Upload records to internal or client portals as required." },
      { skill: "Confidentiality", responsibility: "Handle sensitive business data with strict confidentiality." },
      { skill: "Follow-up", responsibility: "Follow up with teams for missing or unclear information." },
      { skill: "Attention to Detail", responsibility: "Ensure every field is filled correctly before submission." },
      { skill: "Backups", responsibility: "Maintain regular backups of critical data files." },
    ],
  },
  {
    title: "Customer Support Executive",
    industry: "BPO & Customer Service",
    summary: [
      "Be the voice of the company — help customers resolve issues quickly and leave every interaction happier than before.",
      "You will handle queries across calls, chat and email while maintaining high CSAT and SLA.",
    ],
    skills: [
      { skill: "Call Handling", responsibility: "Attend customer calls and resolve queries end-to-end." },
      { skill: "Chat Support", responsibility: "Handle multiple customer chats simultaneously with quick TAT." },
      { skill: "Email Support", responsibility: "Respond to customer emails in a clear, professional tone." },
      { skill: "Issue Resolution", responsibility: "Diagnose and resolve customer complaints on first contact." },
      { skill: "Escalation", responsibility: "Escalate complex issues to the right team with proper context." },
      { skill: "CRM", responsibility: "Log every interaction and resolution in the CRM." },
      { skill: "Product Knowledge", responsibility: "Stay updated on product features and policies." },
      { skill: "CSAT", responsibility: "Maintain a high CSAT score across all interactions." },
      { skill: "Follow-up", responsibility: "Follow up on unresolved tickets until closure." },
      { skill: "Feedback", responsibility: "Share recurring issues and customer feedback with the team." },
    ],
  },
  {
    title: "Driver",
    industry: "Logistics & Delivery",
    summary: [
      "Safely drive assigned vehicles to transport goods or people as per daily schedules.",
      "You will follow all traffic and safety rules while maintaining the vehicle in good condition.",
    ],
    skills: [
      { skill: "Safe Driving", responsibility: "Drive vehicles safely and follow all traffic regulations." },
      { skill: "Route Knowledge", responsibility: "Know the assigned routes and use GPS when needed." },
      { skill: "Vehicle Upkeep", responsibility: "Perform daily checks and basic maintenance of the vehicle." },
      { skill: "Documentation", responsibility: "Keep vehicle papers, licence and insurance updated." },
      { skill: "Punctuality", responsibility: "Reach pickup and drop points on time, every time." },
      { skill: "Customer Handling", responsibility: "Behave courteously with passengers or delivery contacts." },
      { skill: "Fuel Management", responsibility: "Track fuel consumption and submit accurate bills." },
      { skill: "Emergency Handling", responsibility: "Respond calmly to breakdowns or on-road emergencies." },
      { skill: "Cleanliness", responsibility: "Keep the vehicle interior and exterior clean." },
      { skill: "Reporting", responsibility: "Report accidents, damages or issues immediately." },
    ],
  },
  {
    title: "Cashier",
    industry: "Retail",
    summary: [
      "Handle billing and payments at the store while giving every customer a fast, friendly checkout experience.",
      "You will operate the POS system, manage cash and card transactions, and reconcile at end of day.",
    ],
    skills: [
      { skill: "POS", responsibility: "Operate the POS system and bill customers accurately." },
      { skill: "Cash Handling", responsibility: "Handle cash transactions and maintain the till balance." },
      { skill: "Card Payments", responsibility: "Process card and UPI payments smoothly." },
      { skill: "Refunds", responsibility: "Process refunds and exchanges as per store policy." },
      { skill: "Customer Service", responsibility: "Greet customers and resolve billing queries politely." },
      { skill: "Reconciliation", responsibility: "Reconcile cash and card sales at end of every shift." },
      { skill: "Loyalty Programs", responsibility: "Enrol customers in loyalty programs during checkout." },
      { skill: "Discount Management", responsibility: "Apply discounts, offers and coupons correctly." },
      { skill: "Reports", responsibility: "Generate daily sales and cash reports for the manager." },
      { skill: "Store Standards", responsibility: "Keep the billing counter clean and organised." },
    ],
  },
  {
    title: "Store Manager",
    industry: "Retail",
    summary: [
      "Run the store end-to-end — from customer experience and team management to sales and inventory.",
      "You will lead a small team, hit revenue targets and keep the store looking sharp every day.",
    ],
    skills: [
      { skill: "Team Management", responsibility: "Manage rosters, attendance and daily briefings for the store team." },
      { skill: "Sales Targets", responsibility: "Own the store's monthly sales and conversion targets." },
      { skill: "Customer Experience", responsibility: "Ensure every customer has a great in-store experience." },
      { skill: "Inventory Management", responsibility: "Manage inventory levels, indents and stock audits." },
      { skill: "Visual Merchandising", responsibility: "Maintain store displays as per brand guidelines." },
      { skill: "Cash Management", responsibility: "Oversee daily cash reconciliation and banking." },
      { skill: "Reporting", responsibility: "Send daily sales, footfall and issue reports to the region head." },
      { skill: "Training", responsibility: "Train new joiners on product, POS and customer service." },
      { skill: "Loss Prevention", responsibility: "Enforce loss-prevention checks and CCTV monitoring." },
      { skill: "Escalation", responsibility: "Handle escalations from customers and staff professionally." },
    ],
  },
  {
    title: "Beautician",
    industry: "Beauty & Wellness",
    summary: [
      "Delight clients with high-quality beauty services in a warm, hygienic and welcoming environment.",
      "You will perform a range of services, recommend the right treatments and build a loyal client base.",
    ],
    skills: [
      { skill: "Facials", responsibility: "Perform facials and skin treatments as per client requirement." },
      { skill: "Waxing", responsibility: "Perform waxing services with hygiene and comfort." },
      { skill: "Threading", responsibility: "Provide threading services with precision and speed." },
      { skill: "Hair Care", responsibility: "Perform basic hair care services like wash, spa and head massage." },
      { skill: "Makeup", responsibility: "Do occasion and party makeup as per client preferences." },
      { skill: "Manicure & Pedicure", responsibility: "Perform manicure and pedicure services." },
      { skill: "Client Consultation", responsibility: "Recommend services and products suited to each client." },
      { skill: "Hygiene", responsibility: "Maintain hygiene of tools, products and the workstation." },
      { skill: "Retail", responsibility: "Upsell relevant beauty products post-service." },
      { skill: "Client Retention", responsibility: "Build long-term relationships to bring clients back." },
    ],
  },
];

/** Curated templates take precedence; sheet-imported ones fill the long tail. */
export const JD_LIBRARY: RoleTemplate[] = [
  ...CURATED,
  ...SHEET_TEMPLATES.filter(
    (s) => !CURATED.some((c) => c.title.toLowerCase() === s.title.toLowerCase()),
  ),
];


function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Best-effort role match by title, then industry, then null. */
export function findRoleTemplate(title?: string, industry?: string): RoleTemplate | null {
  const t = norm(title || "");
  const i = norm(industry || "");
  if (t) {
    const exact = JD_LIBRARY.find((r) => norm(r.title) === t);
    if (exact) return exact;
    const contains = JD_LIBRARY.find((r) => t.includes(norm(r.title)) || norm(r.title).includes(t));
    if (contains) return contains;
  }
  if (i) {
    const byInd = JD_LIBRARY.find((r) => norm(r.industry) === i);
    if (byInd) return byInd;
  }
  return null;
}

/** Suggested skills for a role — used to power a one-tap chip strip. */
export function suggestedSkillsFor(title?: string, industry?: string): string[] {
  const tpl = findRoleTemplate(title, industry);
  return tpl ? tpl.skills.map((s) => s.skill) : [];
}

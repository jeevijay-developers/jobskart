import { Link } from "@tanstack/react-router";
import { Facebook, Instagram, Linkedin, ShieldCheck, Twitter, Youtube } from "lucide-react";
import logoAsset from "@/assets/jobskart-logo.png";

type FooterLink = { label: string; to?: "/learn" | "/jobs"; search?: Record<string, string> };

const cols: { title: string; links: FooterLink[] }[] = [
  {
    title: "Top Job Roles",
    links: [
      { label: "Delivery Associate", to: "/jobs", search: { category: "Delivery" } },
      { label: "Telecaller & BPO", to: "/jobs", search: { category: "Telecaller" } },
      { label: "Retail Executive", to: "/jobs", search: { category: "Retail" } },
      { label: "Warehouse Operations", to: "/jobs", search: { category: "Warehouse" } },
      { label: "Field Sales Representative", to: "/jobs", search: { category: "Field Agent" } },
      { label: "Security & Facility Staff", to: "/jobs", search: { category: "Security" } },
    ],
  },
  {
    title: "Cities Across India",
    links: [
      { label: "Jobs in Bengaluru", to: "/jobs", search: { city: "Bengaluru" } },
      { label: "Jobs in Delhi NCR", to: "/jobs", search: { city: "Delhi" } },
      { label: "Jobs in Mumbai", to: "/jobs", search: { city: "Mumbai" } },
      { label: "Jobs in Hyderabad", to: "/jobs", search: { city: "Hyderabad" } },
      { label: "Jobs in Pune", to: "/jobs", search: { city: "Pune" } },
      { label: "Jobs in Ahmedabad & Tier-2", to: "/jobs", search: { city: "Ahmedabad" } },
    ],
  },
  {
    title: "Candidate Resources",
    links: [
      { label: "Resume Builder (Instant)" },
      { label: "Interview Preparation Tips", to: "/learn" },
      { label: "Free Skill Certifications", to: "/learn" },
      { label: "Salary Benchmark Tool" },
      { label: "Download Mobile App" },
    ],
  },
  {
    title: "Employer Solutions",
    links: [
      { label: "Post a Job (Free)" },
      { label: "Bulk Hiring Engine" },
      { label: "Candidate Verification API" },
      { label: "Enterprise ATS Integration" },
      { label: "Staffing Agency Portal" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div>
            <div className="inline-flex items-center rounded-xl bg-white px-3 py-2">
              <img src={logoAsset} alt="JobsKart" className="h-7 w-auto" />
            </div>

            <p className="mt-4 max-w-sm text-sm text-white/70">
              India's trusted hiring and recruitment platform for field, industrial, retail, and
              grey-collar professionals.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {[Facebook, Twitter, Instagram, Linkedin, Youtube].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition-colors hover:bg-primary"
                  aria-label="social"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
            <p className="mt-6 flex items-center gap-1.5 text-xs font-medium text-white/70">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
              100% Free Candidate Verification
            </p>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-white">
                {c.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {c.links.map((l) =>
                  l.to ? (
                    <li key={l.label}>
                      <Link
                        to={l.to}
                        search={l.search as never}
                        className="text-sm text-white/70 transition-colors hover:text-white"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <a
                        href="#"
                        className="text-sm text-white/70 transition-colors hover:text-white"
                      >
                        {l.label}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row sm:items-center">
          <p>
            © {new Date().getFullYear()} JobsKart Technologies Pvt. Ltd. All rights reserved.
            Registered under Ministry of Labour & Employment.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a href="#" className="hover:text-white">Privacy Policy</a>
            <a href="#" className="hover:text-white">Terms of Service</a>
            <a href="#" className="hover:text-white">Trust & Safety</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

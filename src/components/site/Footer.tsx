import { Facebook, Instagram, Linkedin, Twitter, Youtube } from "lucide-react";

const cols = [
  {
    title: "For Candidates",
    links: ["Browse Jobs", "Job Categories", "Career Advice", "Resume Tips", "Salary Guide"],
  },
  {
    title: "For Employers",
    links: ["Post a Job", "Browse Candidates", "Pricing & Plans", "Hiring Solutions", "Enterprise"],
  },
  {
    title: "Company",
    links: ["About Us", "Careers", "Press", "Contact", "Help Center"],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-lg font-bold">
                J
              </div>
              <span className="text-xl font-bold">JobsKart</span>
            </div>
            <p className="mt-4 max-w-sm text-sm text-white/70">
              India's #1 blue-collar and grey-collar hiring platform. Connecting 50 lakh+
              candidates with 1000+ verified employers across 500+ cities.
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
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-white">
                {c.title}
              </h4>
              <ul className="mt-4 space-y-3">
                {c.links.map((l) => (
                  <li key={l}>
                    <a
                      href="#"
                      className="text-sm text-white/70 transition-colors hover:text-white"
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} JobsKart Technologies Pvt. Ltd. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-4">
            <a href="#" className="hover:text-white">Privacy Policy</a>
            <a href="#" className="hover:text-white">Terms of Service</a>
            <a href="#" className="hover:text-white">Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import logoAsset from "@/assets/jobskart-logo.png.asset.json";

interface Props {
  children: ReactNode;
  side?: "candidate" | "employer";
  title?: string;
  tagline?: string;
}

const sidePresets = {
  candidate: {
    title: "Find your dream job",
    tagline:
      "10 lakh+ verified openings across India — driver, delivery, sales, telecaller and more.",
    bullets: [
      "Apply with one click — no resume needed",
      "Chat directly with employers",
      "Get jobs near your home, in your language",
    ],
  },
  employer: {
    title: "Hire faster with JobsKart",
    tagline:
      "Reach 50 lakh+ active blue-collar and grey-collar candidates with AI-powered matching.",
    bullets: [
      "Smart job posting wizard with quality score",
      "AI-recommended candidates for every role",
      "Unlock verified contacts and hire in days",
    ],
  },
} as const;

export function AuthShell({ children, side = "candidate" }: Props) {
  const preset = sidePresets[side];
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary-light via-background to-success-light p-12 lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 bottom-0 h-64 w-64 rounded-full bg-success/15 blur-3xl"
        />

        <Link to="/" className="relative inline-flex items-center gap-2">
          <img src={logoAsset.url} alt="JobsKart" className="h-9 w-auto" />
        </Link>

        <div className="relative mt-auto">
          <h2 className="text-3xl font-bold text-foreground">{preset.title}</h2>
          <p className="mt-3 max-w-md text-base text-muted-foreground">{preset.tagline}</p>
          <ul className="mt-8 space-y-3">
            {preset.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 text-sm text-foreground/80">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-10 text-xs text-muted-foreground">
          © {new Date().getFullYear()} JobsKart Technologies · India's #1 blue-collar hiring platform
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border bg-background px-6 py-4 lg:hidden">
          <Link to="/" className="inline-flex items-center gap-2">
            <img src={logoAsset.url} alt="JobsKart" className="h-7 w-auto" />
          </Link>
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            ← Home
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}

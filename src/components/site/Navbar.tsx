import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import logoAsset from "@/assets/jobskart-logo.png.asset.json";

const navLinks = [
  { label: "Jobs", to: "/" },
  { label: "For Employers", to: "/" },
  { label: "Candidates", to: "/" },
  { label: "Resources", to: "/" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <img src={logoAsset.url} alt="JobsKart" className="h-8 w-auto" />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {navLinks.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <button className="inline-flex h-10 items-center justify-center rounded-lg border border-primary px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-light">
            Employer Login
          </button>
          <button className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark">
            Candidate Login
          </button>
        </div>

        <button
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground lg:hidden"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col bg-background p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <img src={logoAsset.url} alt="JobsKart" className="h-7 w-auto" />
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <nav className="mt-8 flex flex-col gap-1">
              {navLinks.map((l) => (
                <Link
                  key={l.label}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-surface"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-3 pt-6">
              <button className="inline-flex h-11 items-center justify-center rounded-lg border border-primary text-sm font-semibold text-primary">
                Employer Login
              </button>
              <button className="inline-flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                Candidate Login
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

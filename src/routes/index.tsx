import { createFileRoute } from "@tanstack/react-router";
import {
  Search,
  MapPin,
  Briefcase,
  Car,
  Truck,
  Headphones,
  Phone,
  Package,
  Sparkles,
  ChefHat,
  Store,
  UserCheck,
  HeartPulse,
  GraduationCap,
  Shield,
  ChevronRight,
  Star,
  CheckCircle2,
  UserPlus,
  FileSearch,
  Trophy,
  ClipboardList,
  Users,
  Rocket,
  Smartphone,
} from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JobsKart — Find Jobs or Hire Talent | India's #1 Blue Collar Platform" },
      {
        name: "description",
        content:
          "Search 10 lakh+ jobs across India — driver, delivery, sales, security, telecaller, warehouse and more. Trusted by 1000+ enterprises and 5 lakh+ MSMEs for blue-collar hiring.",
      },
      {
        property: "og:title",
        content: "JobsKart — India's #1 Blue Collar Hiring Platform",
      },
      {
        property: "og:description",
        content: "10 lakh+ jobs · 50 lakh+ candidates · 500+ cities. Hire in days, not weeks.",
      },
    ],
  }),
  component: LandingPage,
});

/* ---------------------------------------------------------------- */

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <TrustStrip />
        <PopularSearches />
        <BrowseCategories />
        <HowItWorks />
        <StatsBanner />
        <Testimonials />
        <AppDownload />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Hero() {
  const popularTags = [
    "Work from Home",
    "Fresher Jobs",
    "Part Time",
    "Driver Jobs",
    "Security Guard",
    "Delivery Boy",
  ];

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background via-background to-primary-light">
      {/* gradient blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-20 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(167,139,250,0.45), rgba(74,222,128,0.15), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(26,85,189,0.35), transparent)" }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:gap-8 lg:py-24 lg:px-8">
        <div className="lg:col-span-7">
          <span className="inline-flex items-center rounded-full bg-primary-light px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            India's #1 Blue Collar Hiring Platform
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[52px]">
            Your job search <span className="text-primary">ends here</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Discover 10 lakh+ career opportunities across India — from your city, in your language,
            on your schedule.
          </p>

          {/* Search bar */}
          <div className="mt-8 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-card)] sm:rounded-full">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 rounded-xl px-4 py-3 sm:rounded-full">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="Search jobs by title, skill..."
                />
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex items-center gap-2 px-4 py-3 sm:px-3">
                <Briefcase className="h-5 w-5 shrink-0 text-muted-foreground" />
                <select className="w-full bg-transparent text-sm outline-none">
                  <option>Your Experience</option>
                  <option>Fresher</option>
                  <option>0 - 1 year</option>
                  <option>1 - 3 years</option>
                  <option>3 - 5 years</option>
                  <option>5+ years</option>
                </select>
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex flex-1 items-center gap-2 px-4 py-3 sm:px-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="Search for an area, city..."
                />
              </label>
              <button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-dark sm:rounded-full">
                <Search className="h-4 w-4" />
                Search Jobs
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Popular:</span>
            {popularTags.map((t) => (
              <button
                key={t}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary hover:bg-primary-light hover:text-primary"
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Hero illustration */}
        <div className="relative lg:col-span-5">
          <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-br from-primary-light to-success-light shadow-[var(--shadow-card)]">
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center text-muted-foreground">
                <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-white/70">
                  <Smartphone className="h-12 w-12 text-primary" />
                </div>
                <p className="mt-4 text-sm font-medium">Hero image</p>
                <p className="text-xs">Professional with phone</p>
              </div>
            </div>
            {/* Floating stat cards */}
            <div className="absolute left-4 top-6 rounded-xl border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-success-light text-success">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold">2,500+ hires</p>
                  <p className="text-[10px] text-muted-foreground">this week</p>
                </div>
              </div>
            </div>
            <div className="absolute bottom-6 right-4 rounded-xl border border-border bg-card px-3 py-2 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-light text-primary">
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold">10 Lakh+ jobs</p>
                  <p className="text-[10px] text-muted-foreground">across India</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

function TrustStrip() {
  return (
    <section className="border-y border-border bg-background py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Proud to Support
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {["Skill India", "MSME", "Startup India"].map((n) => (
                <div
                  key={n}
                  className="grid h-12 min-w-[110px] place-items-center rounded-lg border border-border bg-surface px-3 text-[11px] font-semibold text-muted-foreground"
                >
                  {n}
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-9">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Trusted by 1000+ Enterprises and 5 lakh+ MSMEs for hiring
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {["TATA", "BigBasket", "Blinkit", "Reliance", "Zomato", "Swiggy"].map((n) => (
                <div
                  key={n}
                  className="grid h-12 place-items-center rounded-lg border border-border bg-surface text-[11px] font-bold text-muted-foreground"
                >
                  {n}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

const popularSearches = [
  { rank: 1, title: "Jobs for Freshers", desc: "Kickstart your career" },
  { rank: 2, title: "Work from Home Jobs", desc: "Earn from anywhere" },
  { rank: 3, title: "Part Time Jobs", desc: "Flexible hours" },
  { rank: 4, title: "Driver Jobs", desc: "Cab, truck & delivery" },
  { rank: 5, title: "Women Jobs", desc: "Safe & verified roles" },
  { rank: 6, title: "Full Time Jobs", desc: "Stable monthly income" },
];

function PopularSearches() {
  return (
    <section className="bg-surface py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Popular Searches on JobsKart
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              Hire the best talent or find your next opportunity — our most-searched categories
              this month.
            </p>
            <button className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-dark">
              View all categories <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-8 lg:grid-cols-3">
            {popularSearches.map((s) => (
              <a
                key={s.title}
                href="#"
                className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
              >
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Trending at #{s.rank}
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-1.5">
                    View all <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                  <Briefcase className="h-5 w-5" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

const categories = [
  { name: "Security", icon: Shield, tone: "bg-blue-50 text-blue-600" },
  { name: "Driver", icon: Car, tone: "bg-amber-50 text-amber-600" },
  { name: "Delivery", icon: Truck, tone: "bg-green-50 text-green-600" },
  { name: "Sales", icon: Briefcase, tone: "bg-purple-50 text-purple-600" },
  { name: "Telecaller", icon: Headphones, tone: "bg-pink-50 text-pink-600" },
  { name: "Warehouse", icon: Package, tone: "bg-orange-50 text-orange-600" },
  { name: "Housekeeping", icon: Sparkles, tone: "bg-teal-50 text-teal-600" },
  { name: "Cook", icon: ChefHat, tone: "bg-red-50 text-red-600" },
  { name: "Retail", icon: Store, tone: "bg-indigo-50 text-indigo-600" },
  { name: "Field Agent", icon: UserCheck, tone: "bg-cyan-50 text-cyan-600" },
  { name: "Nurse", icon: HeartPulse, tone: "bg-rose-50 text-rose-600" },
  { name: "Teacher", icon: GraduationCap, tone: "bg-violet-50 text-violet-600" },
];

function BrowseCategories() {
  return (
    <section className="bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Browse Jobs by Category
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Pick a role you love — over 50 specialisations to explore.
            </p>
          </div>
          <a href="#" className="hidden items-center gap-1 text-sm font-semibold text-primary sm:inline-flex">
            See all <ChevronRight className="h-4 w-4" />
          </a>
        </div>

        <div className="mt-8 flex gap-4 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-6">
          {categories.map((c) => (
            <a
              key={c.name}
              href="#"
              className="group flex min-w-[140px] flex-col items-center gap-3 rounded-xl border border-border bg-card p-5 text-center shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/30"
            >
              <div className={`grid h-14 w-14 place-items-center rounded-full ${c.tone}`}>
                <c.icon className="h-6 w-6" />
              </div>
              <span className="text-sm font-semibold text-foreground">{c.name}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

const candidateSteps = [
  { icon: UserPlus, title: "Create Profile", desc: "Sign up in under 2 minutes with your mobile and basic details." },
  { icon: FileSearch, title: "Search & Apply", desc: "Find jobs near you and apply in one click — no resume needed." },
  { icon: Trophy, title: "Get Hired", desc: "Speak directly with the HR and start earning faster." },
];
const employerSteps = [
  { icon: ClipboardList, title: "Post a Job", desc: "Use our smart 4-step posting wizard with AI-powered suggestions." },
  { icon: Users, title: "Review Candidates", desc: "Get AI-recommended matches plus your applied pool in one inbox." },
  { icon: Rocket, title: "Hire Faster", desc: "Unlock contacts, message, and shortlist in a single dashboard." },
];

function HowItWorks() {
  return (
    <section className="bg-gradient-to-br from-primary-light via-background to-success-light py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How JobsKart works
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-muted-foreground">
            Whether you're hunting your next role or building a team, we make it ridiculously
            simple.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <StepColumn title="For Candidates" tone="primary" steps={candidateSteps} />
          <StepColumn title="For Employers" tone="success" steps={employerSteps} />
        </div>
      </div>
    </section>
  );
}

function StepColumn({
  title,
  tone,
  steps,
}: {
  title: string;
  tone: "primary" | "success";
  steps: { icon: React.ComponentType<{ className?: string }>; title: string; desc: string }[];
}) {
  const accent =
    tone === "primary"
      ? "bg-primary text-primary-foreground"
      : "bg-success text-success-foreground";
  const ring = tone === "primary" ? "ring-primary/20" : "ring-success/20";

  return (
    <div className={`rounded-2xl bg-card p-6 shadow-[var(--shadow-card)] ring-1 ${ring} sm:p-8`}>
      <h3 className="text-xl font-bold text-foreground">{title}</h3>
      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-4">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${accent}`}>
              {i + 1}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <s.icon className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-base font-semibold text-foreground">{s.title}</h4>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function StatsBanner() {
  const stats = [
    { v: "10 Lakh+", l: "Active Jobs" },
    { v: "50 Lakh+", l: "Candidates" },
    { v: "1000+", l: "Employers" },
    { v: "500+", l: "Cities" },
  ];
  return (
    <section className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-14">
        <div className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.l}>
              <p className="text-3xl font-extrabold sm:text-4xl">{s.v}</p>
              <p className="mt-1 text-sm font-medium text-primary-foreground/80">{s.l}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

const testimonials = [
  {
    name: "Rahul Sharma",
    role: "Delivery Executive · Mumbai",
    quote:
      "I got 3 interview calls within a week of creating my JobsKart profile. Landed a job paying ₹22,000/month near my home.",
    initials: "RS",
  },
  {
    name: "Priya Verma",
    role: "HR Manager · BrightMart Retail",
    quote:
      "We hired 28 store associates in 11 days using the AI Recommended tab. The candidate quality is genuinely better than other portals.",
    initials: "PV",
  },
  {
    name: "Mohammad Iqbal",
    role: "Security Supervisor · Bengaluru",
    quote:
      "Simple Hindi interface, OTP login, and jobs filtered by my locality. JobsKart respects how blue-collar workers actually search.",
    initials: "MI",
  },
];

function Testimonials() {
  return (
    <section className="bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            What our users say
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Real stories from candidates and employers across India.
          </p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {testimonials.map((t) => (
            <figure
              key={t.name}
              className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
            >
              <div className="flex items-center gap-1 text-warning">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-foreground/80">
                "{t.quote}"
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */

function AppDownload() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary-dark text-primary-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-10 h-72 w-72 rounded-full bg-white/10 blur-3xl"
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-8 lg:py-20">
        <div className="lg:col-span-7">
          <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
            Now on mobile
          </span>
          <h2 className="mt-4 text-3xl font-extrabold sm:text-4xl lg:text-[40px]">
            Download the JobsKart App
          </h2>
          <p className="mt-3 max-w-lg text-base text-primary-foreground/80">
            Apply to jobs, chat with employers, and track applications — all from your phone.
            Available in 8 Indian languages.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button className="inline-flex items-center gap-3 rounded-xl bg-foreground px-5 py-3 text-left text-background">
              <div className="grid h-8 w-8 place-items-center rounded bg-background/10 text-xs font-bold">
                ▶
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider opacity-70">Get it on</p>
                <p className="text-sm font-bold">Google Play</p>
              </div>
            </button>
            <button className="inline-flex items-center gap-3 rounded-xl bg-foreground px-5 py-3 text-left text-background">
              <div className="grid h-8 w-8 place-items-center rounded bg-background/10 text-xs font-bold">
                
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider opacity-70">Download on</p>
                <p className="text-sm font-bold">App Store</p>
              </div>
            </button>
          </div>
        </div>

        <div className="relative lg:col-span-5">
          <div className="mx-auto aspect-[9/16] w-56 rounded-[2.5rem] border-8 border-foreground bg-card shadow-2xl sm:w-64">
            <div className="grid h-full place-items-center rounded-[1.75rem] bg-gradient-to-br from-primary-light to-success-light text-muted-foreground">
              <div className="text-center">
                <Smartphone className="mx-auto h-10 w-10 text-primary" />
                <p className="mt-2 text-xs font-medium">App preview</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  MapPin,
  ArrowRight,
  ShieldCheck,
  BadgeCheck,
  Briefcase,
  Building2,
  Users,
  Globe2,
  CheckCircle2,
  Award,
  Target,
  IndianRupee,
  TrendingUp,
  Smartphone,
  UserCheck,
  FileText,
  Wand2,
  Database,
  Coins,
  Quote,
  Zap,
  Phone,
  MessageCircle,
  Clock,
  HeartHandshake,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { getPlatformStats } from "@/lib/stats.functions";
import phoneCandidate from "@/assets/landing-phone-candidate.png";
import resumeParse from "@/assets/landing-resume-parse.jpg";
import employerDb from "@/assets/landing-employer-db.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JobsKart — Find verified jobs. Hire trusted talent. India's #1 hiring platform." },
      {
        name: "description",
        content:
          "10 lakh+ verified jobs across 500+ Indian cities. Upload resume, AI fills your profile. Apply in one tap. Employers: hire from 5L+ candidates with instant database access.",
      },
      { property: "og:title", content: "JobsKart — India's most trusted hiring platform" },
      {
        property: "og:description",
        content: "10 lakh+ jobs · 5 lakh+ candidates · 500+ cities. AI resume parsing. Verified employers.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <LogosStrip />
        <StatsStrip />
        <HowItWorks />
        <FeatureRowCandidate />
        <FeatureRowEmployer />
        <PricingTeaser />
        <Testimonials />
        <FAQ />
        <DualCTA />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------- Hero ---------------------------------- */

function Hero() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const navigate = useNavigate();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    navigate({
      to: "/jobs",
      search: {
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
      },
    });
  };

  return (
    <section className="relative overflow-hidden bg-background">
      {/* color blobs (reference-style geometric accents) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-40 right-1/4 hidden h-40 w-40 rounded-full bg-amber-300/30 blur-2xl lg:block" />
        <div className="absolute bottom-10 right-10 hidden h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl lg:block" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-12 lg:gap-8 lg:px-8 lg:py-24">
        {/* Left: copy */}
        <div className="lg:col-span-6">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/20"
          >
            <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            India's #1 Verified Hiring Platform
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-5 text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem]"
          >
            Get your next <span className="text-primary">job</span>.
            <br />
            Skip the noise.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            10 lakh+ verified jobs across 500+ Indian cities. Upload your resume — our AI fills
            your profile in seconds. Speak directly with the HR. No middlemen, no scams.
          </motion.p>

          {/* Search card */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            onSubmit={submit}
            className="mt-6 rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-soft)]"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-3 rounded-xl px-4 py-3">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Job title, skill or company"
                />
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex flex-1 items-center gap-3 px-4 py-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full min-w-0 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="City or area"
                />
              </label>
              <button
                type="submit"
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)] transition-transform hover:translate-y-[-1px] hover:bg-primary-dark sm:w-auto"
              >
                Search jobs <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.form>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Popular:</span>
            {["Work from Home", "Fresher Jobs", "Part Time", "Driver Jobs"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => navigate({ to: "/jobs", search: { q: t } })}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={2.25} /> Verified employers
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-primary" strokeWidth={2.25} /> Free to apply
            </div>
            <div className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-primary" strokeWidth={2.25} /> 4.6★ on Play Store
            </div>
          </div>
        </div>

        {/* Right: phone + floating proof cards */}
        <div className="relative lg:col-span-6">
          <PhoneCluster />
        </div>
      </div>
    </section>
  );
}

function PhoneCluster() {
  return (
    <div className="relative mx-auto h-[520px] w-full max-w-md sm:h-[600px] lg:h-[640px]">
      {/* color shapes behind phone (reference-style) */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute left-4 top-8 h-28 w-28 rounded-full bg-amber-400/80" />
        <div className="absolute right-6 top-24 h-20 w-20 rounded-full bg-emerald-500/80" />
        <div className="absolute bottom-12 left-10 h-24 w-24 rounded-full bg-red-500/80" />
        <div className="absolute -right-4 bottom-32 h-32 w-32 rounded-full bg-primary/80" />
      </div>

      {/* phone */}
      <motion.img
        src={phoneCandidate}
        alt="JobsKart candidate app showing job matches"
        width={768}
        height={1024}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="relative z-10 mx-auto h-full w-auto object-contain drop-shadow-2xl"
      />

      {/* floating proof cards */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
        className="absolute left-0 top-28 z-20 hidden rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:flex sm:items-center sm:gap-3"
      >
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
          <BadgeCheck className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Verified</p>
          <p className="text-sm font-bold text-foreground">Employer · Amazon</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.65 }}
        className="absolute right-0 top-56 z-20 hidden rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:flex sm:items-center sm:gap-3"
      >
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <IndianRupee className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Salary</p>
          <p className="text-sm font-bold text-foreground tabular-nums">₹28,000 / mo</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-4 left-1/2 z-20 hidden -translate-x-1/2 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:flex sm:items-center sm:gap-3"
      >
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-700">
          <Users className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">This week</p>
          <p className="text-sm font-bold text-foreground tabular-nums">1,240 hired</p>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ Logos strip ------------------------------ */

const LOGOS = ["Amazon", "Flipkart", "Swiggy", "Zomato", "BigBasket", "Reliance"];

function LogosStrip() {
  return (
    <section className="border-y border-border bg-surface py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Trusted by 1,000+ employers across India
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 sm:gap-x-14">
          {LOGOS.map((l) => (
            <span
              key={l}
              className="text-xl font-extrabold tracking-tight text-muted-foreground/70 grayscale transition-all hover:text-foreground hover:grayscale-0 sm:text-2xl"
            >
              {l}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Stats counter ----------------------------- */

function StatsStrip() {
  const { data } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => getPlatformStats(),
    staleTime: 60_000,
  });

  const stats = [
    { icon: Briefcase, label: "Active jobs", value: data?.jobs ?? 0, fallback: "10,00,000+" },
    { icon: Building2, label: "Verified companies", value: data?.companies ?? 0, fallback: "1,000+" },
    { icon: Users, label: "Candidates", value: data?.candidates ?? 0, fallback: "5,00,000+" },
    { icon: Globe2, label: "Cities covered", value: data?.cities ?? 0, fallback: "500+" },
  ];

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl rounded-3xl border border-border bg-card p-2 shadow-[var(--shadow-card)] sm:mx-6 lg:mx-auto">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-3 px-4 py-5 sm:px-6">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <CountUp end={s.value} fallback={s.fallback} />
                <p className="truncate text-xs font-medium text-muted-foreground">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CountUp({ end, fallback }: { end: number; fallback: string }) {
  const [val, setVal] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || end <= 0) return;
    startedRef.current = true;
    const duration = 1200;
    const steps = 40;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setVal(Math.round((end * i) / steps));
      if (i >= steps) clearInterval(id);
    }, duration / steps);
    return () => clearInterval(id);
  }, [end]);

  if (end <= 0) {
    return <p className="text-xl font-bold text-foreground tabular-nums">{fallback}</p>;
  }
  return <p className="text-xl font-bold text-foreground tabular-nums">{val.toLocaleString("en-IN")}+</p>;
}

/* ----------------------------- How it works ----------------------------- */

function HowItWorks() {
  const candidate = [
    { icon: Smartphone, t: "Enter your mobile", d: "No password, no email. Just OTP." },
    { icon: UserCheck, t: "Profile in 60 seconds", d: "Upload resume — AI fills the rest." },
    { icon: Briefcase, t: "Apply in one tap", d: "Speak directly with the HR. No middleman." },
  ];
  const employer = [
    { icon: Building2, t: "Verify your company", d: "GST/CIN check in minutes." },
    { icon: FileText, t: "Post a job in 4 min", d: "Reach lakhs of relevant candidates." },
    { icon: Users, t: "Hire in days", d: "Matched candidates + applied pool, one inbox." },
  ];

  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Zap className="h-3.5 w-3.5" strokeWidth={2.5} /> How it works
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Built for speed. Verified for trust.
          </h2>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-12">
          <StepColumn title="For Job Seekers" tone="primary" steps={candidate} />
          <StepColumn title="For Employers" tone="ink" steps={employer} />
        </div>
      </div>
    </section>
  );
}

type Step = { icon: typeof Smartphone; t: string; d: string };
function StepColumn({ title, tone, steps }: { title: string; tone: "primary" | "ink"; steps: Step[] }) {
  const isPrimary = tone === "primary";
  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <h3
        className={`text-sm font-bold uppercase tracking-wider ${
          isPrimary ? "text-primary" : "text-foreground"
        }`}
      >
        {title}
      </h3>
      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-4">
            <div
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
                isPrimary ? "bg-primary/10 text-primary" : "bg-foreground/5 text-foreground"
              }`}
            >
              <s.icon className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Step {i + 1}
              </p>
              <h4 className="text-base font-bold text-foreground">{s.t}</h4>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ----------------------------- Feature rows ----------------------------- */

function FeatureRowCandidate() {
  return (
    <section className="py-14 sm:py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="order-2 lg:order-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Wand2 className="h-3.5 w-3.5" strokeWidth={2.5} /> AI Resume Parsing
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Upload resume. AI fills your profile.
          </h2>
          <p className="mt-4 text-muted-foreground">
            No retyping. Drop your PDF or photo, and our AI extracts your name, skills, experience,
            and education — ready to apply in under a minute.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              { i: Wand2, t: "Auto-fill 12+ fields from any resume" },
              { i: Target, t: "AI matches you to roles in your city" },
              { i: MessageCircle, t: "Chat with HRs directly on WhatsApp" },
            ].map((row) => (
              <li key={row.t} className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <row.i className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <span className="text-sm font-medium text-foreground">{row.t}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/auth"
            search={{ tab: "candidate" }}
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)] transition-transform hover:translate-y-[-1px] hover:bg-primary-dark"
          >
            Build my profile <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="order-1 lg:order-2">
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <img
              src={resumeParse}
              alt="Resume auto-fill screen"
              width={1280}
              height={896}
              loading="lazy"
              className="h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureRowEmployer() {
  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div>
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <img
              src={employerDb}
              alt="Employer candidate database screen"
              width={1280}
              height={896}
              loading="lazy"
              className="h-auto w-full"
            />
          </div>
        </div>
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Database className="h-3.5 w-3.5" strokeWidth={2.5} /> Employer Database
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Search 5L+ candidates. Unlock with credits.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Filter by role, city, experience and language. Unlock verified contact details with one
            credit. Hire from your applied pool or our entire database — same inbox.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              { i: Database, t: "5L+ verified candidate profiles" },
              { i: Coins, t: "Pay per unlock — no fake leads" },
              { i: ShieldCheck, t: "GST/CIN verified employer access" },
            ].map((row) => (
              <li key={row.t} className="flex items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <row.i className="h-4 w-4" strokeWidth={2.5} />
                </div>
                <span className="text-sm font-medium text-foreground">{row.t}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/auth"
            search={{ tab: "employer" }}
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)] transition-transform hover:translate-y-[-1px] hover:bg-primary-dark"
          >
            Start hiring <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Pricing teaser ----------------------------- */

function PricingTeaser() {
  const plans = [
    { name: "Starter", price: 999, credits: 50, perks: ["50 unlocks", "1 active job post", "Email support"], featured: false },
    { name: "Growth", price: 4499, credits: 250, perks: ["250 unlocks", "5 active job posts", "Priority placement", "WhatsApp support"], featured: true },
    { name: "Enterprise", price: 14999, credits: 1000, perks: ["1,000 unlocks", "Unlimited jobs", "Dedicated manager", "API access"], featured: false },
  ];
  return (
    <section className="py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Coins className="h-3.5 w-3.5" strokeWidth={2.5} /> Employer Plans
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Simple pricing. Pay per unlock.
          </h2>
          <p className="mt-3 text-muted-foreground">No subscriptions. No commitments. Buy credits as you grow.</p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`relative rounded-3xl border p-6 sm:p-8 ${
                p.featured
                  ? "border-primary bg-card shadow-[var(--shadow-elegant)]"
                  : "border-border bg-card shadow-[var(--shadow-card)]"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold text-foreground">{p.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-foreground tabular-nums">
                  ₹{p.price.toLocaleString("en-IN")}
                </span>
                <span className="text-sm text-muted-foreground">/ pack</span>
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-primary tabular-nums">
                {p.credits} credits
              </p>
              <ul className="mt-6 space-y-3">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                    {perk}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                search={{ tab: "employer" }}
                className={`mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold transition-transform hover:translate-y-[-1px] ${
                  p.featured
                    ? "bg-primary text-primary-foreground hover:bg-primary-dark shadow-[var(--shadow-elegant)]"
                    : "border border-border bg-card text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                Buy {p.name} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Testimonials ----------------------------- */

const TESTIS = [
  {
    n: "Priya M.",
    r: "Telecaller, Pune",
    q: "Applied on Monday, joined on Friday. The AI even filled my resume — I just clicked Apply.",
    init: "PM",
  },
  {
    n: "Sandeep K.",
    r: "HR Manager, Logistics Co.",
    q: "We hired 12 delivery executives in 8 days. The candidate database paid for itself.",
    init: "SK",
  },
  {
    n: "Anjali S.",
    r: "Fresher, Bengaluru",
    q: "First job out of college. JobsKart matched me to a verified company — no scam calls.",
    init: "AS",
  },
];

function Testimonials() {
  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <HeartHandshake className="h-3.5 w-3.5" strokeWidth={2.5} /> Loved by India
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Real stories. Real hires.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {TESTIS.map((t) => (
            <figure
              key={t.n}
              className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8"
            >
              <Quote className="h-7 w-7 text-primary/40" strokeWidth={2.25} />
              <blockquote className="mt-4 text-base font-medium leading-relaxed text-foreground">
                "{t.q}"
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {t.init}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{t.n}</p>
                  <p className="text-xs text-muted-foreground">{t.r}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- FAQ ----------------------------- */

const FAQS = [
  {
    q: "Is JobsKart really free for job seekers?",
    a: "Yes, 100% free. You'll never pay to apply, build a profile, or speak with employers. We charge employers — never candidates.",
  },
  {
    q: "How does AI resume parsing work?",
    a: "Upload your resume as PDF, PNG or JPG. Our AI extracts your name, contact, skills, work experience, and education in seconds — you just review and submit.",
  },
  {
    q: "Are all employers verified?",
    a: "Yes. Every employer is GST/CIN-verified before they can contact you or post a job. No scams, no ghost listings.",
  },
  {
    q: "How fast can I get hired?",
    a: "Most candidates hear back within 48 hours. Top employers respond within minutes on WhatsApp.",
  },
  {
    q: "What does 1 credit unlock for employers?",
    a: "1 credit unlocks the full contact details (phone + email) of one candidate. Credits never expire.",
  },
  {
    q: "Do I need to upload a resume?",
    a: "Not required, but recommended. Without a resume, you can still build your profile manually — it just takes a bit longer.",
  },
];

function FAQ() {
  return (
    <section className="py-14 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Clock className="h-3.5 w-3.5" strokeWidth={2.5} /> FAQ
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Quick answers
          </h2>
        </div>
        <Accordion type="single" collapsible className="mt-10 w-full">
          {FAQS.map((f, i) => (
            <AccordionItem key={f.q} value={`item-${i}`} className="border-border">
              <AccordionTrigger className="text-left text-base font-semibold text-foreground hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

/* -------------------------------- Dual CTA ------------------------------- */

function DualCTA() {
  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-6 text-primary-foreground sm:p-10">
          <div className="relative z-10 max-w-md">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/80">
              <Phone className="h-3.5 w-3.5" strokeWidth={2.5} /> For job seekers
            </p>
            <h3 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl">
              Your next job is one tap away.
            </h3>
            <p className="mt-4 text-white/80">
              Build your profile in 60 seconds. Start applying to verified jobs across India.
            </p>
            <Link
              to="/auth"
              search={{ tab: "candidate" }}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-background px-6 text-sm font-bold text-primary shadow-lg transition-transform hover:translate-y-[-1px]"
            >
              Find jobs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
          />
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border bg-foreground p-6 text-background sm:p-10">
          <div className="relative z-10 max-w-md">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <Building2 className="h-3.5 w-3.5" strokeWidth={2.5} /> For employers
            </p>
            <h3 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl">
              Hire from India's largest blue-collar pool.
            </h3>
            <p className="mt-4 text-background/70">
              Post a job in 4 minutes. Get matched candidates plus your applied pool in one inbox.
            </p>
            <Link
              to="/auth"
              search={{ tab: "employer" }}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)] transition-transform hover:translate-y-[-1px] hover:bg-primary-dark"
            >
              Post a job <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
          />
        </div>
      </div>
    </section>
  );
}

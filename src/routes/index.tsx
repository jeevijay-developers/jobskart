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
} from "lucide-react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { getPlatformStats } from "@/lib/stats.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JobsKart — Find work that fits. Hire talent that delivers." },
      {
        name: "description",
        content:
          "India's most trusted hiring platform for blue & grey-collar jobs. Search 10 lakh+ openings or post a job in minutes. Verified employers, AI-matched candidates.",
      },
      { property: "og:title", content: "JobsKart — Find work that fits. Hire talent that delivers." },
      {
        property: "og:description",
        content: "10 lakh+ jobs · 5 lakh+ candidates · 500+ cities. Hire in days, not weeks.",
      },
    ],
  }),
  component: LandingPage,
});

const TRENDING = [
  "Driver", "Delivery", "Security Guard", "Telecaller", "Sales Executive",
  "Warehouse", "Cook", "Housekeeping", "Receptionist", "Field Sales",
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Hero />
        <StatsStrip />
        <TrendingRoles />
        <ValueProps />
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
    <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary-dark text-primary-foreground">
      {/* grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* soft radial highlight */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-white/10 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:gap-12 sm:px-6 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-28 lg:px-8">
        <div className="lg:col-span-7">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white ring-1 ring-white/25"
          >
            <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
            India's #1 Verified Hiring Platform
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-5 text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:mt-6 sm:text-5xl lg:text-6xl"
          >
            Find the job.
            <br />
            <span className="text-white/95">Skip the noise.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-4 max-w-xl text-base text-white/75 sm:mt-6 sm:text-lg"
          >
            10 lakh+ verified jobs across 500+ Indian cities. From driver to designer — apply in one tap,
            speak directly with the HR.
          </motion.p>

          {/* Search */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            onSubmit={submit}
            className="mt-6 rounded-2xl border border-white/10 bg-background p-2 shadow-[var(--shadow-soft)] sm:mt-10"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-3 rounded-xl px-4 py-3">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Job title, skill or company"
                />
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex flex-1 items-center gap-3 px-4 py-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
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

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-white/60">Popular:</span>
            {["Work from Home", "Fresher Jobs", "Part Time", "Driver Jobs"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => navigate({ to: "/jobs", search: { q: t } })}
                className="rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium text-white/85 ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:text-white"
              >
                {t}
              </button>
            ))}
          </motion.div>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/65">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" strokeWidth={2.25} /> Verified employers
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} /> Free to apply
            </div>
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4" strokeWidth={2.25} /> 4.6 rating · Play Store
            </div>
          </div>
        </div>

        {/* Job preview stack */}
        <div className="relative hidden lg:col-span-5 lg:block">
          <JobPreviewStack />
        </div>
      </div>
    </section>
  );
}

function JobPreviewStack() {
  const cards = [
    { role: "Delivery Executive", company: "BlueDart Express", pay: "22,000 – 28,000", city: "Mumbai", tag: "Urgent" },
    { role: "Customer Care Agent", company: "Tata CLiQ", pay: "18,000 – 24,000", city: "Bengaluru", tag: "Remote" },
    { role: "Warehouse Supervisor", company: "Reliance Retail", pay: "26,000 – 35,000", city: "Pune", tag: "Verified" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-sm space-y-4">
      {cards.map((c, i) => (
        <motion.article
          key={c.role}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + i * 0.12 }}
          className="rounded-2xl border border-white/10 bg-background p-5 text-foreground shadow-[var(--shadow-soft)]"
          style={{ marginLeft: i === 1 ? "1.5rem" : 0, marginRight: i === 2 ? "1.5rem" : 0 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                  <BadgeCheck className="h-3 w-3" /> {c.tag}
                </span>
              </div>
              <h3 className="mt-2 truncate text-base font-bold text-foreground">{c.role}</h3>
              <p className="text-sm text-muted-foreground">{c.company}</p>
            </div>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Briefcase className="h-5 w-5" strokeWidth={2.25} />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" /> {c.city}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-foreground tabular-nums">
              <IndianRupee className="h-4 w-4" /> {c.pay}
              <span className="font-normal text-muted-foreground">/ mo</span>
            </span>
          </div>
        </motion.article>
      ))}
    </div>
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
    <section className="relative -mt-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-background p-2 shadow-[var(--shadow-soft)]">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-3 px-5 py-5">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <s.icon className="h-5 w-5" strokeWidth={2.25} />
              </div>
              <div>
                <CountUp end={s.value} fallback={s.fallback} />
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
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

/* ----------------------------- Trending roles ----------------------------- */

function TrendingRoles() {
  const navigate = useNavigate();
  return (
    <section className="py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={2.5} /> Trending this week
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
              What India is searching for
            </h2>
          </div>
          <Link
            to="/jobs"
            className="hidden items-center gap-1 text-sm font-semibold text-foreground hover:text-primary sm:inline-flex"
          >
            See all jobs <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {TRENDING.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => navigate({ to: "/jobs", search: { q: t } })}
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-all hover:border-primary hover:bg-primary/5 hover:text-primary"
            >
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" strokeWidth={2.25} />
              {t}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Value props ------------------------------- */

function ValueProps() {
  const items = [
    {
      icon: ShieldCheck,
      title: "Verified employers, zero scams",
      d: "Every employer is GST/CIN-verified before they can contact you.",
    },
    {
      icon: Target,
      title: "Matched to your role & city",
      d: "Stop scrolling endlessly. We surface jobs that fit your skills and location.",
    },
    {
      icon: CheckCircle2,
      title: "Apply in one tap",
      d: "No clunky forms — your JobsKart profile is your resume.",
    },
  ];
  return (
    <section className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-3">
          {items.map((i) => (
            <div
              key={i.title}
              className="group relative overflow-hidden rounded-2xl border border-border bg-background p-6 transition-colors hover:border-primary/40"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden />
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <i.icon className="h-6 w-6" strokeWidth={2.25} />
              </div>
              <h3 className="mt-5 text-lg font-bold text-foreground">{i.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{i.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- Dual CTA ------------------------------- */

function DualCTA() {
  return (
    <section className="py-14 sm:py-20">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        {/* Candidate */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-6 text-primary-foreground sm:p-10">
          <div className="relative z-10 max-w-md">
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">
              For job seekers
            </p>
            <h3 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl">
              Your next job is one tap away.
            </h3>
            <p className="mt-4 text-white/80">
              Build your profile in 60 seconds and start applying to verified jobs across India.
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

        {/* Employer */}
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

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  MapPin,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Briefcase,
  Building2,
  Users,
  Globe2,
  CheckCircle2,
  Star,
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
    <section
      className="relative overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 15% 10%, rgba(16,185,129,0.18), transparent 45%), radial-gradient(circle at 90% 80%, rgba(16,185,129,0.10), transparent 50%), linear-gradient(180deg, #0f1b3d 0%, #1e3a5f 100%)",
        color: "rgba(245,240,224,0.95)",
      }}
    >
      {/* grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:py-28 lg:px-8">
        <div className="lg:col-span-7">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30"
          >
            <Sparkles className="h-3 w-3" /> India's #1 Blue-Collar Hiring Platform
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Find the job.
            <br />
            <span style={{ color: "#10b981" }}>Skip the noise.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="mt-6 max-w-xl text-lg text-white/70"
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
            className="mt-10 rounded-2xl bg-white/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] backdrop-blur"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex flex-1 items-center gap-2 rounded-xl px-4 py-3">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Job title, skill, company"
                />
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex flex-1 items-center gap-2 px-4 py-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="City or area"
                />
              </label>
              <button
                type="submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.7)] transition-transform hover:translate-y-[-1px]"
                style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}
              >
                Search <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-white/50">Popular:</span>
            {["Work from Home", "Fresher Jobs", "Part Time", "Driver Jobs"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => navigate({ to: "/jobs", search: { q: t } })}
                className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-white/10 transition-colors hover:bg-emerald-500/15 hover:text-emerald-300"
              >
                {t}
              </button>
            ))}
          </motion.div>

          <div className="mt-10 flex items-center gap-6 text-xs text-white/50">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Verified employers
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Free to apply
            </div>
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-emerald-400" /> 4.6★ on Play Store
            </div>
          </div>
        </div>

        {/* Floating job cards */}
        <div className="relative hidden lg:col-span-5 lg:block">
          <FloatingCards />
        </div>
      </div>
    </section>
  );
}

function FloatingCards() {
  const cards = [
    { role: "Delivery Executive", company: "BlueDart", pay: "₹22,000 – ₹28,000", city: "Mumbai", tag: "Urgent" },
    { role: "Customer Care Agent", company: "Tata Cliq", pay: "₹18,000 – ₹24,000", city: "Bengaluru", tag: "Remote" },
    { role: "Warehouse Supervisor", company: "Reliance Retail", pay: "₹26,000 – ₹35,000", city: "Pune", tag: "Verified" },
  ];
  return (
    <div className="relative mx-auto h-[480px] w-full max-w-md">
      {cards.map((c, i) => (
        <motion.div
          key={c.role}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + i * 0.15 }}
          className="absolute w-72 rounded-2xl bg-white p-5 text-foreground shadow-2xl ring-1 ring-black/5"
          style={{
            top: `${i * 110 + 20}px`,
            left: i % 2 === 0 ? "0px" : "auto",
            right: i % 2 === 1 ? "0px" : "auto",
            transform: `rotate(${i % 2 === 0 ? -2 : 2}deg)`,
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                {c.tag}
              </p>
              <h3 className="mt-1 text-base font-bold">{c.role}</h3>
              <p className="text-sm text-muted-foreground">{c.company} · {c.city}</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <Briefcase className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">{c.pay} / mo</p>
        </motion.div>
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
      <div className="mx-auto max-w-6xl rounded-2xl bg-white p-2 shadow-[0_20px_60px_-20px_rgba(15,27,61,0.25)] ring-1 ring-black/5">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-3 px-5 py-5">
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                style={{ background: "rgba(16,185,129,0.12)", color: "#059669" }}
              >
                <s.icon className="h-5 w-5" />
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
    return <p className="text-xl font-bold text-foreground">{fallback}</p>;
  }
  return <p className="text-xl font-bold text-foreground">{val.toLocaleString("en-IN")}+</p>;
}

/* ----------------------------- Trending roles ----------------------------- */

function TrendingRoles() {
  const navigate = useNavigate();
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">
              Trending this week
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              What India is searching for
            </h2>
          </div>
          <Link
            to="/jobs"
            className="hidden items-center gap-1 text-sm font-semibold text-foreground hover:text-emerald-600 sm:inline-flex"
          >
            See all jobs <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          {TRENDING.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => navigate({ to: "/jobs", search: { q: t } })}
              className="group rounded-2xl border-2 border-border bg-card px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-[0_8px_24px_-12px_rgba(16,185,129,0.4)]"
            >
              <span className="text-sm font-semibold text-foreground group-hover:text-emerald-700">
                {t}
              </span>
              <ArrowRight className="ml-2 inline h-4 w-4 text-muted-foreground group-hover:text-emerald-600" />
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
      icon: Sparkles,
      title: "AI-matched in seconds",
      d: "Stop scrolling endlessly. We surface jobs that fit your skills & city.",
    },
    {
      icon: CheckCircle2,
      title: "Apply in one tap",
      d: "No clunky forms — your JobsKart profile is your resume.",
    },
  ];
  return (
    <section className="bg-surface py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-3">
          {items.map((i) => (
            <div
              key={i.title}
              className="rounded-2xl bg-background p-6 shadow-[0_2px_12px_rgba(15,27,61,0.06)]"
            >
              <div
                className="grid h-12 w-12 place-items-center rounded-xl"
                style={{ background: "rgba(16,185,129,0.12)", color: "#059669" }}
              >
                <i.icon className="h-6 w-6" />
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
    <section className="py-20">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        {/* Candidate */}
        <div
          className="relative overflow-hidden rounded-3xl p-10 text-white"
          style={{
            background: "linear-gradient(135deg,#10b981 0%,#059669 100%)",
          }}
        >
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">
              For job seekers
            </p>
            <h3 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              Your next job is one tap away.
            </h3>
            <p className="mt-4 max-w-md text-white/80">
              Build your profile in 60 seconds and start applying to verified jobs across India.
            </p>
            <Link
              to="/signup/candidate"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-emerald-700 shadow-lg transition-transform hover:translate-y-[-1px]"
            >
              Find jobs <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div
            aria-hidden
            className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
          />
        </div>

        {/* Employer */}
        <div
          className="relative overflow-hidden rounded-3xl p-10 text-white"
          style={{
            background: "linear-gradient(135deg,#0f1b3d 0%,#1e3a5f 100%)",
          }}
        >
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
              For employers
            </p>
            <h3 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
              Hire from India's largest blue-collar pool.
            </h3>
            <p className="mt-4 max-w-md text-white/70">
              Post a job in 4 minutes. Get AI-matched candidates plus your applied pool in one inbox.
            </p>
            <Link
              to="/signup/employer"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-bold text-white shadow-lg transition-transform hover:translate-y-[-1px]"
              style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}
            >
              Post a job <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div
            aria-hidden
            className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl"
          />
        </div>
      </div>
    </section>
  );
}

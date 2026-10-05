import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  MapPin,
  ArrowRight,
  ShieldCheck,
  BadgeCheck,
  Users,
  CheckCircle2,
  Award,
  IndianRupee,
  Zap,
  Clock,
  HeartHandshake,
  Bike,
  Shield,
  Car,
  Headset,
  Boxes,
  Sparkles,
  HeartPulse,
  ChefHat,
  Star,
  Phone,
  Mail,
  Send,
  Building2,
  MessageCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { AutocompleteInput } from "@/components/site/AutocompleteInput";
import { supabase } from "@/integrations/supabase/client";
import { CONTACT_FALLBACK, type ContactInfo } from "@/lib/site-content";
import { getPlatformStats } from "@/lib/stats.functions";
import { useJobTitleSuggestions } from "@/lib/useJobTitleSuggestions";
import { INDIAN_CITIES } from "@/lib/options";
import phoneCandidate from "@/assets/landing-phone-candidate.png";

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
        content:
          "10 lakh+ jobs · 5 lakh+ candidates · 500+ cities. AI resume parsing. Verified employers.",
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
        <DirectHiringPartners />
        <CategoryGrid />
        <HowItWorks />
        <StatsStrip />
        <AboutUs />
        <Testimonials />
        <FAQ />
        <ContactUs />
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
  const jobTitles = useJobTitleSuggestions();

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
    <section id="home" className="relative overflow-hidden bg-background">
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
            10 lakh+ verified jobs across 500+ Indian cities. Upload your resume — our AI fills your
            profile in seconds. Speak directly with the HR. No middlemen, no scams.
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
                <AutocompleteInput
                  value={q}
                  onChange={setQ}
                  onSubmit={submit}
                  suggestions={jobTitles}
                  placeholder="Job title, skill or company"
                  wrapperClassName="relative w-full min-w-0"
                  inputClassName="w-full min-w-0 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  aria-label="Job title, skill or company"
                />
              </label>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <label className="flex flex-1 items-center gap-3 px-4 py-3">
                <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                <AutocompleteInput
                  value={city}
                  onChange={setCity}
                  onSubmit={submit}
                  suggestions={INDIAN_CITIES}
                  placeholder="City or area"
                  wrapperClassName="relative w-full min-w-0"
                  inputClassName="w-full min-w-0 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  aria-label="City or area"
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
            {["Work from Home", "Fresher Jobs", "Driver Jobs"].map((t) => (
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Verified
          </p>
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Salary
          </p>
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            This week
          </p>
          <p className="text-sm font-bold text-foreground tabular-nums">1,240 hired</p>
        </div>
      </motion.div>
    </div>
  );
}

/* -------------------------- Direct hiring partners ------------------------ */

const PARTNERS = [
  { name: "TATA", tone: "text-neutral-800", sub: "Tata Group" },
  { name: "Reliance", tone: "text-red-600", sub: "Retail Stores" },
  { name: "bb", tone: "text-emerald-600", sub: "BigBasket" },
  { name: "blinkit", tone: "text-amber-500", sub: "Quick Commerce" },
  { name: "zomato", tone: "text-red-500", sub: "Food Delivery" },
  { name: "SWIGGY", tone: "text-orange-500", sub: "Instamart & Fleet" },
  { name: "Flipkart", tone: "text-blue-600", sub: "Supply Chain" },
  { name: "DELHIVERY", tone: "text-neutral-900", sub: "Logistics Hub" },
];

function DirectHiringPartners() {
  return (
    <section id="partners" className="border-y border-border bg-surface py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            Direct Hiring Partners
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Trusted by 1,000+ Top Enterprises & 5 Lakh+ MSMEs across India
          </p>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {PARTNERS.map((p) => (
            <div
              key={p.name}
              className="rounded-xl border border-border bg-card px-3 py-4 text-center shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <p className={`text-lg font-extrabold tracking-tight ${p.tone}`}>{p.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------ Mobile swipe carousel --------------------------- */

function MobileCardCarousel({ children }: { children: React.ReactNode[] }) {
  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const id = setInterval(() => api.scrollNext(), 3000);
    return () => clearInterval(id);
  }, [api]);

  return (
    <div className="md:hidden">
      <Carousel setApi={setApi} opts={{ align: "start", loop: true }}>
        <CarouselContent>
          {children.map((child, i) => (
            <CarouselItem key={i} className="basis-full">
              {child}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
      <div className="mt-4 flex justify-center gap-1.5">
        {children.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === selected ? "w-5 bg-primary" : "w-1.5 bg-border"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Category grid ------------------------------ */

const CATEGORIES = [
  { icon: Bike, title: "Delivery Executive", openings: "1,42,000+ Openings", desc: "Bike, E-rickshaw, Van delivery in food & e-commerce", salary: "₹18K – ₹32K" },
  { icon: Shield, title: "Security Guard", openings: "85,000+ Openings", desc: "Residential, IT Parks, Malls & Commercial complex guards", salary: "₹15K – ₹26K" },
  { icon: Car, title: "Driver & Chauffeur", openings: "64,000+ Openings", desc: "Cab aggregators, personal family driver & heavy truck operators", salary: "₹20K – ₹38K" },
  { icon: Headset, title: "Sales & Telecaller", openings: "98,000+ Openings", desc: "Inbound support, customer service & field retail executives", salary: "₹18K – ₹30K" },
  { icon: Boxes, title: "Warehouse & Logistics", openings: "72,000+ Openings", desc: "Pickers, packers, barcode sorters & inventory handlers", salary: "₹16K – ₹25K" },
  { icon: Sparkles, title: "Housekeeping & Facility", openings: "43,000+ Openings", desc: "Office boys, facility cleaners & maintenance staff", salary: "₹14K – ₹22K" },
  { icon: HeartPulse, title: "Hospital & Nurse Assistant", openings: "31,000+ Openings", desc: "Ward boys, lab helpers, nursing care & pharmacy helpers", salary: "₹17K – ₹28K" },
  { icon: ChefHat, title: "Cook, Chef & Kitchen Staff", openings: "29,000+ Openings", desc: "Cloud kitchens, fast-food cooks, commis chefs & helpers", salary: "₹18K – ₹32K" },
];

function CategoryGrid() {
  return (
    <section id="categories" className="py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              Sector-Wise Hiring
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Browse Jobs by Category
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Over 10 Lakh vacancies updated in real-time across verified employers
            </p>
          </div>
          <Link
            to="/jobs"
            className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
          >
            View All 42 Categories <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-10">
          <MobileCardCarousel>
            {CATEGORIES.slice(0, 3).map((c) => (
              <CategoryCard key={c.title} c={c} />
            ))}
          </MobileCardCarousel>
          <div className="hidden gap-5 md:grid md:grid-cols-2 lg:grid-cols-4">
            {CATEGORIES.map((c) => (
              <CategoryCard key={c.title} c={c} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryCard({ c }: { c: (typeof CATEGORIES)[number] }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <c.icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <h3 className="mt-4 text-base font-bold text-foreground">{c.title}</h3>
      <p className="mt-1 text-sm font-bold text-emerald-600">{c.openings}</p>
      <p className="mt-2 flex-1 text-xs text-muted-foreground">{c.desc}</p>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs font-semibold text-muted-foreground">Avg {c.salary}</span>
        <Link
          to="/auth"
          search={{ tab: "candidate" }}
          className="text-xs font-bold text-primary hover:underline"
        >
          Apply Now →
        </Link>
      </div>
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
    { label: "Active Jobs Live", sub: "Across 42 job categories", value: data?.jobs ?? 0, fallback: "10 Lakh+" },
    { label: "Verified Candidates", sub: "Aadhaar & skill checked", value: data?.candidates ?? 0, fallback: "50 Lakh+" },
    { label: "Top Employers", sub: "Direct enterprise recruiters", value: data?.companies ?? 0, fallback: "1,000+" },
    { label: "Cities in India", sub: "Tier-1 to Tier-4 coverage", value: data?.cities ?? 0, fallback: "500+" },
  ];

  return (
    <section id="stats" className="bg-primary py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center text-primary-foreground sm:text-left">
              <CountUp end={s.value} fallback={s.fallback} />
              <p className="mt-1 text-sm font-semibold text-primary-foreground">{s.label}</p>
              <p className="text-xs text-primary-foreground/70">{s.sub}</p>
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
    return <p className="text-2xl font-extrabold tabular-nums sm:text-3xl">{fallback}</p>;
  }
  return (
    <p className="text-2xl font-extrabold tabular-nums sm:text-3xl">
      {val.toLocaleString("en-IN")}+
    </p>
  );
}

/* ----------------------------- How it works ----------------------------- */

function HowItWorks() {
  const candidate = [
    { t: "Create Free Profile in 2 Mins", d: "No complicated resume required. Fill in your basic details, qualification, vehicle availability, and preferred job location." },
    { t: "Direct Call to HR (Zero Middlemen)", d: "Ask verified hiring managers directly via phone or WhatsApp. Ask about salary, shift timings, and perks right away." },
    { t: "Give Interview & Get Hired", d: "Attend localized walk-in interviews or telephonic onboarding and receive offer letters in as fast as 24 hours." },
  ];
  const employer = [
    { t: "Post Vacancy in 30 Seconds", d: "Specify role, vacancies needed, pincode, and base salary. Form auto-fills industry standards to get live instantly." },
    { t: "Instant AI Match From 50L+ Pool", d: "Our localized algorithm triggers alerts to verified candidates living within a 7km radius who meet vehicle and license requirements." },
    { t: "Hire in 48 Hours with 0% Commission", d: "Receive direct applications, conduct batch interviews, and onboard frontline staff without paying recruitment placement fees." },
  ];

  return (
    <section id="how-it-works" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <Zap className="h-3.5 w-3.5" strokeWidth={2.5} /> Fast & Transparent
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How JobsKart Works For You
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Engineered to eliminate commission brokers and connect employers directly with
            candidates in record time.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <StepColumn
            title="For Job Seekers"
            badge="100% Free Forever"
            tone="primary"
            steps={candidate}
            cta={{ label: "Find Jobs Near Me", icon: MapPin, to: "/jobs" }}
          />
          <StepColumn
            id="employers"
            title="For Employers"
            badge="Fast Turnaround"
            tone="ink"
            steps={employer}
            cta={{ label: "Post a Job Free", icon: Zap, to: "/auth", search: { tab: "employer" } }}
          />
        </div>
      </div>
    </section>
  );
}

type Step = { t: string; d: string };
function StepColumn({
  id,
  title,
  badge,
  tone,
  steps,
  cta,
}: {
  id?: string;
  title: string;
  badge: string;
  tone: "primary" | "ink";
  steps: Step[];
  cta: { label: string; icon: typeof MapPin; to: string; search?: Record<string, string> };
}) {
  const isPrimary = tone === "primary";
  return (
    <div id={id} className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h3
          className={`text-sm font-bold uppercase tracking-wider ${
            isPrimary ? "text-primary" : "text-foreground"
          }`}
        >
          {title}
        </h3>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${
            isPrimary ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"
          }`}
        >
          {badge}
        </span>
      </div>
      <ol className="mt-6 space-y-5">
        {steps.map((s, i) => (
          <li key={s.t} className="flex gap-4">
            <div
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
                isPrimary ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
              }`}
            >
              {i + 1}
            </div>
            <div className="min-w-0">
              <h4 className="text-base font-bold text-foreground">{s.t}</h4>
              <p className="text-sm text-muted-foreground">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        to={cta.to}
        search={cta.search as never}
        className={`mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold transition-transform hover:translate-y-[-1px] ${
          isPrimary
            ? "bg-primary text-primary-foreground shadow-[var(--shadow-elegant)] hover:bg-primary-dark"
            : "bg-foreground text-background hover:bg-foreground/90"
        }`}
      >
        <cta.icon className="h-4 w-4" /> {cta.label}
      </Link>
    </div>
  );
}

/* ----------------------------- Testimonials ----------------------------- */

const FALLBACK_TESTIMONIALS = [
  {
    name: "Sunil Verma",
    role_text: "Delivery Rider • Noida, UP",
    quote:
      "Earlier agents asked for ₹2,000 just for interview passes. On JobsKart I directly called the Swiggy hub manager in Noida and joined as a rider within 24 hours. My first month salary was credited directly to my bank.",
    initials: "SV",
    rating: 5,
  },
  {
    name: "Pooja Jadhav",
    role_text: "Retail Executive • Thane, Mumbai",
    quote:
      "The filter by neighbourhood helped me find a store executive role just 1.5 km from my home in Thane. The app works fast even on 4G, and the verification badge gave me confidence that the company was genuine.",
    initials: "PJ",
    rating: 5,
  },
  {
    name: "Anand Kulkarni",
    role_text: "Warehouse Sorter • Bhiwandi, MH",
    quote:
      "I applied for Warehouse Sorter role at Flipkart Bhiwandi. Got an interview call within 30 minutes! Salary structure with overtime allowance was clearly listed upfront. Very transparent platform.",
    initials: "AK",
    rating: 5,
  },
];

function Testimonials() {
  const { data } = useQuery({
    queryKey: ["home-testimonials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("home_testimonials")
        .select("name, role_text, quote, initials, rating")
        .eq("is_active", true)
        .order("sort")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
  const testimonials = data?.length ? data : FALLBACK_TESTIMONIALS;

  return (
    <section id="testimonials" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
            <HeartHandshake className="h-3.5 w-3.5" strokeWidth={2.5} /> Candidate Stories
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Real People. Real Jobs.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            Listen to fellow workers who secured direct employment within days of registering on
            JobsKart.
          </p>
        </div>
        <div className="mt-12">
          <MobileCardCarousel>
            {testimonials.map((t) => (
              <TestimonialCard key={t.name} t={t} />
            ))}
          </MobileCardCarousel>
          <div className="hidden gap-6 md:grid md:grid-cols-3">
            {testimonials.map((t) => (
              <TestimonialCard key={t.name} t={t} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ t }: { t: (typeof FALLBACK_TESTIMONIALS)[number] }) {
  return (
    <figure className="h-full rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: t.rating }).map((_, i) => (
          <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
        ))}
      </div>
      <blockquote className="mt-4 text-base font-medium leading-relaxed text-foreground">
        "{t.quote}"
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {t.initials}
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">{t.name}</p>
          <p className="text-xs text-muted-foreground">{t.role_text}</p>
        </div>
      </figcaption>
    </figure>
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
    <section id="faq" className="py-14 sm:py-20">
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

/* ------------------------------- About us -------------------------------- */

const ABOUT_POINTS = [
  { icon: ShieldCheck, t: "Verified employers only", d: "Every company is GST/CIN checked before it can post or contact candidates." },
  { icon: IndianRupee, t: "Zero commission", d: "We never take a cut of your salary. Hire directly, pay only for the tools you use." },
  { icon: Users, t: "Free for job seekers", d: "Build a profile, apply and talk to HR without paying anyone." },
  { icon: MapPin, t: "Local hiring first", d: "Jobs matched by neighbourhood, so you get to work without a long commute." },
];

function AboutUs() {
  return (
    <section id="about" className="py-14 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
              <Building2 className="h-3.5 w-3.5" strokeWidth={2.5} /> About Us
            </p>
            <h2 className="mt-2 break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Blue-collar and grey-collar hiring, done right.
            </h2>
            <p className="mt-4 break-words text-muted-foreground">
              JobsKart connects India's frontline workers with verified employers across field,
              industrial, retail and service roles. We exist to remove brokers, hidden fees and
              ghost listings from the hiring process.
            </p>
            <p className="mt-3 break-words text-muted-foreground">
              Our mission is simple: every worker gets a fair, transparent offer, and every
              employer gets people who show up.
            </p>
          </div>
          <div className="min-w-0">
            <MobileCardCarousel>
              {ABOUT_POINTS.map((p) => (
                <AboutCard key={p.t} p={p} />
              ))}
            </MobileCardCarousel>
            <div className="hidden gap-4 md:grid md:grid-cols-2">
              {ABOUT_POINTS.map((p) => (
                <AboutCard key={p.t} p={p} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutCard({ p }: { p: (typeof ABOUT_POINTS)[number] }) {
  return (
    <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
        <p.icon className="h-5 w-5" strokeWidth={2.25} />
      </div>
      <h3 className="mt-3 text-sm font-bold text-foreground">{p.t}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{p.d}</p>
    </div>
  );
}

/* ------------------------------ Contact us ------------------------------- */

type ContactAudienceKey = "job_seeker" | "employer";
type FormAudienceKey = "job_seeker" | "employer";

const LEFT_TABS: { key: ContactAudienceKey; label: string }[] = [
  { key: "job_seeker", label: "For Job Seekers" },
  { key: "employer", label: "For Employers" },
];

const FORM_TABS: { key: FormAudienceKey; label: string }[] = [
  { key: "job_seeker", label: "Job Seeker" },
  { key: "employer", label: "Employer" },
];

function ContactUs() {
  const { data } = useQuery({
    queryKey: ["site-content-public", "contact"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_content")
        .select("value")
        .eq("key", "contact")
        .maybeSingle();
      if (error) throw error;
      return { ...CONTACT_FALLBACK, ...((data?.value as Partial<ContactInfo>) ?? {}) };
    },
    staleTime: 60_000,
  });
  const info: ContactInfo = data ?? CONTACT_FALLBACK;

  const [leftTab, setLeftTab] = useState<ContactAudienceKey>("job_seeker");
  const [formAudience, setFormAudience] = useState<FormAudienceKey>("job_seeker");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const side = leftTab === "job_seeker" ? info.jobSeeker : info.employer;
  const subjects = info.subjects[formAudience] ?? [];

  const pickFormAudience = (key: FormAudienceKey) => {
    setFormAudience(key);
    setSubject("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return toast.error("Enter a valid 10-digit mobile number.");
    if (message.trim().length < 10) return toast.error("Message should be at least 10 characters.");
    setSending(true);
    try {
      const { error } = await supabase.from("contact_messages").insert({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        message: message.trim(),
        audience: formAudience,
        subject: subject || null,
      });
      if (error) throw error;
      toast.success("Thanks! We'll get back to you shortly.");
      setName("");
      setPhone("");
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const segmented = <K extends string>(
    tabs: { key: K; label: string }[],
    active: K,
    onPick: (k: K) => void,
  ) => (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-surface p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
            active === t.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <section id="contact" className="bg-surface py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.5} /> Get in touch
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            {info.heading}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">{info.subheading}</p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
          <div className="space-y-4">
            {segmented(LEFT_TABS, leftTab, setLeftTab)}

            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_4px_20px_-2px_rgba(26,85,189,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" strokeWidth={2.25} />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Toll-free helpline
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground tabular-nums">{side.helpline}</p>
                    <p className="text-xs text-muted-foreground">{side.helplineHours}</p>
                  </div>
                </div>
                {info.onlineNow && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online Now
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_4px_20px_-2px_rgba(26,85,189,0.08)]">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Mail className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Official email support
                  </p>
                  <p className="mt-1 truncate text-base font-bold text-foreground">{side.email}</p>
                  <p className="text-xs text-muted-foreground">For account, billing and verification queries.</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_4px_20px_-2px_rgba(26,85,189,0.08)]">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                  <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Direct messaging
                  </p>
                  <p className="mt-1 text-base font-bold text-foreground tabular-nums">{side.whatsapp}</p>
                  <p className="text-xs text-muted-foreground">Chat with support on WhatsApp.</p>
                  <a
                    href={`https://wa.me/${side.whatsapp.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline"
                  >
                    Start WhatsApp Chat <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_4px_20px_-2px_rgba(26,85,189,0.08)]">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <MapPin className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Headquarters
                  </p>
                  <p className="mt-1 text-sm font-bold text-foreground">{info.hq.company}</p>
                  <p className="text-xs text-muted-foreground">{info.hq.address}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
              <Clock className="h-4 w-4 shrink-0" /> {info.responseTime}
            </div>
          </div>

          <form
            onSubmit={submit}
            className="rounded-xl border border-border bg-card p-6 shadow-[0_8px_24px_-4px_rgba(26,85,189,0.14)] sm:p-8"
          >
            <h3 className="text-xl font-bold text-foreground">Send Us a Message</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fill out the form below and our regional support team will reach out shortly.
            </p>

            <div className="mt-5">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">I am a</Label>
              <div className="mt-2">{segmented(FORM_TABS, formAudience, pickFormAudience)}</div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Full name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aarav Kumar" />
              </div>
              <div>
                <Label>WhatsApp / phone</Label>
                <div className="flex">
                  <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface px-3 text-sm font-semibold text-muted-foreground">
                    +91
                  </span>
                  <Input
                    className="rounded-l-none"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit mobile"
                    inputMode="numeric"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Email address (optional)</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div>
                <Label>Inquiry subject</Label>
                <select
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a topic</option>
                  {subjects.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <Label>Message details</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Describe how we can help you…"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground shadow-[var(--shadow-elegant)] transition-transform hover:translate-y-[-1px] hover:bg-primary-dark active:translate-y-px disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send Message"}
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              We respect your privacy. Your contact details are shared only with the relevant team and never sold to third parties.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

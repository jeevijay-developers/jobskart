import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { setActiveCompanyId } from "@/lib/employer";
import { INDIAN_CITIES } from "@/lib/options";
import {
  Questionnaire,
  BigInput,
  BigTextarea,
  ChipChoice,
  type WizardStep,
} from "@/components/wizard/Questionnaire";
import { Field } from "@/components/candidate/primitives";
import { Building2, Upload, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding/employer")({
  head: () => ({ meta: [{ title: "Set up your company · JobsKart" }] }),
  component: EmployerOnboarding,
});

const SIZES = [
  { value: "1-10", label: "Just starting", hint: "1–10 people" },
  { value: "11-50", label: "Small team", hint: "11–50 people" },
  { value: "51-200", label: "Mid-size", hint: "51–200 people" },
  { value: "201-500", label: "Established", hint: "201–500 people" },
  { value: "500+", label: "Enterprise", hint: "500+ people" },
] as const;

const ROLES = [
  { value: "founder", label: "Founder / Owner" },
  { value: "hr", label: "HR / Talent Acquisition" },
  { value: "recruiter", label: "Recruiter / Hiring Manager" },
  { value: "ops", label: "Operations / Team Lead" },
] as const;

const TOP_CITIES = [
  "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Pune", "Chennai",
  "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Indore", "Chandigarh",
];

const INDUSTRY_SUGGEST = [
  "IT / Software", "Logistics & Delivery", "Retail", "Healthcare",
  "Education", "Finance", "Manufacturing", "Hospitality", "Real Estate",
  "Construction", "Media", "Other",
];

function EmployerOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // form state
  const [fullName, setFullName] = useState("");
  const [yourRole, setYourRole] = useState<string>("founder");
  const [designation, setDesignation] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState<string>("11-50");
  const [foundedYear, setFoundedYear] = useState<string>("");
  const [hqCity, setHqCity] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [gst, setGst] = useState("");
  const [postNow, setPostNow] = useState<"yes" | "later">("yes");

  const submit = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in.");

      await supabase.from("profiles").update({ full_name: fullName }).eq("id", uid);
      void designation; void yourRole;

      const { data: companyId, error: rpcErr } = await supabase.rpc(
        "create_company_with_owner" as never,
        {
          _name: companyName.trim(),
          _industry: industry || "",
          _size: size as never,
          _hq_city: hqCity || "",
          _website: website || "",
          _about: about || "",
          _founded_year: foundedYear ? Number(foundedYear) : null,
          _gst: gst || "",
        } as never,
      );
      if (rpcErr || !companyId) throw rpcErr ?? new Error("Could not create company.");
      const cid = companyId as unknown as string;

      if (logoFile) {
        const path = `${cid}/logo-${Date.now()}-${logoFile.name}`;
        const up = await supabase.storage.from("company-logos").upload(path, logoFile, { upsert: true });
        if (!up.error) {
          const { data: signed } = await supabase.storage
            .from("company-logos")
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          if (signed?.signedUrl) {
            await supabase.from("companies").update({ logo_url: signed.signedUrl }).eq("id", cid);
          }
        }
      }

      setActiveCompanyId(cid);
      toast.success(`${companyName} is ready 🎉`);
      navigate({ to: postNow === "yes" ? "/employer/jobs/new" : "/employer/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const steps: WizardStep[] = [
    {
      key: "you",
      title: "First — who's hiring?",
      hint: "We use this on invites and to address you across the dashboard.",
      validate: () => (fullName.trim().length < 2 ? "Tell us your name." : null),
      render: () => (
        <div className="space-y-6">
          <BigInput
            placeholder="Your full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
          />
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Your role</p>
            <ChipChoice
              value={yourRole}
              onChange={(v) => setYourRole(v as string)}
              options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
          <Field label="Designation (optional)" hint="e.g. Head of TA, Founder">
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className="form-input"
              placeholder="Optional"
            />
          </Field>
        </div>
      ),
    },
    {
      key: "company",
      title: "What's your company called?",
      hint: "Use your registered or commonly known brand name.",
      validate: () => {
        if (companyName.trim().length < 2) return "Add your company name.";
        if (!industry) return "Pick an industry to continue.";
        return null;
      },
      render: () => (
        <div className="space-y-6">
          <BigInput
            placeholder="Acme Logistics Pvt Ltd"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Industry</p>
            <div className="flex flex-wrap gap-2">
              {INDUSTRY_SUGGEST.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndustry(i)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    industry === i
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-foreground/30"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Team size">
              <ChipChoice
                value={size}
                onChange={(v) => setSize(v as string)}
                options={SIZES.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))}
              />
            </Field>
            <Field label="Founded year (optional)">
              <input
                type="number"
                value={foundedYear}
                onChange={(e) => setFoundedYear(e.target.value)}
                className="form-input"
                placeholder="2018"
                min={1900}
                max={new Date().getFullYear()}
              />
            </Field>
          </div>
        </div>
      ),
    },
    {
      key: "city",
      title: "Where do you hire from?",
      hint: "Pick your HQ. You can add more locations later when posting jobs.",
      validate: () => (!hqCity ? "Pick your headquarters." : null),
      render: () => (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {TOP_CITIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setHqCity(c)}
                className={`rounded-xl border-2 px-4 py-2.5 text-sm font-semibold ${
                  hqCity === c
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-card text-foreground/80 hover:border-foreground/30"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Field label="Other city">
            <select
              value={TOP_CITIES.includes(hqCity) ? "" : hqCity}
              onChange={(e) => setHqCity(e.target.value)}
              className="form-input"
            >
              <option value="">Pick another city…</option>
              {INDIAN_CITIES.filter((c) => !TOP_CITIES.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
      ),
    },
    {
      key: "brand",
      title: "Add your brand & proof",
      hint: "Verified, branded employers get 4× more applications. All optional — you can complete later.",
      render: () => (
        <div className="space-y-5">
          <Field label="Company logo">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface p-4 hover:border-primary/40">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
                {logoFile ? (
                  <img
                    src={URL.createObjectURL(logoFile)}
                    alt="logo"
                    className="h-14 w-14 rounded-xl object-cover"
                  />
                ) : (
                  <Building2 className="h-6 w-6" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {logoFile ? logoFile.name : "Drop or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground">PNG/JPG, square works best</p>
              </div>
              <Upload className="h-5 w-5 text-muted-foreground" />
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>
          <Field label="Website (optional)">
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="form-input"
              placeholder="https://"
            />
          </Field>
          <Field label="Short about" hint={`${about.length}/500 — one paragraph elevator pitch.`}>
            <BigTextarea
              rows={4}
              maxLength={500}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What you do, who you hire, why people love working here."
              className="text-base"
            />
          </Field>
          <Field label="GST number (optional)" hint="Required for the verified employer badge — you can add this later from Company → KYC.">
            <input
              value={gst}
              onChange={(e) => setGst(e.target.value.toUpperCase())}
              className="form-input"
              placeholder="22AAAAA0000A1Z5"
              maxLength={15}
            />
          </Field>
        </div>
      ),
    },
    {
      key: "first-job",
      title: "Ready to post your first job?",
      hint: "We'll take you straight to a 3-minute guided post, or land you on the dashboard.",
      render: () => (
        <ChipChoice
          value={postNow}
          onChange={(v) => setPostNow(v as "yes" | "later")}
          options={[
            { value: "yes", label: "Yes — post my first job now", hint: "Recommended · 3 min wizard" },
            { value: "later", label: "Maybe later — show me the dashboard", hint: "Browse around first" },
          ]}
        />
      ),
    },
  ];

  return (
    <Questionnaire
      steps={steps}
      index={step}
      onIndex={setStep}
      onSubmit={submit}
      submitting={saving}
      submitLabel={saving ? "Setting up…" : "Create my workspace"}
      side="employer"
      brandKicker="JobsKart for employers"
      brandLines={[
        "Hire 4× faster with verified candidates across India.",
        "AI shortlisting, mobile-first applicants, and a real-time pipeline.",
      ]}
    />
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { uploadCompanyLogo } from "@/lib/company-logo.functions";
import { LOGO_ACCEPT, LOGO_TYPE_ERROR, checkLogoFile, fileToBase64 } from "@/lib/company-logo";
import { toast } from "sonner";
import { CityTownAutocomplete } from "@/components/candidate/CityTownAutocomplete";
import { supabase } from "@/integrations/supabase/client";
import { setActiveCompanyId } from "@/lib/employer";
import { INDIAN_CITIES } from "@/lib/options";
import { useJobTitleSuggestions } from "@/lib/useJobTitleSuggestions";
import {
  Questionnaire,
  BigInput,
  BigTextarea,
  ChipChoice,
  type WizardStep,
} from "@/components/wizard/Questionnaire";
import { Field } from "@/components/candidate/primitives";
import { OptionalSection } from "@/components/forms/OptionalSection";
import { sanitizeGstinInput, validateGstin, sanitizeWebsiteInput, validateWebsite } from "@/lib/validators";
import { Building2, Upload, Loader2, ChevronUp, ChevronDown } from "lucide-react";

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
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Lucknow",
  "Indore",
  "Chandigarh",
];

const INDUSTRY_SUGGEST = [
  "IT / Software",
  "Logistics & Delivery",
  "Retail",
  "Healthcare",
  "Education",
  "Finance",
  "Manufacturing",
  "Hospitality",
  "Real Estate",
  "Construction",
  "Media",
  "Other",
];

const CURRENT_YEAR = new Date().getFullYear();
const MIN_FOUNDED_YEAR = 1947;
const FUTURE_YEAR_ERROR = "Future year is not allowed. Enter the current year or an earlier year.";
const EMPLOYER_FULL_NAME_RE = /^[A-Za-z ]+$/;

function getEmployerFullNameError(value: string): string | null {
  if (!value.trim()) return "Please enter your full name";
  if (value.length > 80) return "Name must be under 80 characters";
  if (!EMPLOYER_FULL_NAME_RE.test(value)) return "Only letters and spaces are allowed";
  if (value.trim().length < 2) return "Please enter your full name";
  return null;
}

function EmployerOnboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const runUploadCompanyLogo = useServerFn(uploadCompanyLogo);

  // form state
  const [fullName, setFullName] = useState("");
  const [fullNameInputError, setFullNameInputError] = useState<string | null>(null);
  const [yourRole, setYourRole] = useState<string>("founder");
  const [designation, setDesignation] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState<string>("1-10");
  const [foundedYear, setFoundedYear] = useState<string>("");
  const [hqCity, setHqCity] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [about, setAbout] = useState("");
  const [gst, setGst] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [isConsultant, setIsConsultant] = useState(false);
  const [postNow, setPostNow] = useState<"yes" | "later">("yes");
  const designationSuggestions = useJobTitleSuggestions();
  const fullNameError = fullNameInputError ?? getEmployerFullNameError(fullName);
  const shouldShowFullNameError = Boolean(fullName || fullNameInputError);
  // Silent fix-up: below min or incomplete -> empty. A future year is kept so
  // the inline message can explain it; it is never saved (see futureYear).
  const normalizeFoundedYear = (v: string) => {
    if (v.length !== 4) return "";
    return Number(v) < MIN_FOUNDED_YEAR ? "" : v;
  };
  const futureYear = foundedYear.length === 4 && Number(foundedYear) > CURRENT_YEAR;
  const foundedYearRef = useRef<HTMLInputElement>(null);

  const yearNum = foundedYear ? Number(foundedYear) : null;
  const yearAtMax = yearNum !== null && yearNum >= CURRENT_YEAR;
  const yearAtMin = yearNum === MIN_FOUNDED_YEAR;
  // Empty -> current year; out-of-range partial value -> nearest valid year;
  // otherwise +/-1 clamped to [MIN_FOUNDED_YEAR, CURRENT_YEAR].
  const stepFoundedYear = (dir: 1 | -1) => {
    const inRange =
      yearNum !== null && yearNum >= MIN_FOUNDED_YEAR && yearNum <= CURRENT_YEAR;
    const next =
      yearNum === null
        ? CURRENT_YEAR
        : Math.min(CURRENT_YEAR, Math.max(MIN_FOUNDED_YEAR, inRange ? yearNum + dir : yearNum));
    setFoundedYear(String(next));
  };

  // Live uppercase for the name field; caret is preserved because the
  // length never changes.
  const applyConsultancyUppercase = (input: HTMLInputElement) => {
    const raw = input.value;
    const upper = raw.toUpperCase();
    const caret = input.selectionStart ?? raw.length;
    setCompanyName(upper);
    if (upper !== raw) {
      input.value = upper;
      input.setSelectionRange(caret, caret);
      requestAnimationFrame(() => input.setSelectionRange(caret, caret));
    }
  };

  // Reject invalid characters at input time (typing, paste, autofill, IME) and
  // keep the caret where the user was, minus any rejected characters before it.
  const fullNameErrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const applyFullNameInput = (input: HTMLInputElement) => {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const strip = (s: string) => s.replace(/[^A-Za-z ]/g, "");
    const lettersAndSpaces = strip(raw);
    const cleaned = lettersAndSpaces.slice(0, 80);
    const nextCaret = Math.min(strip(raw.slice(0, caret)).length, cleaned.length);
    const message =
      raw !== lettersAndSpaces
        ? "Only letters and spaces are allowed"
        : raw !== cleaned
          ? "Name must be under 80 characters"
          : null;
    clearTimeout(fullNameErrorTimer.current);
    setFullNameInputError(message);
    if (message) {
      fullNameErrorTimer.current = setTimeout(() => setFullNameInputError(null), 1500);
    }
    setFullName(cleaned.toUpperCase());
    if (cleaned.toUpperCase() !== raw) {
      // React may not re-render when the sanitized value equals state, so
      // restore the caret both synchronously and after the frame.
      input.value = cleaned.toUpperCase();
      input.setSelectionRange(nextCaret, nextCaret);
      requestAnimationFrame(() => input.setSelectionRange(nextCaret, nextCaret));
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Not signed in.");

      await supabase.from("profiles").update({ full_name: fullName }).eq("id", uid);
      void designation;
      void yourRole;

      const resolvedName =
        companyName.trim() || (isConsultant ? `${fullName.trim()} (Independent recruiter)` : "");
      const { data: companyId, error: rpcErr } = await supabase.rpc(
        "create_company_with_owner" as never,
        {
          _name: resolvedName,
          _industry: industry || "",
          _size: size as never,
          _hq_city: hqCity || "",
          _website: website || "",
          _about: about || "",
          _founded_year:
            normalizeFoundedYear(foundedYear) && !futureYear
              ? Number(normalizeFoundedYear(foundedYear))
              : null,
          _gst: gst || "",
        } as never,
      );
      if (rpcErr || !companyId) throw rpcErr ?? new Error("Could not create company.");
      const cid = companyId as unknown as string;
      if (isConsultant) {
        await supabase
          .from("companies")
          .update({ is_consultant: true } as never)
          .eq("id", cid);
      }
      // Verification and KYC emails go to this address (see verification-notify).
      await supabase
        .from("companies")
        .update({ business_email: workEmail.trim().toLowerCase() } as never)
        .eq("id", cid);

      if (logoFile) {
        // Logo is optional: a server rejection must not block onboarding.
        try {
          await runUploadCompanyLogo({
            data: {
              companyId: cid,
              fileName: logoFile.name,
              mimeType: logoFile.type,
              dataBase64: await fileToBase64(logoFile),
            },
          });
        } catch (logoErr) {
          toast.error(logoErr instanceof Error ? logoErr.message : LOGO_TYPE_ERROR);
        }
      }

      setActiveCompanyId(cid);
      toast.success(`${resolvedName} is ready 🎉`);
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
      validate: () => {
        if (fullNameError) return fullNameError;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail.trim())) return "Enter your work email.";
        return null;
      },
      render: () => (
        <div className="space-y-6">
          <div>
            <BigInput
              placeholder="Your full name"
              value={fullName}
              onChange={(e) => {
                if (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing) {
                  setFullName(e.target.value); // sanitized on compositionend
                  return;
                }
                applyFullNameInput(e.target);
              }}
              onCompositionEnd={(e) => applyFullNameInput(e.currentTarget)}
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              aria-invalid={shouldShowFullNameError && !!fullNameError}
              aria-describedby={
                shouldShowFullNameError && fullNameError ? "employer-full-name-error" : undefined
              }
              className={
                shouldShowFullNameError && fullNameError
                  ? "border-destructive focus:border-destructive"
                  : undefined
              }
              autoFocus
            />
            {shouldShowFullNameError && fullNameError && (
              <p id="employer-full-name-error" className="mt-1 text-xs text-destructive">
                {fullNameError}
              </p>
            )}
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">Your role</p>
            <ChipChoice
              value={yourRole}
              onChange={(v) => setYourRole(v as string)}
              options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </div>
          <Field label="Designation (optional)" hint="e.g. Head of TA, Founder">
            <CityTownAutocomplete
              value={designation}
              onChange={setDesignation}
              suggestions={designationSuggestions}
              minChars={3}
              maxSuggestions={10}
              placeholder="Optional"
            />
          </Field>
          <Field required label="Work email" hint="Verification updates and approvals are sent here. Use your company email.">
            <input
              type="email"
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
              className="form-input"
              placeholder="you@yourcompany.com"
              autoComplete="email"
              aria-required="true"
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
            <input
              type="checkbox"
              checked={isConsultant}
              onChange={(e) => setIsConsultant(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              <span className="font-semibold text-foreground">
                I'm a hiring consultant / recruiter
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                You'll be asked (optionally) which company each job is for when posting.
              </span>
            </span>
          </label>
        </div>
      ),
    },
    {
      key: "company",
      title: isConsultant ? "Which firm do you represent?" : "What's your company called?",
      hint: isConsultant
        ? "Optional — leave blank if you hire for multiple firms. You can name the client company on each job post."
        : "Use your registered or commonly known brand name.",
      validate: () => {
        if (!isConsultant && companyName.trim().length < 2) return "Add your company name.";
        if (companyName.trim().length === 1) return "Add a longer name, or leave it blank.";
        if (!industry) return "Pick an industry to continue.";
        if (futureYear) {
          foundedYearRef.current?.focus();
          foundedYearRef.current?.scrollIntoView({ block: "center" });
          return FUTURE_YEAR_ERROR;
        }
        return null;
      },
      render: () => (
        <div className="space-y-6">
          <BigInput
            placeholder={
              isConsultant ? "Your consultancy name (optional)" : "Acme Logistics Pvt Ltd"
            }
            value={companyName}
            onChange={(e) => {
              if (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing) {
                setCompanyName(e.target.value); // uppercased on compositionend
              } else {
                applyConsultancyUppercase(e.target);
              }
            }}
            onCompositionEnd={(e) => applyConsultancyUppercase(e.currentTarget)}
            autoCorrect="off"
            spellCheck={false}
          />
          {isConsultant && (
            <p className="-mt-3 text-xs text-muted-foreground">
              Working across multiple firms? Skip this — we&apos;ll create an independent recruiter
              workspace and ask for the client company on each job.
            </p>
          )}
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">
              Industry{" "}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-required="true">
              {INDUSTRY_SUGGEST.map((i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={industry === i}
                  onClick={() => setIndustry(i)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${industry === i
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/80 hover:border-foreground/30"
                    }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <Field label="Team size">
            <ChipChoice
              value={size}
              onChange={(v) => setSize(v as string)}
              options={SIZES.map((s) => ({ value: s.value, label: s.label, hint: s.hint }))}
            />
          </Field>
          <OptionalSection
            title="Optional details"
            summary="Founded year — you can add this later"
            badge={foundedYear ? 1 : 0}
            hasValues={!!foundedYear}
          >
            <Field label="Founded year">
              <div className="relative">
                <input
                  ref={foundedYearRef}
                  type="number"
                  inputMode="numeric"
                  value={foundedYear}
                  aria-invalid={futureYear}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Digits only, max 4. A future year stays visible with a message.
                    if (!/^\d{0,4}$/.test(v)) return;
                    setFoundedYear(v);
                  }}
                  onKeyDown={(e) => {
                    if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
                    if (digits) setFoundedYear(digits);
                  }}
                  onBlur={() => setFoundedYear((v) => normalizeFoundedYear(v))}
                  className={`form-input pr-8 ${futureYear ? "border-destructive" : ""} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                  placeholder="2018"
                  min={MIN_FOUNDED_YEAR}
                  max={CURRENT_YEAR}
                />
                <div className="absolute inset-y-0 right-0 flex w-8 flex-col">
                  {([1, -1] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      tabIndex={-1}
                      aria-label={dir === 1 ? "Increase year" : "Decrease year"}
                      disabled={dir === 1 ? yearAtMax : yearAtMin}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => stepFoundedYear(dir)}
                      className="flex flex-1 items-center justify-center text-muted-foreground disabled:opacity-30"
                    >
                      {dir === 1 ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {futureYear && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {FUTURE_YEAR_ERROR}
                </p>
              )}
            </Field>
          </OptionalSection>
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
                className={`rounded-xl border-2 px-4 py-2.5 text-sm font-semibold ${hqCity === c
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-card text-foreground/80 hover:border-foreground/30"
                  }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Field label="Other city">
            <CityTownAutocomplete
              value={TOP_CITIES.includes(hqCity) ? "" : hqCity}
              onChange={setHqCity}
              suggestions={INDIAN_CITIES.filter((c) => !TOP_CITIES.includes(c))}
              placeholder="Search for your city…"
              showDropdownIndicator
            />
          </Field>
        </div>
      ),
    },
    {
      key: "brand",
      title: "Add your brand & proof",
      hint: "Verified, branded employers get 4× more applications. All optional — you can complete later.",
      // Website and GST are both optional at this step (can be added later
      // from Company → KYC), but if something is typed it must be valid
      // before continuing.
      validate: () => validateWebsite(website) ?? validateGstin(gst),
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
                accept={LOGO_ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  const err = f ? checkLogoFile(f) : null;
                  if (err) toast.error(err);
                  setLogoFile(err ? null : f);
                  if (err) e.target.value = "";
                }}
              />
            </label>
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
          <OptionalSection
            title="Optional details"
            summary="Website & GST — can be added later"
            badge={(website ? 1 : 0) + (gst ? 1 : 0)}
            hasValues={!!website || !!gst}
          >
            <Field label="Website">
              <input
                type="text"
                value={website}
                onChange={(e) => setWebsite(sanitizeWebsiteInput(e.target.value))}
                className="form-input"
                placeholder="example.com"
                aria-invalid={!!website && !!validateWebsite(website)}
              />
              {!!website && validateWebsite(website) && (
                <p className="mt-1 text-xs text-destructive">{validateWebsite(website)}</p>
              )}
            </Field>
            <Field
              label="GST number"
              hint="Required for the verified employer badge — you can add this later from Company → KYC."
            >
              <input
                value={gst}
                onChange={(e) => setGst(sanitizeGstinInput(e.target.value))}
                className="form-input"
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
                aria-invalid={gst.length === 15 && !!validateGstin(gst)}
              />
              {gst.length === 15 && validateGstin(gst) && (
                <p className="mt-1 text-xs text-destructive">{validateGstin(gst)}</p>
              )}
            </Field>
          </OptionalSection>
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
            {
              value: "yes",
              label: "Yes — post my first job now",
              hint: "Recommended · 3 min wizard",
            },
            {
              value: "later",
              label: "Maybe later — show me the dashboard",
              hint: "Browse around first",
            },
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

import { StateDropdown } from "@/components/candidate/StateDropdown";
import { CityTownAutocomplete } from "@/components/candidate/CityTownAutocomplete";
import { JobTitleAutocomplete } from "@/components/candidate/JobTitleAutocomplete";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { downloadJdPdf } from "@/lib/jd-pdf";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field, ChipInput } from "@/components/candidate/primitives";
import { ConditionalField } from "@/components/forms/ConditionalField";
import { OptionalSection } from "@/components/forms/OptionalSection";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, setActiveCompanyId } from "@/lib/employer";
import {
  INDIAN_CITIES,
  JOB_TYPE_OPTIONS,
  WORK_MODES,
  EDUCATION_LEVELS,
  SUGGESTED_SKILLS,
  JOB_CATEGORIES,
  INDUSTRIES,
  PERKS,
  PAY_TYPES,
  GENDERS,
  EXPERIENCE_BUCKETS,
  ENGLISH_LEVELS,
  INTERVIEW_TYPES,
  SHIFTS,
  SUGGESTED_LANGUAGES,
  ASSETS,
} from "@/lib/options";
import { buildJd, type JdInput } from "@/lib/jd-template";
import { getRecommendedSkills } from "@/lib/skill-engine";
import { getRoleBenchmarks } from "@/lib/salary-benchmarks";
import { polishJobDescription } from "@/lib/jd-polish.functions";
import {
  computeJobQuality,
  getMissingJobImprovements,
  type JobQualityInput,
} from "@/lib/jobQuality";
import { inferJobDraft, type CompanyHistoryJob, type InferResult } from "@/lib/job-draft-infer";
import { JobQualityMeter } from "@/components/employer/JobQualityMeter";
import { SalarySuggestionCard } from "@/components/employer/SalarySuggestionCard";
import { AssumedFieldsStrip, type AssumedChipKey } from "@/components/employer/AssumedFieldsStrip";
import {
  activateJobWithTier,
  getCompanyEntitlements,
  mapTierError,
  type JobTier,
} from "@/lib/jobs.functions";
import { TierPicker } from "@/components/employer/TierPicker";

type Form = {
  title: string;
  category: string;
  industry: string;
  job_type: string;
  work_mode: string;
  openings: number;
  gender_pref: string;

  city: string;
  locality: string;
  pincode: string;
  pay_type: "fixed" | "fixed_incentive" | "incentive_only" | "";
  min_salary: string;
  max_salary: string;
  avg_incentive: string;
  salary_period: string;
  interview_type: "in_person" | "telephonic" | "";
  interview_same_as_company: boolean;
  interview_city: string;
  interview_locality: string;
  interview_address: string;

  experience_bucket: "any" | "fresher" | "experienced";
  min_experience_years: string;
  max_experience_years: string;
  english_level: string;
  skills: string[];
  age_min: string;
  age_max: string;
  preferred_languages: string[];
  required_assets: string[];
  degree: string;
  specialisation: string;
  certifications: string[];
  preferred_industries: string[];
  perks: string[];
  joining_fee_required: boolean;
  shift: string;
  working_days: string;

  description: string;
  description_html: string;
  hiring_for_company: string;
};

const initialForm: Form = {
  title: "",
  category: "",
  industry: "",
  job_type: "",
  work_mode: "",
  openings: 1,
  gender_pref: "any",
  city: "",
  locality: "",
  pincode: "",
  pay_type: "",
  min_salary: "",
  max_salary: "",
  avg_incentive: "",
  salary_period: "monthly",
  interview_type: "in_person",
  interview_same_as_company: true,
  interview_city: "",
  interview_locality: "",
  interview_address: "",
  experience_bucket: "any",
  min_experience_years: "0",
  max_experience_years: "",
  english_level: "",
  skills: [],
  age_min: "",
  age_max: "",
  preferred_languages: [],
  required_assets: [],
  degree: "",
  specialisation: "",
  certifications: [],
  preferred_industries: [],
  perks: [],
  joining_fee_required: false,
  shift: "",
  working_days: "",
  description: "",
  description_html: "",
  hiring_for_company: "",
};

// Only the columns the wizard reads back when editing an existing job.
type JobRow = {
  title: string;
  category: string | null;
  industry: string | null;
  job_type: string;
  work_mode: string;
  openings: number | null;
  gender_pref: string | null;
  city: string | null;
  locality: string | null;
  pincode: string | null;
  pay_type: string | null;
  min_salary: number | null;
  max_salary: number | null;
  avg_incentive_monthly: number | null;
  salary_period: string | null;
  interview_type: string | null;
  interview_same_as_company: boolean | null;
  interview_city: string | null;
  interview_locality: string | null;
  interview_address: string | null;
  experience_bucket: string | null;
  min_experience_years: number | null;
  max_experience_years: number | null;
  english_level: string | null;
  skills: string[] | null;
  age_min: number | null;
  age_max: number | null;
  preferred_languages: string[] | null;
  required_assets: string[] | null;
  education: string | null;
  specialisation: string | null;
  certifications: string[] | null;
  preferred_industries: string[] | null;
  perks: string[] | null;
  joining_fee_required: boolean | null;
  shift: string | null;
  working_days: number | null;
  description: string | null;
  description_html: string | null;
  hiring_for_company: string | null;
  status: string;
};

function jobToForm(job: JobRow): Form {
  return {
    title: job.title ?? "",
    category: job.category ?? "",
    industry: job.industry ?? "",
    job_type: job.job_type ?? "full_time",
    work_mode: job.work_mode ?? "onsite",
    openings: job.openings ?? 1,
    gender_pref: job.gender_pref ?? "any",
    city: job.city ?? "",
    locality: job.locality ?? "",
    pincode: job.pincode ?? "",
    pay_type: (job.pay_type as Form["pay_type"]) || "",
    min_salary: job.min_salary != null ? String(job.min_salary) : "",
    max_salary: job.max_salary != null ? String(job.max_salary) : "",
    avg_incentive: job.avg_incentive_monthly != null ? String(job.avg_incentive_monthly) : "",
    salary_period: job.salary_period ?? "monthly",
    interview_type: (job.interview_type as Form["interview_type"]) || "",
    interview_same_as_company: job.interview_same_as_company ?? true,
    interview_city: job.interview_city ?? "",
    interview_locality: job.interview_locality ?? "",
    interview_address: job.interview_address ?? "",
    experience_bucket: (job.experience_bucket as Form["experience_bucket"]) || "any",
    min_experience_years: job.min_experience_years != null ? String(job.min_experience_years) : "0",
    max_experience_years: job.max_experience_years != null ? String(job.max_experience_years) : "",
    english_level: job.english_level ?? "",
    skills: job.skills ?? [],
    age_min: job.age_min != null ? String(job.age_min) : "",
    age_max: job.age_max != null ? String(job.age_max) : "",
    preferred_languages: job.preferred_languages ?? [],
    required_assets: job.required_assets ?? [],
    degree: job.education ?? "",
    specialisation: job.specialisation ?? "",
    certifications: job.certifications ?? [],
    preferred_industries: job.preferred_industries ?? [],
    perks: job.perks ?? [],
    joining_fee_required: job.joining_fee_required ?? false,
    shift: job.shift ?? "",
    working_days: job.working_days != null ? String(job.working_days) : "",
    description: job.description ?? "",
    description_html: job.description_html ?? "",
    hiring_for_company: job.hiring_for_company ?? "",
  };
}

// Shared by both the create ("Post a job") and edit flows — everything that
// differs (insert vs update, status handling, footer buttons) branches on
// whether `editJobId` is set.
function buildFieldsFromForm(
  form: Form,
  jdInput: JdInput,
  isConsultant: boolean,
): Record<string, unknown> {
  let descMd = form.description;
  let descHtml = form.description_html;
  if (!descHtml) {
    const jd = buildJd(jdInput);
    descMd = jd.markdown;
    descHtml = jd.html;
  }

  const validJobTypes = new Set(JOB_TYPE_OPTIONS.map((o) => o.id));
  const validModes = new Set(WORK_MODES.map((o) => o.id));
  const jobType = validJobTypes.has(form.job_type) ? form.job_type : "full_time";
  const workMode = validModes.has(form.work_mode) ? form.work_mode : "onsite";

  const p: Record<string, unknown> = {
    title: form.title.trim(),
    description: descMd,
    description_html: descHtml,
    job_type: jobType,
    work_mode: workMode,
    openings: Number(form.openings) || 1,
    salary_period: "monthly",
    skills: form.skills,
    perks: form.perks,
    gender_pref: form.gender_pref,
    pay_type: form.pay_type || null,
    experience_bucket: form.experience_bucket,
    joining_fee_required: form.joining_fee_required,
    preferred_languages: form.preferred_languages,
    required_assets: form.required_assets,
    certifications: form.certifications,
    preferred_industries: form.preferred_industries,
  };
  if (form.category) p.category = form.category;
  if (form.industry) p.industry = form.industry;
  if (form.city) p.city = form.city;
  if (form.locality) p.locality = form.locality;
  if (form.pincode) p.pincode = form.pincode;
  if (form.pay_type !== "incentive_only") {
    if (form.min_salary) p.min_salary = Number(form.min_salary);
    if (form.max_salary) p.max_salary = Number(form.max_salary);
  }
  if (form.pay_type !== "fixed" && form.avg_incentive)
    p.avg_incentive_monthly = Number(form.avg_incentive);
  if (form.interview_type) p.interview_type = form.interview_type;
  p.interview_same_as_company = form.interview_same_as_company;
  if (form.interview_type === "in_person" && !form.interview_same_as_company) {
    if (form.interview_city) p.interview_city = form.interview_city;
    if (form.interview_locality) p.interview_locality = form.interview_locality;
    if (form.interview_address) p.interview_address = form.interview_address;
  }
  if (form.min_experience_years !== "") p.min_experience_years = Number(form.min_experience_years);
  if (form.max_experience_years !== "") p.max_experience_years = Number(form.max_experience_years);
  if (form.english_level) p.english_level = form.english_level;
  if (form.age_min) p.age_min = Number(form.age_min);
  if (form.age_max) p.age_max = Number(form.age_max);
  if (form.degree) p.education = form.degree;
  if (form.shift) p.shift = form.shift;
  if (form.working_days) p.working_days = Number(form.working_days);
  if (isConsultant && form.hiring_for_company.trim())
    p.hiring_for_company = form.hiring_for_company.trim();
  return p;
}

const HISTORY_COLUMNS =
  "title, category, industry, job_type, work_mode, city, pay_type, min_salary, max_salary, avg_incentive_monthly, experience_bucket, min_experience_years, max_experience_years, skills, perks, shift, working_days, english_level";

export function JobWizard({ editJobId }: { editJobId?: string }) {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isConsultant, setIsConsultant] = useState(false);
  const [form, setForm] = useState<Form>(initialForm);

  // Confirm-a-draft: company history + JD library inference, dirty tracking,
  // and the quality meter. See docs/superpowers/specs/2026-09-23-job-posting-confirm-draft-design.md.
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<CompanyHistoryJob[]>([]);
  const [inferring, setInferring] = useState(false);
  const [inferSources, setInferSources] = useState<InferResult["sources"]>({});
  const [matchedHistoryTitle, setMatchedHistoryTitle] = useState<string | null>(null);
  const [jdDirty, setJdDirty] = useState(false);
  const [showArea, setShowArea] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Tier-3 skill recommendations: real usage from live postings for similar
  // roles (suggest_skills_for_roles RPC), merged with the tier-1/tier-2
  // client-side lists in skill-engine.ts. Kept out of that pure module since
  // it needs a network call.
  const [marketSkills, setMarketSkills] = useState<string[]>([]);
  const [jdStyle, setJdStyle] = useState<"standard" | "quick_read" | "detailed">("standard");
  const [polishing, setPolishing] = useState(false);

  // Job Types (Classic / Classic+ / Trending) — tier picker + entitlements.
  // jobStatus mirrors the loaded job's DB status in edit mode: a still-draft
  // job can be tiered and published from here; an already-active job cannot
  // (tier upgrades on live jobs are out of scope — see job-types-implementation.md).
  const [tier, setTier] = useState<JobTier>("classic");
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<Awaited<
    ReturnType<typeof getCompanyEntitlements>
  > | null>(null);
  const canPickTier = !editJobId || jobStatus === "draft";
  const runGetEntitlements = useServerFn(getCompanyEntitlements);
  const runActivateJobWithTier = useServerFn(activateJobWithTier);

  useEffect(() => {
    (async () => {
      try {
        setCompanyLoading(true);
        setSetupError(null);
        if (new URLSearchParams(window.location.search).get("__cityQa") === "1") {
          setUserId("visual-qa");
          setCompanyId("visual-qa");
          setCompanyName("JobsKart QA");
          setStep(1);
          setForm((current) => ({ ...current, city: "Varanasi" }));
          return;
        }
        const { data: user, error } = await supabase.auth.getUser();
        if (error || !user.user) {
          setSetupError("Your session expired. Please sign in again.");
          return;
        }
        setUserId(user.user.id);
        const memberships = await fetchMyCompanies(user.user.id);
        const storedId = getActiveCompanyId();
        const chosen = memberships.find((m) => m.company_id === storedId) ?? memberships[0] ?? null;
        if (!chosen) {
          setSetupError("Finish your company setup before posting a job.");
          return;
        }
        setActiveCompanyId(chosen.company_id);
        setCompanyId(chosen.company_id);
        setCompanyName(chosen.companies?.name || "our company");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: co } = await supabase
          .from("companies")
          .select("is_consultant" as any)
          .eq("id", chosen.company_id)
          .maybeSingle();
        setIsConsultant(Boolean((co as { is_consultant?: boolean } | null)?.is_consultant));

        if (editJobId) {
          const { data: job, error: jobErr } = await supabase
            .from("jobs")
            .select("*")
            .eq("id", editJobId)
            .eq("company_id", chosen.company_id)
            .maybeSingle();
          if (jobErr || !job) {
            setSetupError("This job couldn't be found, or you don't have access to edit it.");
            return;
          }
          const jobForm = jobToForm(job as unknown as JobRow);
          setForm(jobForm);
          // Edit mode never re-infers over saved values — every loaded field
          // starts dirty so history/library inference leaves it alone.
          setDirty(new Set(Object.keys(jobForm)));
          setJdDirty(Boolean((job as unknown as JobRow).description));
          setShowArea(
            Boolean((job as unknown as JobRow).locality || (job as unknown as JobRow).pincode),
          );
          setJobStatus((job as unknown as JobRow).status);
        } else {
          const { data: hist, error: histErr } = await supabase
            .from("jobs")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .select(HISTORY_COLUMNS as any)
            .eq("company_id", chosen.company_id)
            .order("created_at", { ascending: false })
            .limit(10);
          if (!histErr && hist) setHistory(hist as unknown as CompanyHistoryJob[]);
        }
      } catch (e) {
        setSetupError(e instanceof Error ? e.message : "Could not load your company setup.");
      } finally {
        setCompanyLoading(false);
      }
    })();
  }, [editJobId]);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      try {
        setEntitlements(await runGetEntitlements({ data: { companyId } }));
      } catch {
        // Entitlements are advisory here (quota/price preview) — publish still
        // enforces them server-side, so a failed preview fetch shouldn't block the wizard.
      }
    })();
  }, [companyId, runGetEntitlements]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Every user-facing control (as opposed to inference) routes through this so
  // a later re-infer (title change, history load) never overwrites a value the
  // recruiter already confirmed or edited themselves.
  const markDirty = <K extends keyof Form>(k: K, v: Form[K]) => {
    setDirty((d) => {
      const next = new Set(d);
      next.add(k as string);
      return next;
    });
    set(k, v);
  };

  // These numeric fields are kept as strings (so the input can be briefly
  // empty while typing), but must never be allowed to hold a negative number —
  // strips a leading "-" as it's typed and floors any parsed value at 0.
  type NonNegativeField =
    | "min_salary"
    | "max_salary"
    | "avg_incentive"
    | "min_experience_years"
    | "max_experience_years"
    | "age_min"
    | "age_max";
  const setNonNegative = (k: NonNegativeField, v: string) => markDirty(k, v.replace(/^-+/, ""));
  const stepNonNegative = (k: NonNegativeField, delta: number) =>
    markDirty(k, String(Math.max(0, (Number(form[k]) || 0) + delta)));

  // Company history + JD library inference — create flow only, skipped once a
  // field is dirty. Debounced 400ms after the title stops changing; `dirty`
  // is read from a ref so this effect doesn't re-fire on every keystroke of an
  // unrelated field.
  useEffect(() => {
    if (editJobId) return;
    const title = form.title.trim();
    if (title.length < 3) return;
    setInferring(true);
    const t = setTimeout(() => {
      const result = inferJobDraft({ title, history, dirty: dirtyRef.current });
      setForm((f) => ({ ...f, ...result.patch }));
      setInferSources(result.sources);
      setMatchedHistoryTitle(result.matchedHistoryTitle);
      setInferring(false);
    }, 400);
    return () => clearTimeout(t);
  }, [form.title, history, editJobId]);

  // Tier-3 market-trend skills — debounced the same way as inference above.
  useEffect(() => {
    const title = form.title.trim();
    if (title.length < 3) {
      setMarketSkills([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("suggest_skills_for_roles", { _roles: [title] });
      setMarketSkills(((data ?? []) as { name: string }[]).map((r) => r.name));
    }, 500);
    return () => clearTimeout(t);
  }, [form.title]);

  const jdInput: JdInput = useMemo(
    () => ({
      title: form.title,
      companyName,
      industry: form.industry,
      category: form.category,
      city: form.city,
      style: jdStyle,
      workMode: form.work_mode,
      jobType: form.job_type,
      payType: form.pay_type || "fixed",
      minSalary: form.min_salary ? Number(form.min_salary) : undefined,
      maxSalary: form.max_salary ? Number(form.max_salary) : undefined,
      avgIncentive: form.avg_incentive ? Number(form.avg_incentive) : undefined,
      experienceBucket: form.experience_bucket,
      minExp: form.min_experience_years ? Number(form.min_experience_years) : undefined,
      maxExp: form.max_experience_years ? Number(form.max_experience_years) : undefined,
      degree: form.degree,
      specialisation: form.specialisation,
      skills: form.skills,
      englishLevel: (form.english_level || undefined) as JdInput["englishLevel"],
      gender: form.gender_pref as JdInput["gender"],
      shift: form.shift || undefined,
      workingDays: form.working_days ? Number(form.working_days) : undefined,
      assets: form.required_assets,
      perks: form.perks,
      joiningFeeRequired: form.joining_fee_required,
      certifications: form.certifications,
      ageMin: form.age_min ? Number(form.age_min) : undefined,
      ageMax: form.age_max ? Number(form.age_max) : undefined,
      preferredLanguages: form.preferred_languages,
      preferredIndustries: form.preferred_industries,
    }),
    [form, companyName, jdStyle],
  );

  // Same rubric as compute_job_quality() in the DB (see the job_quality_score
  // migration's header) — kept in lockstep so the live number the recruiter
  // sees here never drifts from the badge shown after publishing.
  const qualityInput: JobQualityInput = useMemo(
    () => ({
      title: form.title,
      category: form.category,
      industry: form.industry,
      city: form.city,
      locality: form.locality,
      job_type: form.job_type,
      work_mode: form.work_mode,
      openings: Number(form.openings) || 0,
      pay_type: form.pay_type,
      min_salary: form.min_salary ? Number(form.min_salary) : null,
      max_salary: form.max_salary ? Number(form.max_salary) : null,
      avg_incentive_monthly: form.avg_incentive ? Number(form.avg_incentive) : null,
      experience_bucket: form.experience_bucket,
      skills: form.skills,
      education: form.degree,
      certifications: form.certifications,
      preferred_languages: form.preferred_languages,
      description: form.description,
      description_html: form.description_html,
      perks: form.perks,
      interview_type: form.interview_type,
      shift: form.shift,
      working_days: form.working_days ? Number(form.working_days) : null,
      pincode: form.pincode,
    }),
    [form],
  );
  const qualityGaps = useMemo(() => getMissingJobImprovements(qualityInput), [qualityInput]);
  const qualityScore = useMemo(() => computeJobQuality(qualityInput), [qualityInput]);
  const [lowScoreConfirmOpen, setLowScoreConfirmOpen] = useState(false);

  // One-shot celebration when the score crosses into Excellent (80+) —
  // gamification per the quality-score plan, presentation only.
  const prevQualityRef = useRef(qualityScore);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    const prev = prevQualityRef.current;
    prevQualityRef.current = qualityScore;
    if (prev < 80 && qualityScore >= 80) {
      toast.success("Excellent post! Top 10% quality.");
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 1600);
      return () => clearTimeout(t);
    }
  }, [qualityScore]);

  // JD stays live from title/pay/skills/etc until the recruiter edits the
  // textarea directly (jdDirty) — then only Regenerate touches it again.
  useEffect(() => {
    if (jdDirty) return;
    if (!form.title.trim()) return;
    const jd = buildJd(jdInput);
    setForm((f) => ({ ...f, description: jd.markdown, description_html: jd.html }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jdInput, jdDirty]);

  const regenerate = () => {
    setJdDirty(false);
    const jd = buildJd(jdInput);
    setForm((f) => ({ ...f, description: jd.markdown, description_html: jd.html }));
    toast.success("JD regenerated from your inputs.");
  };

  const validateStep = (targetStep: number): string | null => {
    if (targetStep === 0) {
      if (!form.title.trim()) return "Add a job title.";
      if (!form.category) return "Pick a category.";
      if (!form.industry) return "Pick an industry.";
    }
    if (targetStep === 1) {
      if (!form.city) return "Pick a city.";
      if (!form.pay_type) return "Select a pay type.";
      if (form.pincode && form.pincode.length !== 6) return "Pincode must be 6 digits.";
      if (form.min_salary && form.max_salary && Number(form.max_salary) < Number(form.min_salary))
        return "Max salary must be higher than min salary.";
      if (form.interview_type === "in_person" && !form.interview_same_as_company) {
        if (!form.interview_city || !form.interview_address) return "Add interview city & address.";
      }
    }
    if (targetStep === 2) {
      if (!form.skills.length) return "Add at least one required skill.";
    }
    return null;
  };

  const next = () => {
    const err = validateStep(step);
    if (err) return toast.error(err);
    if (step < 3) setStep(step + 1);
  };

  const publish = async (asDraft = false) => {
    if (!companyId) {
      toast.error("Finish company setup first.");
      nav({ to: "/onboarding/employer" });
      return;
    }
    if (!form.title.trim()) return toast.error("Add a job title first.");
    if (!asDraft) {
      for (let i = 0; i <= 2; i += 1) {
        const err = validateStep(i);
        if (err) {
          setStep(i);
          toast.error(err);
          return;
        }
      }
    }
    setSaving(true);
    try {
      let uid = userId;
      if (!uid) {
        const { data: userRes } = await supabase.auth.getUser();
        uid = userRes.user?.id ?? null;
        if (!uid) throw new Error("Session expired. Please sign in again.");
        setUserId(uid);
      }

      // The DB only ever accepts a draft insert now (see
      // 20260924100211_job_tiers_posting.sql) — publishing a fresh job is a
      // draft insert immediately followed by activate_job_with_tier(), which
      // is the one place tier entitlement checks + credit charging happen.
      const p: Record<string, unknown> = {
        company_id: companyId,
        posted_by: uid,
        status: "draft",
        ...buildFieldsFromForm(form, jdInput, isConsultant),
      };

      const { data, error } = await supabase
        .from("jobs")
        .insert(p as never)
        .select("id")
        .single();
      if (error) {
        console.error("[jobs.publish]", error);
        const code = (error as { code?: string }).code;
        if (code === "42501") toast.error("You don't have permission to post for this company.");
        else if (code === "23502") toast.error("A required field is missing.");
        else toast.error(error.message || "Could not publish the job.");
        return;
      }
      const jobId = (data as { id: string }).id;

      if (asDraft) {
        toast.success("Saved as draft.");
        nav({ to: "/employer/jobs" });
        return;
      }

      try {
        await runActivateJobWithTier({ data: { jobId, tier } });
        toast.success("Job published! Candidates can apply now.");
        nav({ to: "/employer/jobs/$jobId/applicants", params: { jobId } });
      } catch (activateErr) {
        toast.error(
          `Saved as draft — publishing failed: ${mapTierError(activateErr instanceof Error ? activateErr.message : "Unknown error")}`,
        );
        nav({ to: "/employer/jobs" });
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setSaving(false);
    }
  };

  // Edit mode never re-charges tier cost or touches status for an already-live
  // job — saveEdit only ever updates the fields a "Post a job" submission
  // would otherwise set. A still-draft job gets an explicit second button
  // ("Publish job") that saves fields then calls activate_job_with_tier —
  // saving a draft edit must never silently publish it.
  const saveEdit = async (thenPublish = false) => {
    if (!editJobId) return;
    if (!form.title.trim()) return toast.error("Add a job title first.");
    if (thenPublish) {
      for (let i = 0; i <= 2; i += 1) {
        const err = validateStep(i);
        if (err) {
          setStep(i);
          toast.error(err);
          return;
        }
      }
    }
    setSaving(true);
    try {
      const fields = buildFieldsFromForm(form, jdInput, isConsultant);
      const { error } = await supabase
        .from("jobs")
        .update(fields as never)
        .eq("id", editJobId);
      if (error) {
        console.error("[jobs.edit]", error);
        toast.error(error.message || "Could not save changes.");
        return;
      }

      if (!thenPublish) {
        toast.success("Job updated.");
        nav({ to: "/employer/jobs" });
        return;
      }

      try {
        await runActivateJobWithTier({ data: { jobId: editJobId, tier } });
        toast.success("Job published! Candidates can apply now.");
        nav({ to: "/employer/jobs/$jobId/applicants", params: { jobId: editJobId } });
      } catch (activateErr) {
        toast.error(
          `Changes saved — publishing failed: ${mapTierError(activateErr instanceof Error ? activateErr.message : "Unknown error")}`,
        );
        nav({ to: "/employer/jobs" });
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  const steps = ["Basics", "Location & Pay", "Requirements", "Description"];

  const earning = useMemo(() => {
    const min = Number(form.min_salary || 0);
    const max = Number(form.max_salary || form.min_salary || 0);
    const inc = Number(form.avg_incentive || 0);
    const fixedLo = form.pay_type === "incentive_only" ? 0 : min;
    const fixedHi = form.pay_type === "incentive_only" ? 0 : max;
    const totalLo =
      fixedLo +
      (form.pay_type === "fixed_incentive" ? 0 : form.pay_type === "incentive_only" ? 0 : 0);
    const totalHi = fixedHi + (form.pay_type !== "fixed" ? inc : 0);
    return { fixedLo, fixedHi, inc, totalLo, totalHi };
  }, [form.min_salary, form.max_salary, form.avg_incentive, form.pay_type]);

  const hiringPrefFilled = [
    form.english_level,
    form.gender_pref !== "any" ? form.gender_pref : "",
    form.age_min,
    form.age_max,
    form.preferred_languages.length,
    form.preferred_industries.length,
  ].filter(Boolean).length;
  const reqPerksFilled = [
    form.degree,
    form.specialisation,
    form.certifications.length,
    form.required_assets.length,
    form.perks.length,
  ].filter(Boolean).length;

  const onAssumedChange = (key: AssumedChipKey, value: string | boolean) => {
    if (key === "joining_fee_required") {
      markDirty("joining_fee_required", Boolean(value));
    } else if (key === "interview_type") {
      markDirty("interview_type", value as Form["interview_type"]);
      // Custom interview address (set via Advanced) is a deliberate choice —
      // only reset to "same as company" if the recruiter hasn't touched that yet.
      if (value === "in_person" && !dirty.has("interview_same_as_company")) {
        set("interview_same_as_company", true);
      }
    } else {
      markDirty(key as keyof Form, value as never);
    }
  };

  return (
    <EmployerShell
      title={editJobId ? "Edit job" : "Post a job"}
      subtitle={
        editJobId
          ? "Update any field, then save your changes."
          : "We'll draft this from the title — you confirm pay and skills."
      }
    >
      <div className="mx-auto max-w-3xl">
        {companyLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-card" />
        ) : setupError ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-bold">
              {editJobId ? "Couldn't load job" : "Company setup required"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{setupError}</p>
            {editJobId ? (
              <button
                onClick={() => nav({ to: "/employer/jobs" })}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Back to jobs
              </button>
            ) : (
              <button
                onClick={() => nav({ to: "/onboarding/employer" })}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Complete company setup
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="mb-6">
              <div className="flex items-center gap-2">
                {steps.map((s, i) => (
                  <div
                    key={s}
                    className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-border"}`}
                  />
                ))}
              </div>
              <p className="mt-2 text-xs font-medium text-primary sm:hidden">
                Step {step + 1} of {steps.length} · {steps[step]}
              </p>
              <div className="mt-1 hidden gap-2 sm:flex">
                {steps.map((s, i) => {
                  const stepDone = !qualityGaps.some((g) => g.step === i);
                  return (
                    <p
                      key={s}
                      className={`flex flex-1 items-center gap-1 truncate text-xs font-medium ${i === step ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {i + 1}. {s}
                      {stepDone && <Check className="h-3 w-3 shrink-0 text-success" />}
                    </p>
                  );
                })}
              </div>
            </div>

            <JobQualityMeter
              score={qualityScore}
              gaps={qualityGaps}
              celebrate={celebrate}
              onGapClick={(s) => setStep(s)}
            />

            <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              {step < 3 && (
                <AssumedFieldsStrip
                  inferring={inferring}
                  values={{
                    job_type: form.job_type,
                    work_mode: form.work_mode,
                    category: form.category,
                    industry: form.industry,
                    gender_pref: form.gender_pref,
                    interview_type: form.interview_type,
                    interview_same_as_company: form.interview_same_as_company,
                    joining_fee_required: form.joining_fee_required,
                  }}
                  sources={inferSources}
                  matchedHistoryTitle={matchedHistoryTitle}
                  onChange={onAssumedChange}
                />
              )}

              {step === 0 && (
                <div className="space-y-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
                    {steps[0]}
                  </p>
                  <Field
                    label="Job title"
                    required
                    emphasis
                    hint="e.g. Delivery Executive, Security Guard"
                  >
                    <JobTitleAutocomplete
                      value={form.title}
                      onChange={(v) => set("title", v)}
                      placeholder="Enter a clear, descriptive title"
                    />
                  </Field>
                  <Field label="Openings">
                    {/* Desktop (sm: and up): unchanged native number input with its own
                        native spin arrows — untouched. Mobile only: the native spinner
                        is explicitly disabled (appearance-none) and replaced with a
                        custom dark stepper overlaid on the same input, since mobile
                        Safari/Chrome render it faint/inconsistently at best. */}
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        value={form.openings}
                        onChange={(e) => markDirty("openings", Number(e.target.value))}
                        className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                      />
                      <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                        <button
                          type="button"
                          aria-label="Increase openings"
                          onClick={() =>
                            markDirty("openings", Math.max(1, (Number(form.openings) || 0) + 1))
                          }
                          className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                        >
                          <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                        </button>
                        <button
                          type="button"
                          aria-label="Decrease openings"
                          onClick={() =>
                            markDirty("openings", Math.max(1, (Number(form.openings) || 0) - 1))
                          }
                          className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                        >
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                        </button>
                      </div>
                    </div>
                  </Field>
                  {isConsultant && (
                    <Field
                      label="Company you're hiring for"
                      hint="Optional — shown to candidates so they know the actual employer."
                    >
                      <input
                        value={form.hiring_for_company}
                        onChange={(e) => markDirty("hiring_for_company", e.target.value)}
                        className="form-input"
                        placeholder="e.g. Acme Retail Pvt Ltd"
                      />
                    </Field>
                  )}
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
                    {steps[1]}
                  </p>
                  <Field label="City" required>
                    <CityTownAutocomplete
                      value={form.city}
                      suggestions={INDIAN_CITIES}
                      placeholder="Select or type city"
                      onChange={(v) => markDirty("city", v)}
                      showDropdownIndicator
                    />
                  </Field>

                  {!showArea && (
                    <button
                      type="button"
                      className="text-sm font-semibold text-primary"
                      onClick={() => setShowArea(true)}
                    >
                      + Add area (locality, pincode)
                    </button>
                  )}
                  <ConditionalField visible={showArea}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Locality">
                        <input
                          value={form.locality}
                          onChange={(e) => markDirty("locality", e.target.value)}
                          className="form-input"
                          placeholder="Andheri East"
                        />
                      </Field>
                      <Field label="Pincode">
                        <input
                          maxLength={6}
                          value={form.pincode}
                          onChange={(e) => markDirty("pincode", e.target.value.replace(/\D/g, ""))}
                          className="form-input"
                        />
                      </Field>
                    </div>
                  </ConditionalField>

                  {form.title.trim() && form.category && (
                    <SalarySuggestionCard
                      title={form.title}
                      category={form.category}
                      city={form.city}
                      experienceBucket={form.experience_bucket || "any"}
                      payType={form.pay_type || "fixed"}
                      minSalary={form.min_salary}
                      maxSalary={form.max_salary}
                      companyId={companyId}
                      onUseRange={(min, max, extra) => {
                        if (extra?.payType)
                          markDirty("pay_type", extra.payType as Form["pay_type"]);
                        markDirty("min_salary", String(Math.round(min)));
                        set("max_salary", String(Math.round(max)));
                        if (extra?.avgIncentive) set("avg_incentive", String(extra.avgIncentive));
                      }}
                    />
                  )}

                  <div>
                    <p className="mb-1.5 text-sm font-medium">
                      Compensation · Pay type <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {PAY_TYPES.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            markDirty(
                              "pay_type",
                              form.pay_type === p.id ? "" : (p.id as Form["pay_type"]),
                            )
                          }
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.pay_type === p.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ConditionalField
                    visible={form.pay_type === "fixed" || form.pay_type === "fixed_incentive"}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Fixed min / month (₹)" emphasis>
                        {/* Desktop (sm: and up): unchanged native number input with its own
                            native spin arrows. Mobile only: native spinner disabled and
                            replaced with the same custom dark stepper used for Openings,
                            so every number field looks consistent on mobile. */}
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            value={form.min_salary}
                            onChange={(e) => setNonNegative("min_salary", e.target.value)}
                            className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                            placeholder="15000"
                          />
                          <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                            <button
                              type="button"
                              aria-label="Increase fixed min salary"
                              onClick={() => stepNonNegative("min_salary", 1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                            <button
                              type="button"
                              aria-label="Decrease fixed min salary"
                              onClick={() => stepNonNegative("min_salary", -1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </Field>
                      <Field label="Fixed max / month (₹)" emphasis>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            value={form.max_salary}
                            onChange={(e) => setNonNegative("max_salary", e.target.value)}
                            className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                            placeholder="25000"
                          />
                          <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                            <button
                              type="button"
                              aria-label="Increase fixed max salary"
                              onClick={() => stepNonNegative("max_salary", 1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                            <button
                              type="button"
                              aria-label="Decrease fixed max salary"
                              onClick={() => stepNonNegative("max_salary", -1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </Field>
                    </div>
                  </ConditionalField>
                  <ConditionalField
                    visible={
                      form.pay_type === "fixed_incentive" || form.pay_type === "incentive_only"
                    }
                  >
                    <Field label="Average incentive / month (₹)">
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={form.avg_incentive}
                          onChange={(e) => setNonNegative("avg_incentive", e.target.value)}
                          className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                          placeholder="10000"
                        />
                        <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                          <button
                            type="button"
                            aria-label="Increase average incentive"
                            onClick={() => stepNonNegative("avg_incentive", 1)}
                            className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                          >
                            <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                          </button>
                          <button
                            type="button"
                            aria-label="Decrease average incentive"
                            onClick={() => stepNonNegative("avg_incentive", -1)}
                            className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                          >
                            <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                    </Field>
                  </ConditionalField>

                  {earning.totalLo || earning.totalHi ? (
                    <div className="rounded-xl border border-primary/20 bg-primary-light/40 p-4 text-sm">
                      <p className="font-semibold text-primary">
                        Salary breakup shown to candidates
                      </p>
                      <div className="mt-2 space-y-1 text-foreground/80">
                        {form.pay_type !== "incentive_only" && (
                          <div className="flex justify-between">
                            <span>Fixed / month</span>
                            <span>
                              ₹{earning.fixedLo.toLocaleString("en-IN")} -{" "}
                              {earning.fixedHi.toLocaleString("en-IN")}
                            </span>
                          </div>
                        )}
                        {form.pay_type !== "fixed" && earning.inc > 0 && (
                          <div className="flex justify-between">
                            <span>Average incentive / month</span>
                            <span>₹{earning.inc.toLocaleString("en-IN")}</span>
                          </div>
                        )}
                        <div className="mt-1 flex justify-between border-t border-primary/20 pt-1 font-semibold text-primary">
                          <span>Earning potential / month</span>
                          <span>
                            ₹{earning.totalLo.toLocaleString("en-IN")} -{" "}
                            {earning.totalHi.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Approx. yearly CTC: ₹{(earning.totalHi * 12).toLocaleString("en-IN")}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
                    {steps[2]}
                  </p>
                  <div>
                    <p className="mb-1.5 text-sm font-medium">
                      Total experience <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {EXPERIENCE_BUCKETS.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() =>
                            markDirty("experience_bucket", b.id as Form["experience_bucket"])
                          }
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.experience_bucket === b.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                    {form.category &&
                      form.experience_bucket === "any" &&
                      (() => {
                        const bm = getRoleBenchmarks(form.title, form.category, form.city);
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              markDirty("experience_bucket", bm.experienceBucket);
                              if (bm.experienceBucket === "experienced") {
                                set("min_experience_years", String(bm.minExp));
                                set("max_experience_years", String(bm.maxExp));
                              }
                            }}
                            className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            Apply typical for this role:{" "}
                            {bm.experienceBucket === "fresher"
                              ? "Fresher"
                              : `${bm.minExp}–${bm.maxExp} yrs`}
                          </button>
                        );
                      })()}
                  </div>

                  <ConditionalField visible={form.experience_bucket === "experienced"}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Minimum experience (yrs)">
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            value={form.min_experience_years}
                            onChange={(e) => setNonNegative("min_experience_years", e.target.value)}
                            className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                            placeholder="0"
                          />
                          <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                            <button
                              type="button"
                              aria-label="Increase minimum experience"
                              onClick={() => stepNonNegative("min_experience_years", 1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                            <button
                              type="button"
                              aria-label="Decrease minimum experience"
                              onClick={() => stepNonNegative("min_experience_years", -1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </Field>
                      <Field label="Maximum experience (yrs)">
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            value={form.max_experience_years}
                            onChange={(e) => setNonNegative("max_experience_years", e.target.value)}
                            className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                            placeholder="10"
                          />
                          <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                            <button
                              type="button"
                              aria-label="Increase maximum experience"
                              onClick={() => stepNonNegative("max_experience_years", 1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                            <button
                              type="button"
                              aria-label="Decrease maximum experience"
                              onClick={() => stepNonNegative("max_experience_years", -1)}
                              className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                            >
                              <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </Field>
                    </div>
                  </ConditionalField>

                  <Field
                    label="Required skills"
                    required
                    hint="Each skill becomes one bullet in the auto-generated JD."
                  >
                    <ChipInput
                      values={form.skills}
                      onChange={(v) => markDirty("skills", v)}
                      suggestions={SUGGESTED_SKILLS}
                    />
                    {(() => {
                      const { core, recommended } = getRecommendedSkills(
                        form.title,
                        form.category,
                        form.skills,
                      );
                      const marketExtra = marketSkills.filter(
                        (s) =>
                          !form.skills.includes(s) && !core.includes(s) && !recommended.includes(s),
                      );
                      if (!core.length && !recommended.length && !marketExtra.length) return null;
                      return (
                        <div className="mt-3 space-y-2">
                          {core.length > 0 && (
                            <div className="rounded-xl border border-primary/20 bg-primary-light/40 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-primary">
                                  Core for this role — tap to add
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    markDirty("skills", [
                                      ...form.skills,
                                      ...core.filter((s) => !form.skills.includes(s)),
                                    ])
                                  }
                                  className="shrink-0 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                                >
                                  + Add all core
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {core.map((s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => markDirty("skills", [...form.skills, s])}
                                    className="rounded-full border border-primary/30 bg-white px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground"
                                  >
                                    + {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {(recommended.length > 0 || marketExtra.length > 0) && (
                            <div className="rounded-xl border border-border bg-surface p-3">
                              <p className="mb-2 text-xs font-semibold text-foreground/70">
                                Good to have
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {[...recommended, ...marketExtra].map((s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => markDirty("skills", [...form.skills, s])}
                                    className="rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-foreground/80 hover:border-primary hover:text-primary"
                                  >
                                    + {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </Field>

                  <Accordion type="single" collapsible>
                    <AccordionItem value="advanced">
                      <AccordionTrigger>More filters (optional)</AccordionTrigger>
                      <AccordionContent className="space-y-5">
                        <OptionalSection
                          title="Hiring preferences"
                          summary="Optional"
                          badge={hiringPrefFilled}
                          hasValues={hiringPrefFilled > 0}
                        >
                          <Field label="English fluency">
                            <div className="flex flex-wrap gap-2">
                              {ENGLISH_LEVELS.map((l) => (
                                <button
                                  key={l.id}
                                  type="button"
                                  onClick={() =>
                                    markDirty(
                                      "english_level",
                                      form.english_level === l.id ? "" : l.id,
                                    )
                                  }
                                  className={`rounded-full border px-3 py-1.5 text-sm ${form.english_level === l.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                                >
                                  {l.label}
                                </button>
                              ))}
                            </div>
                          </Field>
                          <Field label="Gender preference">
                            <div className="flex flex-wrap gap-2">
                              {GENDERS.map((g) => (
                                <button
                                  key={g.id}
                                  type="button"
                                  onClick={() => markDirty("gender_pref", g.id)}
                                  className={`rounded-full border px-4 py-1.5 text-sm ${form.gender_pref === g.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                                >
                                  {g.label}
                                </button>
                              ))}
                            </div>
                          </Field>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Age min">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  value={form.age_min}
                                  onChange={(e) => setNonNegative("age_min", e.target.value)}
                                  className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                                />
                                <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                                  <button
                                    type="button"
                                    aria-label="Increase minimum age"
                                    onClick={() => stepNonNegative("age_min", 1)}
                                    className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                                  >
                                    <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Decrease minimum age"
                                    onClick={() => stepNonNegative("age_min", -1)}
                                    className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                                  >
                                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                                  </button>
                                </div>
                              </div>
                            </Field>
                            <Field label="Age max">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  value={form.age_max}
                                  onChange={(e) => setNonNegative("age_max", e.target.value)}
                                  className="form-input max-sm:appearance-none pr-9 sm:pr-3.5 [&::-webkit-inner-spin-button]:max-sm:appearance-none [&::-webkit-outer-spin-button]:max-sm:appearance-none"
                                />
                                <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-0.5 py-1 sm:hidden">
                                  <button
                                    type="button"
                                    aria-label="Increase maximum age"
                                    onClick={() => stepNonNegative("age_max", 1)}
                                    className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                                  >
                                    <ChevronUp className="h-3.5 w-3.5" strokeWidth={3} />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Decrease maximum age"
                                    onClick={() => stepNonNegative("age_max", -1)}
                                    className="grid h-4 w-6 place-items-center rounded-sm text-gray-700 active:bg-surface"
                                  >
                                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
                                  </button>
                                </div>
                              </div>
                            </Field>
                          </div>
                          <Field label="Preferred languages">
                            <ChipInput
                              values={form.preferred_languages}
                              onChange={(v) => markDirty("preferred_languages", v)}
                              suggestions={SUGGESTED_LANGUAGES}
                            />
                          </Field>
                          <Field label="Preferred industries">
                            <ChipInput
                              values={form.preferred_industries}
                              onChange={(v) => markDirty("preferred_industries", v)}
                              suggestions={INDUSTRIES}
                            />
                          </Field>
                        </OptionalSection>

                        <OptionalSection
                          title="Requirements & perks"
                          summary="Optional"
                          badge={reqPerksFilled}
                          hasValues={reqPerksFilled > 0}
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Degree">
                              <StateDropdown
                                value={form.degree}
                                options={EDUCATION_LEVELS}
                                placeholder="Any"
                                onChange={(v) => markDirty("degree", v)}
                              />
                            </Field>
                            <Field label="Specialisation">
                              <input
                                value={form.specialisation}
                                onChange={(e) => markDirty("specialisation", e.target.value)}
                                className="form-input"
                                placeholder="e.g. B.Sc IT"
                              />
                            </Field>
                          </div>
                          <Field label="Certifications">
                            <ChipInput
                              values={form.certifications}
                              onChange={(v) => markDirty("certifications", v)}
                            />
                          </Field>
                          <Field label="Required assets">
                            <div className="flex flex-wrap gap-2">
                              {ASSETS.map((a) => {
                                const on = form.required_assets.includes(a.label);
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() =>
                                      markDirty(
                                        "required_assets",
                                        on
                                          ? form.required_assets.filter((x) => x !== a.label)
                                          : [...form.required_assets, a.label],
                                      )
                                    }
                                    className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                                  >
                                    {on && <Check className="mr-1 inline h-3 w-3" />} {a.label}
                                  </button>
                                );
                              })}
                            </div>
                          </Field>
                          <Field label="Perks & benefits">
                            <ChipInput
                              values={form.perks}
                              onChange={(v) => markDirty("perks", v)}
                              suggestions={PERKS}
                            />
                          </Field>
                        </OptionalSection>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Shift">
                            <StateDropdown
                              value={SHIFTS.find((s) => s.id === form.shift)?.label || ""}
                              options={SHIFTS.map((s) => s.label)}
                              placeholder="Any"
                              onChange={(label) =>
                                markDirty("shift", SHIFTS.find((s) => s.label === label)?.id || "")
                              }
                            />
                          </Field>
                          <Field label="Working days / week">
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={form.working_days}
                              onChange={(e) => markDirty("working_days", e.target.value)}
                              className="form-input"
                              placeholder="6"
                            />
                          </Field>
                        </div>

                        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <p className="text-sm font-medium">
                            Is there any joining fee or deposit required from the candidate?
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            {[
                              { id: "yes", label: "Yes", val: true },
                              { id: "no", label: "No", val: false },
                            ].map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                onClick={() => markDirty("joining_fee_required", o.val)}
                                className={`rounded-full border px-4 py-1.5 text-sm ${
                                  form.joining_fee_required === o.val
                                    ? "border-primary bg-primary-light text-primary"
                                    : "border-border bg-card text-foreground/70"
                                }`}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="mb-1.5 text-sm font-medium">Interview type</p>
                          <div className="flex flex-wrap gap-2">
                            {INTERVIEW_TYPES.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() =>
                                  markDirty("interview_type", t.id as Form["interview_type"])
                                }
                                className={`rounded-full border px-4 py-1.5 text-sm ${form.interview_type === t.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                              >
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {form.interview_type === "in_person" && (
                          <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={form.interview_same_as_company}
                                onChange={(e) =>
                                  markDirty("interview_same_as_company", e.target.checked)
                                }
                              />
                              Interview address is same as company address
                            </label>
                            {form.interview_same_as_company && (
                              <p className="text-xs text-muted-foreground">
                                Interviews at your company address
                                {form.city ? ` — ${form.city}` : ""}.
                              </p>
                            )}
                            <ConditionalField visible={!form.interview_same_as_company}>
                              <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Interview city">
                                    <StateDropdown
                                      value={form.interview_city}
                                      options={INDIAN_CITIES}
                                      placeholder="Select…"
                                      onChange={(v) => markDirty("interview_city", v)}
                                      maxMenuHeight={160}
                                    />
                                  </Field>
                                  <Field label="Locality">
                                    <input
                                      value={form.interview_locality}
                                      onChange={(e) =>
                                        markDirty("interview_locality", e.target.value)
                                      }
                                      className="form-input"
                                      placeholder="Sector 132"
                                    />
                                  </Field>
                                </div>
                                <Field label="Full interview address">
                                  <textarea
                                    rows={2}
                                    value={form.interview_address}
                                    onChange={(e) => markDirty("interview_address", e.target.value)}
                                    className="form-input resize-none"
                                  />
                                </Field>
                              </div>
                            </ConditionalField>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
                    {steps[3]}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: "standard", label: "Standard" },
                        { id: "quick_read", label: "Quick Read" },
                        { id: "detailed", label: "Detailed" },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setJdStyle(s.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${jdStyle === s.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold">Job description</h3>
                      <p className="text-xs text-muted-foreground">
                        Written from your title, pay, and skills.
                      </p>
                      {jdDirty && (
                        <p className="mt-1 text-xs text-primary">
                          You're editing the template. Regenerate to restore the standard JD.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={regenerate}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:border-primary hover:text-primary"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                      </button>
                      <button
                        type="button"
                        disabled={polishing || !form.description}
                        onClick={async () => {
                          setPolishing(true);
                          try {
                            const r = await polishJobDescription({
                              data: {
                                markdown: form.description,
                                title: form.title,
                                minSalary: form.min_salary ? Number(form.min_salary) : undefined,
                                maxSalary: form.max_salary ? Number(form.max_salary) : undefined,
                                minExp: form.min_experience_years
                                  ? Number(form.min_experience_years)
                                  : undefined,
                                maxExp: form.max_experience_years
                                  ? Number(form.max_experience_years)
                                  : undefined,
                              },
                            });
                            if (r.polished) {
                              setJdDirty(true);
                              set("description", r.markdown);
                              toast.success("Tone polished.");
                            } else {
                              toast.info(
                                "Kept the original wording — AI polish wasn't available right now.",
                              );
                            }
                          } catch {
                            toast.info(
                              "Kept the original wording — AI polish wasn't available right now.",
                            );
                          } finally {
                            setPolishing(false);
                          }
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:border-primary hover:text-primary disabled:opacity-50"
                      >
                        {polishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✨"} AI
                        Polish Tone
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const html = form.description_html || buildJd(jdInput).html;
                          const salary =
                            form.min_salary || form.max_salary
                              ? `₹${form.min_salary || "?"}${form.max_salary ? `–${form.max_salary}` : ""}/mo`
                              : undefined;
                          downloadJdPdf({
                            title: form.title || "Job Description",
                            company: companyName,
                            city: form.city || undefined,
                            jobType: form.job_type?.replace("_", " "),
                            workMode: form.work_mode,
                            salary,
                            html,
                          });
                        }}
                        disabled={!form.title.trim()}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" /> Download PDF
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Editable text
                      </p>
                      <textarea
                        rows={18}
                        value={form.description}
                        onChange={(e) => {
                          setJdDirty(true);
                          set("description", e.target.value);
                        }}
                        className="form-input resize-none font-mono text-xs"
                      />
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Preview</p>
                      <div
                        className="prose prose-sm max-w-none rounded-xl border border-border bg-surface p-4 text-sm"
                        dangerouslySetInnerHTML={{ __html: form.description_html || "" }}
                      />
                    </div>
                  </div>

                  {qualityGaps.length > 0 ? (
                    <div className="rounded-xl border border-border bg-surface p-4">
                      <p className="text-sm font-semibold">
                        Improve this post ({qualityScore}/100)
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {qualityGaps.map((g) => (
                          <li key={g.key}>
                            <button
                              type="button"
                              onClick={() => setStep(g.step)}
                              className="text-left text-xs text-muted-foreground hover:text-primary hover:underline"
                            >
                              +{g.points} pts · {g.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-light px-4 py-3 text-sm font-semibold text-success">
                      <Check className="h-4 w-4" /> Excellent post! Every quality check passes.
                    </div>
                  )}

                  {canPickTier && (
                    <TierPicker tier={tier} onChange={setTier} entitlements={entitlements} />
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={step === 0}
                  onClick={() => setStep(step - 1)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {editJobId ? (
                    <>
                      {step < 3 && (
                        <button
                          type="button"
                          onClick={next}
                          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface"
                        >
                          Next <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => saveEdit(false)}
                        disabled={saving || !form.title.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface disabled:opacity-50"
                      >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
                      </button>
                      {jobStatus === "draft" && step === 3 && (
                        <button
                          type="button"
                          onClick={() =>
                            qualityScore < 40 ? setLowScoreConfirmOpen(true) : saveEdit(true)
                          }
                          disabled={saving}
                          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                        >
                          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publish job
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => publish(true)}
                        disabled={saving || !form.title.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface disabled:opacity-50"
                      >
                        Save as draft
                      </button>
                      {step < 3 ? (
                        <button
                          onClick={next}
                          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
                        >
                          Next <ArrowRight className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            qualityScore < 40 ? setLowScoreConfirmOpen(true) : publish(false)
                          }
                          disabled={saving}
                          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
                        >
                          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publish job
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <AlertDialog open={lowScoreConfirmOpen} onOpenChange={setLowScoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish a low-scoring post?</AlertDialogTitle>
            <AlertDialogDescription>
              This job is only {qualityScore}/100 on our quality check. Posts with complete pay and
              skills get up to 3× more applications. You can still publish now and improve it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLowScoreConfirmOpen(false);
                if (editJobId) {
                  saveEdit(true);
                } else {
                  publish(false);
                }
              }}
            >
              Publish anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EmployerShell>
  );
}

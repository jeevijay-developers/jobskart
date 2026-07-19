import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Loader2, RefreshCw } from "lucide-react";
import { downloadJdPdf } from "@/lib/jd-pdf";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field, ChipInput } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, setActiveCompanyId } from "@/lib/employer";
import {
  INDIAN_CITIES, JOB_TYPE_OPTIONS, WORK_MODES, EDUCATION_LEVELS, SUGGESTED_SKILLS,
  JOB_CATEGORIES, INDUSTRIES, PERKS, PAY_TYPES, GENDERS, EXPERIENCE_BUCKETS,
  ENGLISH_LEVELS, INTERVIEW_TYPES, SHIFTS, SUGGESTED_LANGUAGES, ASSETS,
} from "@/lib/options";
import { buildJd, type JdInput } from "@/lib/jd-template";
import { suggestedSkillsFor } from "@/lib/jd-library";

export const Route = createFileRoute("/_authenticated/employer/jobs/new")({
  head: () => ({ meta: [{ title: "Post a Job · JobsKart" }] }),
  component: NewJob,
});

type Form = {
  title: string; category: string; industry: string;
  job_type: string; work_mode: string; openings: number; gender_pref: string;

  city: string; locality: string; pincode: string;
  pay_type: "fixed" | "fixed_incentive" | "incentive_only";
  min_salary: string; max_salary: string; avg_incentive: string; salary_period: string;
  interview_type: "in_person" | "telephonic" | "";
  interview_same_as_company: boolean;
  interview_city: string; interview_locality: string; interview_address: string;

  experience_bucket: "any" | "fresher" | "experienced";
  min_experience_years: string; max_experience_years: string;
  english_level: string; skills: string[];
  age_min: string; age_max: string;
  preferred_languages: string[]; required_assets: string[];
  degree: string; specialisation: string;
  certifications: string[]; preferred_industries: string[];
  perks: string[]; joining_fee_required: boolean;
  shift: string; working_days: string;

  description: string; description_html: string;
  hiring_for_company: string;
};

const initialForm: Form = {
  title: "", category: "", industry: "",
  job_type: "full_time", work_mode: "onsite", openings: 1, gender_pref: "any",
  city: "", locality: "", pincode: "",
  pay_type: "fixed", min_salary: "", max_salary: "", avg_incentive: "", salary_period: "monthly",
  interview_type: "in_person", interview_same_as_company: true,
  interview_city: "", interview_locality: "", interview_address: "",
  experience_bucket: "any", min_experience_years: "0", max_experience_years: "",
  english_level: "", skills: [],
  age_min: "", age_max: "",
  preferred_languages: [], required_assets: [],
  degree: "", specialisation: "",
  certifications: [], preferred_industries: [],
  perks: [], joining_fee_required: false,
  shift: "", working_days: "",
  description: "", description_html: "",
  hiring_for_company: "",
};

function NewJob() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isConsultant, setIsConsultant] = useState(false);
  const [cityLaunched, setCityLaunched] = useState(true);
  const [form, setForm] = useState<Form>(initialForm);

  useEffect(() => {
    (async () => {
      try {
        setCompanyLoading(true);
        setSetupError(null);
        const { data: user, error } = await supabase.auth.getUser();
        if (error || !user.user) { setSetupError("Your session expired. Please sign in again."); return; }
        setUserId(user.user.id);
        const memberships = await fetchMyCompanies(user.user.id);
        const storedId = getActiveCompanyId();
        const chosen = memberships.find((m) => m.company_id === storedId) ?? memberships[0] ?? null;
        if (!chosen) { setSetupError("Finish your company setup before posting a job."); return; }
        setActiveCompanyId(chosen.company_id);
        setCompanyId(chosen.company_id);
        setCompanyName(chosen.companies?.name || "our company");
        if (chosen.companies?.industry) {
          setForm((f) => ({ ...f, industry: f.industry || chosen.companies!.industry! }));
        }
      } catch (e) {
        setSetupError(e instanceof Error ? e.message : "Could not load your company setup.");
      } finally { setCompanyLoading(false); }
    })();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const jdInput: JdInput = useMemo(() => ({
    title: form.title, companyName, industry: form.industry, category: form.category,
    workMode: form.work_mode, jobType: form.job_type,
    payType: form.pay_type,
    minSalary: form.min_salary ? Number(form.min_salary) : undefined,
    maxSalary: form.max_salary ? Number(form.max_salary) : undefined,
    avgIncentive: form.avg_incentive ? Number(form.avg_incentive) : undefined,
    experienceBucket: form.experience_bucket,
    minExp: form.min_experience_years ? Number(form.min_experience_years) : undefined,
    maxExp: form.max_experience_years ? Number(form.max_experience_years) : undefined,
    degree: form.degree, specialisation: form.specialisation, skills: form.skills,
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
  }), [form, companyName]);

  // Regenerate JD when arriving at step 3 if empty
  useEffect(() => {
    if (step === 3 && !form.description_html) {
      const jd = buildJd(jdInput);
      setForm((f) => ({ ...f, description: jd.markdown, description_html: jd.html }));
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const regenerate = () => {
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
      if (form.pincode && form.pincode.length !== 6) return "Pincode must be 6 digits.";
      if (form.pay_type !== "incentive_only" && !form.min_salary) return "Enter minimum monthly salary.";
      if (form.min_salary && form.max_salary && Number(form.max_salary) < Number(form.min_salary))
        return "Max salary must be higher than min salary.";
      if (form.pay_type !== "fixed" && !form.avg_incentive) return "Enter average monthly incentive.";
      if (!form.interview_type) return "Select interview type.";
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
    if (!companyId) { toast.error("Finish company setup first."); nav({ to: "/onboarding/employer" }); return; }
    if (!form.title.trim()) return toast.error("Add a job title first.");
    if (!asDraft) {
      for (let i = 0; i <= 2; i += 1) {
        const err = validateStep(i);
        if (err) { setStep(i); toast.error(err); return; }
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

      // Ensure JD is rendered
      let descMd = form.description;
      let descHtml = form.description_html;
      if (!descHtml) {
        const jd = buildJd(jdInput);
        descMd = jd.markdown; descHtml = jd.html;
      }

      const validJobTypes = new Set(JOB_TYPE_OPTIONS.map((o) => o.id));
      const validModes = new Set(WORK_MODES.map((o) => o.id));
      const jobType = validJobTypes.has(form.job_type) ? form.job_type : "full_time";
      const workMode = validModes.has(form.work_mode) ? form.work_mode : "onsite";

      const p: Record<string, unknown> = {
        company_id: companyId,
        posted_by: uid,
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
        pay_type: form.pay_type,
        experience_bucket: form.experience_bucket,
        joining_fee_required: form.joining_fee_required,
        preferred_languages: form.preferred_languages,
        required_assets: form.required_assets,
        certifications: form.certifications,
        preferred_industries: form.preferred_industries,
        status: asDraft ? "draft" : "active",
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
      if (form.pay_type !== "fixed" && form.avg_incentive) p.avg_incentive_monthly = Number(form.avg_incentive);
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

      const { data, error } = await supabase.from("jobs").insert(p as never).select("id").single();
      if (error) {
        console.error("[jobs.publish]", error);
        const code = (error as { code?: string }).code;
        if (code === "42501") toast.error("You don't have permission to post for this company.");
        else if (code === "23502") toast.error("A required field is missing.");
        else toast.error(error.message || "Could not publish the job.");
        return;
      }
      const jobId = (data as { id: string }).id;
      toast.success(asDraft ? "Saved as draft." : "Job published! Candidates can apply now.");
      if (asDraft) nav({ to: "/employer/jobs" });
      else nav({ to: "/employer/jobs/$jobId/applicants", params: { jobId } });
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Could not publish.");
    } finally { setSaving(false); }
  };

  const steps = ["Basics", "Location & Pay", "Requirements", "Description"];

  const earning = useMemo(() => {
    const min = Number(form.min_salary || 0);
    const max = Number(form.max_salary || form.min_salary || 0);
    const inc = Number(form.avg_incentive || 0);
    const fixedLo = form.pay_type === "incentive_only" ? 0 : min;
    const fixedHi = form.pay_type === "incentive_only" ? 0 : max;
    const totalLo = fixedLo + (form.pay_type === "fixed_incentive" ? 0 : form.pay_type === "incentive_only" ? 0 : 0);
    const totalHi = fixedHi + (form.pay_type !== "fixed" ? inc : 0);
    return { fixedLo, fixedHi, inc, totalLo, totalHi };
  }, [form.min_salary, form.max_salary, form.avg_incentive, form.pay_type]);

  return (
    <EmployerShell title="Post a job" subtitle="4 steps. Takes about 3 minutes.">
      <div className="mx-auto max-w-3xl">
        {companyLoading ? (
          <div className="h-64 animate-pulse rounded-2xl bg-card" />
        ) : setupError ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <h2 className="text-lg font-bold">Company setup required</h2>
            <p className="mt-2 text-sm text-muted-foreground">{setupError}</p>
            <button onClick={() => nav({ to: "/onboarding/employer" })} className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">Complete company setup</button>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2">
              {steps.map((s, i) => (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-border"}`} />
                  <p className={`mt-1 text-xs font-medium ${i === step ? "text-primary" : "text-muted-foreground"}`}>{i + 1}. {s}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              {step === 0 && (
                <div className="space-y-4">
                  <Field label="Job title" required hint="e.g. Delivery Executive, Security Guard">
                    <input value={form.title} onChange={(e) => set("title", e.target.value)} className="form-input" placeholder="Enter a clear, descriptive title" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category" required>
                      <select value={form.category} onChange={(e) => set("category", e.target.value)} className="form-input">
                        <option value="">Select…</option>
                        {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Industry" required>
                      <select value={form.industry} onChange={(e) => set("industry", e.target.value)} className="form-input">
                        <option value="">Select…</option>
                        {INDUSTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Job type" required>
                      <select value={form.job_type} onChange={(e) => set("job_type", e.target.value)} className="form-input">
                        {JOB_TYPE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Work mode" required>
                      <select value={form.work_mode} onChange={(e) => set("work_mode", e.target.value)} className="form-input">
                        {WORK_MODES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Openings">
                      <input type="number" min={1} value={form.openings} onChange={(e) => set("openings", Number(e.target.value))} className="form-input" />
                    </Field>
                  </div>
                  <Field label="Gender preference">
                    <div className="flex flex-wrap gap-2">
                      {GENDERS.map((g) => (
                        <button key={g.id} type="button" onClick={() => set("gender_pref", g.id)}
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.gender_pref === g.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="City" required>
                      <select value={form.city} onChange={(e) => set("city", e.target.value)} className="form-input">
                        <option value="">Select…</option>
                        {INDIAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Locality">
                      <input value={form.locality} onChange={(e) => set("locality", e.target.value)} className="form-input" placeholder="Andheri East" />
                    </Field>
                    <Field label="Pincode">
                      <input maxLength={6} value={form.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))} className="form-input" />
                    </Field>
                  </div>

                  <div>
                    <p className="mb-1.5 text-sm font-medium">Compensation · Pay type <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {PAY_TYPES.map((p) => (
                        <button key={p.id} type="button" onClick={() => set("pay_type", p.id as Form["pay_type"])}
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.pay_type === p.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.pay_type !== "incentive_only" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Fixed min / month (₹)" required>
                        <input type="number" value={form.min_salary} onChange={(e) => set("min_salary", e.target.value)} className="form-input" placeholder="15000" />
                      </Field>
                      <Field label="Fixed max / month (₹)">
                        <input type="number" value={form.max_salary} onChange={(e) => set("max_salary", e.target.value)} className="form-input" placeholder="25000" />
                      </Field>
                    </div>
                  )}
                  {form.pay_type !== "fixed" && (
                    <Field label="Average incentive / month (₹)" required>
                      <input type="number" value={form.avg_incentive} onChange={(e) => set("avg_incentive", e.target.value)} className="form-input" placeholder="10000" />
                    </Field>
                  )}

                  {(earning.totalLo || earning.totalHi) ? (
                    <div className="rounded-xl border border-primary/20 bg-primary-light/40 p-4 text-sm">
                      <p className="font-semibold text-primary">Salary breakup shown to candidates</p>
                      <div className="mt-2 space-y-1 text-foreground/80">
                        {form.pay_type !== "incentive_only" && (
                          <div className="flex justify-between"><span>Fixed / month</span><span>₹{earning.fixedLo.toLocaleString("en-IN")} - {earning.fixedHi.toLocaleString("en-IN")}</span></div>
                        )}
                        {form.pay_type !== "fixed" && earning.inc > 0 && (
                          <div className="flex justify-between"><span>Average incentive / month</span><span>₹{earning.inc.toLocaleString("en-IN")}</span></div>
                        )}
                        <div className="mt-1 flex justify-between border-t border-primary/20 pt-1 font-semibold text-primary">
                          <span>Earning potential / month</span>
                          <span>₹{earning.totalLo.toLocaleString("en-IN")} - {earning.totalHi.toLocaleString("en-IN")}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">Approx. yearly CTC: ₹{(earning.totalHi * 12).toLocaleString("en-IN")}</div>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-1.5 text-sm font-medium">Interview type <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {INTERVIEW_TYPES.map((t) => (
                        <button key={t.id} type="button" onClick={() => set("interview_type", t.id as Form["interview_type"])}
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.interview_type === t.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.interview_type === "in_person" && (
                    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.interview_same_as_company} onChange={(e) => set("interview_same_as_company", e.target.checked)} />
                        Interview address is same as company address
                      </label>
                      {!form.interview_same_as_company && (
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Interview city">
                              <select value={form.interview_city} onChange={(e) => set("interview_city", e.target.value)} className="form-input">
                                <option value="">Select…</option>
                                {INDIAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </Field>
                            <Field label="Locality">
                              <input value={form.interview_locality} onChange={(e) => set("interview_locality", e.target.value)} className="form-input" placeholder="Sector 132" />
                            </Field>
                          </div>
                          <Field label="Full interview address">
                            <textarea rows={2} value={form.interview_address} onChange={(e) => set("interview_address", e.target.value)} className="form-input resize-none" />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <p className="mb-1.5 text-sm font-medium">Total experience <span className="text-destructive">*</span></p>
                    <div className="flex flex-wrap gap-2">
                      {EXPERIENCE_BUCKETS.map((b) => (
                        <button key={b.id} type="button" onClick={() => set("experience_bucket", b.id as Form["experience_bucket"])}
                          className={`rounded-full border px-4 py-1.5 text-sm ${form.experience_bucket === b.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Minimum experience (yrs)">
                      <input type="number" value={form.min_experience_years} onChange={(e) => set("min_experience_years", e.target.value)} className="form-input" placeholder="0" />
                    </Field>
                    <Field label="Maximum experience (yrs)">
                      <input type="number" value={form.max_experience_years} onChange={(e) => set("max_experience_years", e.target.value)} className="form-input" placeholder="10" />
                    </Field>
                  </div>

                  <Field label="English fluency (optional)">
                    <div className="flex flex-wrap gap-2">
                      {ENGLISH_LEVELS.map((l) => (
                        <button key={l.id} type="button" onClick={() => set("english_level", form.english_level === l.id ? "" : l.id)}
                          className={`rounded-full border px-3 py-1.5 text-sm ${form.english_level === l.id ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Required skills" required hint="Each skill becomes one bullet in the auto-generated JD.">
                    <ChipInput values={form.skills} onChange={(v) => set("skills", v)} suggestions={SUGGESTED_SKILLS} />
                    {(() => {
                      const suggested = suggestedSkillsFor(form.title, form.industry).filter((s) => !form.skills.includes(s));
                      if (!suggested.length) return null;
                      return (
                        <div className="mt-3 rounded-xl border border-primary/20 bg-primary-light/40 p-3">
                          <p className="mb-2 text-xs font-semibold text-primary">Suggested for this role — tap to add</p>
                          <div className="flex flex-wrap gap-1.5">
                            {suggested.map((s) => (
                              <button key={s} type="button" onClick={() => set("skills", [...form.skills, s])}
                                className="rounded-full border border-primary/30 bg-white px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground">
                                + {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Degree">
                      <select value={form.degree} onChange={(e) => set("degree", e.target.value)} className="form-input">
                        <option value="">Any</option>
                        {EDUCATION_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
                      </select>
                    </Field>
                    <Field label="Specialisation">
                      <input value={form.specialisation} onChange={(e) => set("specialisation", e.target.value)} className="form-input" placeholder="e.g. B.Sc IT" />
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Age min">
                      <input type="number" value={form.age_min} onChange={(e) => set("age_min", e.target.value)} className="form-input" />
                    </Field>
                    <Field label="Age max">
                      <input type="number" value={form.age_max} onChange={(e) => set("age_max", e.target.value)} className="form-input" />
                    </Field>
                  </div>

                  <Field label="Preferred languages">
                    <ChipInput values={form.preferred_languages} onChange={(v) => set("preferred_languages", v)} suggestions={SUGGESTED_LANGUAGES} />
                  </Field>

                  <Field label="Required assets">
                    <div className="flex flex-wrap gap-2">
                      {ASSETS.map((a) => {
                        const on = form.required_assets.includes(a.label);
                        return (
                          <button key={a.id} type="button" onClick={() => set("required_assets", on ? form.required_assets.filter((x) => x !== a.label) : [...form.required_assets, a.label])}
                            className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary-light text-primary" : "border-border bg-surface text-foreground/70"}`}>
                            {on && <Check className="mr-1 inline h-3 w-3" />} {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field label="Certifications">
                    <ChipInput values={form.certifications} onChange={(v) => set("certifications", v)} />
                  </Field>
                  <Field label="Preferred industries">
                    <ChipInput values={form.preferred_industries} onChange={(v) => set("preferred_industries", v)} suggestions={INDUSTRIES} />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Shift">
                      <select value={form.shift} onChange={(e) => set("shift", e.target.value)} className="form-input">
                        <option value="">Any</option>
                        {SHIFTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Working days / week">
                      <input type="number" min={1} max={7} value={form.working_days} onChange={(e) => set("working_days", e.target.value)} className="form-input" placeholder="6" />
                    </Field>
                  </div>

                  <Field label="Perks & benefits">
                    <ChipInput values={form.perks} onChange={(v) => set("perks", v)} suggestions={PERKS} />
                  </Field>

                  <label className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
                    <input type="checkbox" checked={form.joining_fee_required} onChange={(e) => set("joining_fee_required", e.target.checked)} />
                    Joining fee or deposit required from candidate
                  </label>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold">Job description</h3>
                      <p className="text-xs text-muted-foreground">Auto-generated from your inputs. You can edit before publishing.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={regenerate} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:border-primary hover:text-primary">
                        <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const html = form.description_html || buildJd(jdInput).html;
                          const salary = form.min_salary || form.max_salary
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
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Editable text</p>
                      <textarea rows={18} value={form.description} onChange={(e) => set("description", e.target.value)} className="form-input resize-none font-mono text-xs" />
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Preview</p>
                      <div className="prose prose-sm max-w-none rounded-xl border border-border bg-surface p-4 text-sm" dangerouslySetInnerHTML={{ __html: form.description_html || "<em>Generate to see preview</em>" }} />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium disabled:opacity-40">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => publish(true)} disabled={saving || !form.title.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface disabled:opacity-50">
                    Save as draft
                  </button>
                  {step < 3 ? (
                    <button onClick={next} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
                      Next <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button onClick={() => publish(false)} disabled={saving}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60">
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publish job
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </EmployerShell>
  );
}

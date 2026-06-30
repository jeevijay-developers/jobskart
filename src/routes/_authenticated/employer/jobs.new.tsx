import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { Field, ChipInput } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { INDIAN_CITIES, JOB_TYPE_OPTIONS, WORK_MODES, EDUCATION_LEVELS, SUGGESTED_SKILLS } from "@/lib/options";

export const Route = createFileRoute("/_authenticated/employer/jobs/new")({
  head: () => ({ meta: [{ title: "Post a Job · JobsKart" }] }),
  component: NewJob,
});

const CATEGORIES = ["Driving", "Delivery", "Sales", "Security", "Retail", "Telecaller", "Warehouse", "Housekeeping", "Cook", "Field Agent", "Nursing", "Teaching", "IT", "Other"];

type Form = {
  title: string; category: string; job_type: string; work_mode: string; openings: number;
  description: string;
  city: string; locality: string; pincode: string;
  min_salary: string; max_salary: string; salary_period: string; perks: string[];
  min_experience_years: string; max_experience_years: string; education: string; skills: string[];
};

function NewJob() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form>({
    title: "", category: "", job_type: "full_time", work_mode: "on_site", openings: 1,
    description: "",
    city: "", locality: "", pincode: "",
    min_salary: "", max_salary: "", salary_period: "monthly", perks: [],
    min_experience_years: "0", max_experience_years: "", education: "", skills: [],
  });

  useEffect(() => {
    (async () => {
      let cid = getActiveCompanyId();
      if (!cid) {
        const { data: user } = await supabase.auth.getUser();
        if (user.user) {
          const ms = await fetchMyCompanies(user.user.id);
          cid = ms[0]?.company_id ?? null;
        }
      }
      setCompanyId(cid);
    })();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    if (step === 0) {
      if (!form.title.trim()) return "Add a job title.";
      if (!form.category) return "Pick a category.";
    }
    if (step === 1) {
      if (form.description.trim().length < 30) return "Add a richer description (30+ chars).";
    }
    if (step === 2) {
      if (!form.city) return "Pick a city.";
      if (!form.min_salary) return "Enter min salary.";
      if (form.max_salary && Number(form.max_salary) < Number(form.min_salary))
        return "Max salary must be higher than min salary.";
      if (form.pincode && form.pincode.length !== 6) return "Pincode must be 6 digits.";
    }
    return null;
  };

  const next = () => {
    const err = validate();
    if (err) return toast.error(err);
    if (step < 3) setStep(step + 1);
  };

  const publish = async (asDraft = false) => {
    if (!companyId) return toast.error("No active company.");
    if (!form.title.trim()) return toast.error("Add a job title first.");
    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("jobs").insert({
        company_id: companyId,
        title: form.title.trim(),
        category: form.category || null,
        job_type: form.job_type as never,
        work_mode: form.work_mode as never,
        openings: form.openings,
        description: form.description,
        city: form.city || null,
        locality: form.locality || null,
        pincode: form.pincode || null,
        min_salary: form.min_salary ? Number(form.min_salary) : null,
        max_salary: form.max_salary ? Number(form.max_salary) : null,
        salary_period: form.salary_period,
        perks: form.perks,
        min_experience_years: form.min_experience_years ? Number(form.min_experience_years) : null,
        max_experience_years: form.max_experience_years ? Number(form.max_experience_years) : null,
        education: form.education || null,
        skills: form.skills,
        status: asDraft ? "draft" : "active",
        posted_by: user.user?.id,
      } as never).select().single();
      if (error) throw error;
      toast.success(asDraft ? "Saved as draft." : "Job published! Candidates can apply now.");
      if (asDraft) nav({ to: "/employer/jobs" });
      else nav({ to: "/employer/jobs/$jobId/applicants", params: { jobId: (data as { id: string }).id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not publish.");
    } finally { setSaving(false); }
  };

  const steps = ["Basics", "Description", "Location & Pay", "Requirements"];

  return (
    <EmployerShell title="Post a job" subtitle="4 steps. Takes about 3 minutes.">
      <div className="mx-auto max-w-3xl">
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
              <Field label="Category" required>
                <select value={form.category} onChange={(e) => set("category", e.target.value)} className="form-input">
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
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
            </div>
          )}
          {step === 1 && (
            <Field label="Job description" required hint={`${form.description.length} chars · roles, responsibilities, who should apply`}>
              <textarea
                rows={12}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                className="form-input resize-none"
                placeholder="Describe responsibilities, daily tasks, working hours, and what makes this role great."
              />
            </Field>
          )}
          {step === 2 && (
            <div className="space-y-4">
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
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Min salary (₹)" required>
                  <input type="number" value={form.min_salary} onChange={(e) => set("min_salary", e.target.value)} className="form-input" placeholder="15000" />
                </Field>
                <Field label="Max salary (₹)">
                  <input type="number" value={form.max_salary} onChange={(e) => set("max_salary", e.target.value)} className="form-input" placeholder="25000" />
                </Field>
                <Field label="Period">
                  <select value={form.salary_period} onChange={(e) => set("salary_period", e.target.value)} className="form-input">
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                  </select>
                </Field>
              </div>
              <Field label="Perks & benefits">
                <ChipInput values={form.perks} onChange={(v) => set("perks", v)} suggestions={["PF", "ESI", "Insurance", "Meals", "Transport", "Incentives", "Training"]} />
              </Field>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Min experience (yrs)">
                  <input type="number" value={form.min_experience_years} onChange={(e) => set("min_experience_years", e.target.value)} className="form-input" />
                </Field>
                <Field label="Max experience (yrs)">
                  <input type="number" value={form.max_experience_years} onChange={(e) => set("max_experience_years", e.target.value)} className="form-input" />
                </Field>
                <Field label="Education">
                  <select value={form.education} onChange={(e) => set("education", e.target.value)} className="form-input">
                    <option value="">Any</option>
                    {EDUCATION_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Required skills">
                <ChipInput values={form.skills} onChange={(v) => set("skills", v)} suggestions={SUGGESTED_SKILLS} />
              </Field>
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
              <button
                type="button"
                onClick={() => publish(true)}
                disabled={saving || !form.title.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50"
              >
                Save as draft
              </button>
              {step < 3 ? (
                <button onClick={next} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
                  Next <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button onClick={() => publish(false)} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publish job
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </EmployerShell>
  );
}

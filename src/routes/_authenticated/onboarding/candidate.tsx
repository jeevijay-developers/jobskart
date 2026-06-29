import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2, Upload, FileText, Compass, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Navbar } from "@/components/site/Navbar";
import { ChipInput, Field, SectionCard } from "@/components/candidate/primitives";
import { JobTitleAutocomplete } from "@/components/candidate/JobTitleAutocomplete";
import { supabase } from "@/integrations/supabase/client";
import { INDIAN_CITIES, SUGGESTED_LANGUAGES, JOB_TYPE_OPTIONS, WORK_MODES } from "@/lib/options";
import { computeProfileStrength } from "@/lib/profileStrength";
import { ResumeUpload } from "@/components/candidate/ResumeUpload";
import type { ParsedResumePayload } from "@/lib/resume.functions";
import {
  fullNameSchema,
  mobileSchema,
  headlineSchema,
  descriptionSchema,
  dobSchema,
  qualificationSchema,
  QUALIFICATIONS,
  titleCase,
  sanitizeText,
  validateResumeFile,
  RESUME_ACCEPT,
} from "@/lib/validators";
import { suggestSkills } from "@/lib/candidate.functions";

export const Route = createFileRoute("/_authenticated/onboarding/candidate")({
  head: () => ({ meta: [{ title: "Complete your profile · JobsKart" }] }),
  component: OnboardingPage,
});

type Experience = { id?: string; job_title: string; company_name: string; start_date: string; end_date: string; is_current: boolean; description: string };
type Language = { id?: string; language: string; proficiency: "basic" | "conversational" | "fluent" | "native"; can_read: boolean; can_write: boolean };

type AssetRow = { id: string; slug: string; label: string; category: string };

const STEPS = ["Basics", "Work status", "Experience", "Education", "Skills & languages", "Preferences"] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  // Basics
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  const [city, setCity] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "prefer_not" | "">("");
  const [headline, setHeadline] = useState("");

  // Work status
  const [expStatus, setExpStatus] = useState<"fresher" | "experienced" | "student">("fresher");
  const [years, setYears] = useState<number>(0);
  const [lastRole, setLastRole] = useState("");
  const [interestedRoles, setInterestedRoles] = useState<string[]>([]);

  // Experience
  const [experiences, setExperiences] = useState<Experience[]>([]);

  // Education
  const [highestQualification, setHighestQualification] = useState<string>("");

  // Skills & languages
  const [skills, setSkills] = useState<string[]>([]);
  const [aiSkills, setAiSkills] = useState<string[]>([]);
  const [languages, setLanguages] = useState<Language[]>([{ language: "Hindi", proficiency: "fluent", can_read: true, can_write: true }]);
  const [assets, setAssets] = useState<string[]>([]);
  const [assetsMaster, setAssetsMaster] = useState<AssetRow[]>([]);
  const [langMaster, setLangMaster] = useState<string[]>(SUGGESTED_LANGUAGES);

  // Preferences
  const [jobTypes, setJobTypes] = useState<string[]>(["full_time"]);
  const [workModes, setWorkModes] = useState<string[]>(["on_site"]);
  const [preferredCities, setPreferredCities] = useState<string[]>([]);
  const [expectedSalary, setExpectedSalary] = useState<number | "">("");
  const [noticeDays, setNoticeDays] = useState<number | "">(0);
  const [resume, setResume] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const suggest = useServerFn(suggestSkills);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const u = sess.session?.user.id;
      if (!u) return;
      setUid(u);
      const [{ data: p }, { data: c }, { data: ex }, { data: lg }, { data: am }, { data: lm }] = await Promise.all([
        supabase.from("profiles").select("full_name, mobile, city").eq("id", u).maybeSingle(),
        supabase.from("candidate_profiles").select("*").eq("user_id", u).maybeSingle(),
        supabase.from("candidate_experiences").select("*").eq("user_id", u).order("start_date", { ascending: false }),
        supabase.from("candidate_languages").select("*").eq("user_id", u),
        supabase.from("candidate_assets_master").select("id, slug, label, category").eq("is_active", true).order("sort_order"),
        supabase.from("languages_master").select("name").eq("is_active", true).order("sort_order"),
      ]);
      if (p) { setFullName(p.full_name || ""); setMobile(p.mobile || ""); setCity(p.city || ""); }
      if (c) {
        setHeadline(c.headline || "");
        setDob(c.date_of_birth || ""); setGender((c.gender as typeof gender) || "");
        setExpStatus(c.experience_status as typeof expStatus); setYears(c.years_experience || 0); setLastRole(c.last_role || "");
        setSkills(c.skills || []); setAssets(c.assets || []);
        setJobTypes(c.preferred_job_types?.length ? c.preferred_job_types : ["full_time"]);
        setWorkModes((c.preferred_work_mode || "on_site").split(",").map((s) => s.trim()).filter(Boolean));
        setPreferredCities(c.preferred_cities || []);
        setExpectedSalary(c.expected_salary || "");
        setNoticeDays(c.notice_period_days ?? 0);
        if (c.resume_url) setResume({ name: c.resume_name || "Resume", path: c.resume_url });
        const cExt = c as unknown as { whatsapp_number?: string | null; whatsapp_opt_in?: boolean | null; highest_qualification?: string | null; interested_roles?: string[] | null };
        setWhatsapp(cExt.whatsapp_number || p?.mobile || "");
        setWhatsappOptIn(cExt.whatsapp_opt_in ?? true);
        setHighestQualification(cExt.highest_qualification || "");
        setInterestedRoles(cExt.interested_roles || []);
      } else if (p?.mobile) {
        setWhatsapp(p.mobile);
      }
      if (ex?.length) setExperiences(ex.map((e) => ({ ...e, start_date: e.start_date || "", end_date: e.end_date || "", description: e.description || "" })));
      if (lg?.length) setLanguages(lg.map((l) => ({ ...l, proficiency: l.proficiency as Language["proficiency"] })));
      if (am?.length) setAssetsMaster(am as AssetRow[]);
      if (lm?.length) setLangMaster(lm.map((r) => r.name));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch AI suggested skills when interested roles / experience titles change
  useEffect(() => {
    const roles = [
      ...interestedRoles,
      ...experiences.map((e) => e.job_title).filter(Boolean),
    ];
    if (!roles.length) return;
    let cancelled = false;
    suggest({ data: { roles, qualification: highestQualification || null } })
      .then((s) => !cancelled && setAiSkills(s))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [interestedRoles, experiences, highestQualification, suggest]);

  // Asset visibility: derive from selected roles
  const visibleAssets = useMemo(() => {
    const roleText = [
      ...interestedRoles,
      ...experiences.map((e) => e.job_title),
      lastRole,
    ].join(" ").toLowerCase();
    const wantsField = /(driver|delivery|field|sales|electric|mechanic|plumb|technician|guard|rider|cab|courier)/.test(roleText);
    const wantsDesk = /(developer|engineer|analyst|designer|manager|marketing|content|writer|account|hr|tele|support|operator|executive)/.test(roleText);
    if (!wantsField && !wantsDesk) return assetsMaster; // show all
    return assetsMaster.filter((a) =>
      a.category === "general" ||
      (wantsField && a.category === "field") ||
      (wantsDesk && a.category === "desk"),
    );
  }, [assetsMaster, interestedRoles, experiences, lastRole]);

  const strength = useMemo(() => computeProfileStrength({
    full_name: fullName, mobile, city, headline, last_role: lastRole, skills,
    years_experience: years, preferred_job_types: jobTypes, preferred_cities: preferredCities,
    expected_salary: typeof expectedSalary === "number" ? expectedSalary : null,
    resume_url: resume?.path, experiences_count: experiences.length,
    education_count: highestQualification ? 1 : 0,
    languages_count: languages.length,
    highest_qualification: highestQualification,
    interested_roles: interestedRoles,
    whatsapp_opt_in: whatsappOptIn,
  }), [fullName, mobile, city, headline, lastRole, skills, years, jobTypes, preferredCities, expectedSalary, resume, experiences, languages, highestQualification, interestedRoles, whatsappOptIn]);

  // Skip "Experience" step for freshers — handled via stepIndex translation
  const visibleSteps = useMemo(() => {
    if (expStatus === "fresher") return STEPS.filter((s) => s !== "Experience");
    return [...STEPS];
  }, [expStatus]);
  const currentLabel = visibleSteps[step] || visibleSteps[0];

  const saveStep = async (advance: 1 | -1 | "finish") => {
    if (!uid) return;
    setSaving(true);
    try {
      await supabase.from("profiles").update({ full_name: fullName, mobile, city }).eq("id", uid);
      await supabase.from("candidate_profiles").update({
        headline: headline || null,
        date_of_birth: dob || null,
        gender: gender || null,
        experience_status: expStatus,
        years_experience: years || 0,
        last_role: lastRole || null,
        skills,
        assets,
        preferred_job_types: jobTypes,
        preferred_work_mode: workModes.join(","),
        preferred_cities: preferredCities,
        expected_salary: typeof expectedSalary === "number" ? expectedSalary : null,
        notice_period_days: typeof noticeDays === "number" ? noticeDays : null,
        resume_url: resume?.path || null,
        resume_name: resume?.name || null,
        profile_strength: strength,
        whatsapp_number: whatsapp || null,
        whatsapp_opt_in: whatsappOptIn,
        highest_qualification: highestQualification || null,
        interested_roles: interestedRoles,
        onboarding_completed: advance === "finish" ? true : undefined,
      }).eq("user_id", uid);

      if (currentLabel === "Experience") {
        await supabase.from("candidate_experiences").delete().eq("user_id", uid);
        if (experiences.length) {
          await supabase.from("candidate_experiences").insert(experiences.map((e) => ({
            user_id: uid, job_title: e.job_title, company_name: e.company_name,
            start_date: e.start_date || null, end_date: e.is_current ? null : (e.end_date || null),
            is_current: e.is_current, description: e.description || null,
          })));
        }
      }
      if (currentLabel === "Education" && highestQualification) {
        // Persist highest qualification as a single education row; detailed entries live on the profile screen.
        await supabase.from("candidate_education").delete().eq("user_id", uid).eq("level", highestQualification);
        await supabase.from("candidate_education").insert({
          user_id: uid,
          level: highestQualification,
        });
      }
      if (currentLabel === "Skills & languages") {
        await supabase.from("candidate_languages").delete().eq("user_id", uid);
        if (languages.length) {
          await supabase.from("candidate_languages").insert(languages.map((l) => ({
            user_id: uid, language: l.language, proficiency: l.proficiency, can_read: l.can_read, can_write: l.can_write,
          })));
        }
      }

      if (advance === "finish") {
        toast.success("Profile completed!");
        navigate({ to: "/candidate/dashboard" });
        return;
      }
      setStep((s) => Math.max(0, Math.min(visibleSteps.length - 1, s + (advance as number))));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Per-step validation — no skips allowed
  const validateCurrent = (): string | null => {
    if (currentLabel === "Basics") {
      const name = fullNameSchema.safeParse(fullName);
      if (!name.success) return name.error.issues[0].message;
      const mob = mobileSchema.safeParse(mobile);
      if (!mob.success) return mob.error.issues[0].message;
      if (whatsapp) {
        const w = mobileSchema.safeParse(whatsapp);
        if (!w.success) return "WhatsApp: " + w.error.issues[0].message;
      }
      if (headline) {
        const h = headlineSchema.safeParse(headline);
        if (!h.success) return h.error.issues[0].message;
      }
      if (!city) return "Please choose your city.";
      const d = dobSchema.safeParse(dob || undefined);
      if (!d.success) return d.error.issues[0].message;
    }
    if (currentLabel === "Work status") {
      if (expStatus === "experienced" && (!years || years < 0)) return "Enter your total years of experience.";
      if (expStatus === "fresher" && interestedRoles.length === 0) return "Add at least one interested job role.";
    }
    if (currentLabel === "Experience") {
      if (expStatus === "experienced" && experiences.length === 0) return "Add at least one work experience.";
      for (const e of experiences) {
        if (!e.job_title.trim()) return "Each experience needs a job title.";
        if (!e.company_name.trim()) return "Each experience needs a company name.";
        if (e.description) {
          const d = descriptionSchema.safeParse(e.description);
          if (!d.success) return d.error.issues[0].message;
        }
      }
    }
    if (currentLabel === "Education") {
      const q = qualificationSchema.safeParse(highestQualification);
      if (!q.success) return "Please select your highest qualification.";
    }
    if (currentLabel === "Skills & languages") {
      if (skills.length === 0) return "Add at least one skill.";
    }
    if (currentLabel === "Preferences") {
      if (expStatus === "student") {
        if (!jobTypes.includes("internship")) setJobTypes(["internship"]);
      } else if (jobTypes.length === 0) return "Choose at least one job type.";
      if (workModes.length === 0) return "Choose at least one work mode.";
      if (preferredCities.length < 1) return "Add at least 1 preferred city.";
      if (preferredCities.length > 4) return "You can pick up to 4 cities.";
      if (expStatus === "experienced") {
        if (!expectedSalary || expectedSalary <= 0) return "Enter your expected monthly salary.";
        if (noticeDays === "" || (typeof noticeDays === "number" && noticeDays < 0)) return "Enter your notice period.";
      }
    }
    return null;
  };

  const handleNext = () => {
    const err = validateCurrent();
    if (err) return toast.error(err);
    if (step === visibleSteps.length - 1) return saveStep("finish");
    saveStep(1);
  };

  const uploadResume = async (file: File) => {
    if (!uid) return;
    const fileErr = validateResumeFile(file);
    if (fileErr) return toast.error(fileErr);
    setUploading(true);
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${uid}/resume-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("candidate-docs").upload(path, file, { upsert: true });
    setUploading(false);
    if (error) return toast.error(error.message);
    setResume({ name: file.name, path });
    await supabase.from("candidate_documents").insert({ user_id: uid, doc_type: "resume", file_path: path, file_name: file.name, size_bytes: file.size });
    toast.success("Resume uploaded");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface"><Navbar />
        <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Side rail (desktop) */}
          <aside className="hidden lg:block">
            <div
              className="sticky top-24 overflow-hidden rounded-3xl p-6 text-white shadow-[0_20px_60px_-20px_rgba(15,27,61,0.4)]"
              style={{
                background:
                  "radial-gradient(circle at 10% 10%, hsl(var(--primary) / 0.35), transparent 55%), linear-gradient(135deg,#0f1b3d 0%,#1e3a5f 100%)",
              }}
            >
              <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white ring-1 ring-white/20">
                <Compass className="h-3 w-3" /> Onboarding
              </p>
              <h2 className="mt-3 text-xl font-bold leading-tight">Let's build your profile</h2>
              <p className="mt-1 text-xs text-white/60">A complete profile gets you hired 3× faster.</p>

              <div className="mt-5 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/70">
                  <span>Profile strength</span>
                  <span className="text-white tabular-nums">{strength}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${strength}%` }} />
                </div>
              </div>

              <ol className="mt-6 space-y-1">
                {visibleSteps.map((label, i) => {
                  const done = i < step;
                  const active = i === step;
                  return (
                    <li key={label} className="relative flex items-center gap-3 rounded-xl px-2 py-2">
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ring-2 ${
                          done
                            ? "bg-primary text-primary-foreground ring-primary"
                            : active
                            ? "bg-white text-[#0f1b3d] ring-white"
                            : "bg-white/5 text-white/50 ring-white/15"
                        }`}
                      >
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      <span
                        className={`text-sm font-semibold ${
                          active ? "text-white" : done ? "text-white/80" : "text-white/45"
                        }`}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </aside>

          {/* Main content column */}
          <div>
            {/* Mobile / tablet header */}
            <div
              className="mb-6 overflow-hidden rounded-3xl p-5 text-white shadow-[0_20px_60px_-20px_rgba(15,27,61,0.4)] sm:p-6 lg:hidden"
              style={{
                background:
                  "radial-gradient(circle at 10% 10%, hsl(var(--primary) / 0.35), transparent 55%), linear-gradient(135deg,#0f1b3d 0%,#1e3a5f 100%)",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white ring-1 ring-white/25">
                    <Compass className="h-3 w-3" /> Step {step + 1} of {visibleSteps.length}
                  </p>
                  <h1 className="mt-3 truncate text-2xl font-bold leading-tight">{currentLabel}</h1>
                  <p className="mt-1 text-xs text-white/60">Every field matters — you can edit anytime later.</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Profile</p>
                  <p className="text-2xl font-bold text-white tabular-nums">{strength}%</p>
                </div>
              </div>
              <div className="mt-5 flex gap-1.5">
                {visibleSteps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all ${
                      i < step ? "bg-primary" : i === step ? "bg-white" : "bg-white/15"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Desktop step title */}
            <div className="mb-5 hidden lg:block">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                Step {step + 1} of {visibleSteps.length}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">{currentLabel}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Every field matters — you can edit anytime later.</p>
            </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >

        {currentLabel === "Basics" && (
          <div className="space-y-5">
            <ResumeUpload
              onParsed={(d: ParsedResumePayload, file: File) => {
                // Upload to storage in the background so the Preferences step still has the file
                uploadResume(file);
                if (d.full_name && !fullName) setFullName(titleCase(sanitizeText(d.full_name)));
                if (d.mobile && !mobile) setMobile(d.mobile.replace(/\D/g, "").slice(-10));
                if (d.city && !city) setCity(d.city);
                if (d.headline) setHeadline(d.headline);
                if (typeof d.years_experience === "number") {
                  setYears(d.years_experience);
                  setExpStatus(d.years_experience > 0 ? "experienced" : "fresher");
                }
                if (d.skills?.length) setSkills(Array.from(new Set([...skills, ...d.skills])).slice(0, 25));
                if (d.experiences?.length) {
                  setExperiences(
                    (d.experiences ?? []).map((e: NonNullable<ParsedResumePayload["experiences"]>[number]) => ({
                      job_title: e.job_title || "",
                      company_name: e.company_name || "",
                      start_date: e.start_date || "",
                      end_date: e.end_date || "",
                      is_current: !!e.is_current,
                      description: e.description || "",
                    })),
                  );
                  if (d.experiences[0]?.job_title) setLastRole(d.experiences[0].job_title);
                }
              }}
            />
            {resume && (
              <p className="-mt-3 inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success">
                <FileText className="h-3.5 w-3.5" /> Saved: {resume.name}
              </p>
            )}
            <SectionCard title="Tell us about yourself">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required hint="Letters, spaces and dots only (3–80 chars)">
                  <input
                    className="form-input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value.replace(/[^A-Za-z. ]/g, "").slice(0, 80))}
                    onBlur={(e) => setFullName(titleCase(e.target.value.trim()))}
                    placeholder="Your full name"
                  />
                </Field>
                <Field label="Mobile number" required hint="OTP-verified Indian number">
                  <input
                    className="form-input bg-surface"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="98xxxxxxxx"
                    readOnly={!!mobile}
                  />
                </Field>
                <Field label="WhatsApp number" hint="Defaults to your mobile — change if different">
                  <input
                    className="form-input"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="WhatsApp 10-digit number"
                  />
                  <label className="mt-2 flex items-start gap-2 text-xs text-foreground/80">
                    <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} />
                    <span>Receive updates, alerts, and notifications on WhatsApp</span>
                  </label>
                </Field>
                <Field label="Headline" hint="One-line summary (max 200 chars)">
                  <input className="form-input" value={headline} maxLength={200} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Sales Executive with 2 years exp" />
                </Field>
                <Field label="City" required>
                  <select className="form-input" value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="">Select city</option>
                    {INDIAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Date of birth"><input type="date" className="form-input" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
                <Field label="Gender">
                  <select className="form-input" value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                  </select>
                </Field>
              </div>
            </SectionCard>
          </div>
        )}

        {currentLabel === "Work status" && (
          <SectionCard title="Your work status">
            <div className="grid gap-3 sm:grid-cols-3">
              {(["fresher", "experienced", "student"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setExpStatus(s)}
                  className={`rounded-xl border p-4 text-left transition ${expStatus === s ? "border-primary bg-primary-light" : "border-border bg-card hover:border-primary/40"}`}>
                  <p className="font-semibold capitalize text-foreground">{s}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s === "fresher" ? "Looking for first job" : s === "experienced" ? "1+ years of work experience" : "Currently studying"}
                  </p>
                </button>
              ))}
            </div>
            {expStatus === "experienced" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Total years of experience" required>
                  <input type="number" min={0} max={50} className="form-input" value={years} onChange={(e) => setYears(Number(e.target.value))} />
                </Field>
                <Field label="Current/last role">
                  <JobTitleAutocomplete value={lastRole} onChange={setLastRole} placeholder="e.g. Sales Executive" />
                </Field>
              </div>
            )}
            {expStatus === "fresher" && (
              <div className="mt-4">
                <Field label="Interested job roles" required hint="Pick roles you'd like to be matched to">
                  <ChipInput values={interestedRoles} onChange={setInterestedRoles} placeholder="e.g. Sales Executive" suggestions={["Sales Executive","Telecaller","Customer Support Executive","Delivery Executive","Data Entry Operator","Receptionist","Office Assistant","Beautician","Driver","Cashier"]} />
                </Field>
                <p className="mt-2 text-xs text-muted-foreground">We&apos;ll suggest skills based on these on the next steps.</p>
              </div>
            )}
          </SectionCard>
        )}

        {currentLabel === "Experience" && (
          <SectionCard title={expStatus === "student" ? "Internships (optional)" : "Work experience"} action={
            <button type="button" onClick={() => setExperiences([...experiences, { job_title: "", company_name: "", start_date: "", end_date: "", is_current: false, description: "" }])}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
              <Plus className="h-4 w-4" /> Add
            </button>
          }>
            {experiences.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {expStatus === "experienced"
                  ? "Please add at least one work experience to continue."
                  : "Add any internships, or click Continue to skip."}
              </p>
            ) : (
              <div className="space-y-4">
                {experiences.map((e, i) => (
                  <div key={i} className="rounded-xl border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">{expStatus === "student" ? "Internship" : "Experience"} #{i + 1}</span>
                      <button type="button" onClick={() => setExperiences(experiences.filter((_, k) => k !== i))} className="text-destructive hover:opacity-70"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={expStatus === "student" ? "Role" : "Job title"} required>
                        <JobTitleAutocomplete value={e.job_title} onChange={(v) => setExperiences(experiences.map((x, k) => k === i ? { ...x, job_title: v } : x))} />
                      </Field>
                      <Field label={expStatus === "student" ? "Organisation" : "Company"} required>
                        <input className="form-input" value={e.company_name} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, company_name: ev.target.value } : x))} />
                      </Field>
                      <Field label="Start date"><input type="date" className="form-input" value={e.start_date} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, start_date: ev.target.value } : x))} /></Field>
                      <Field label="End date">
                        <input type="date" className="form-input" disabled={e.is_current} value={e.end_date} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, end_date: ev.target.value } : x))} />
                        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <input type="checkbox" checked={e.is_current} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, is_current: ev.target.checked } : x))} />
                          {expStatus === "student" ? "Currently ongoing" : "I currently work here"}
                        </label>
                      </Field>
                    </div>
                    <Field label="Description" hint="Optional · up to 1500 chars">
                      <textarea
                        className="form-input min-h-[70px]"
                        maxLength={1500}
                        value={e.description}
                        onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, description: ev.target.value } : x))}
                        placeholder="What did you do here?"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {currentLabel === "Education" && (
          <SectionCard title="Highest qualification">
            <p className="mb-4 text-sm text-muted-foreground">
              Pick your highest qualification now — you can add school/college, board and marks later from your profile.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {QUALIFICATIONS.map((q) => (
                <button key={q} type="button" onClick={() => setHighestQualification(q)}
                  className={`rounded-xl border p-3 text-left text-sm font-medium transition ${highestQualification === q ? "border-primary bg-primary-light text-primary" : "border-border bg-card hover:border-primary/40"}`}>
                  {q}
                </button>
              ))}
            </div>
          </SectionCard>
        )}

        {currentLabel === "Skills & languages" && (
          <div className="space-y-6">
            <SectionCard title="Skills">
              <ChipInput values={skills} onChange={setSkills} suggestions={aiSkills.length ? aiSkills : ["Communication","MS Office","Customer Service","Sales","Hindi","English"]} placeholder="Add a skill" />
              {aiSkills.length > 0 && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" /> Suggestions personalised to your roles
                </p>
              )}
            </SectionCard>
            <SectionCard title="Languages you know" action={
              <button type="button" onClick={() => setLanguages([...languages, { language: "", proficiency: "conversational", can_read: true, can_write: true }])}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
                <Plus className="h-4 w-4" /> Add
              </button>
            }>
              <div className="space-y-3">
                {languages.map((l, i) => (
                  <div key={i} className="grid items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1.2fr,1fr,auto,auto,auto]">
                    <Field label="Language">
                      <input className="form-input" list="lang-suggestions" value={l.language} onChange={(e) => setLanguages(languages.map((x, k) => k === i ? { ...x, language: e.target.value } : x))} />
                    </Field>
                    <Field label="Proficiency">
                      <select className="form-input" value={l.proficiency} onChange={(e) => setLanguages(languages.map((x, k) => k === i ? { ...x, proficiency: e.target.value as Language["proficiency"] } : x))}>
                        <option value="basic">Basic</option><option value="conversational">Conversational</option><option value="fluent">Fluent</option><option value="native">Native</option>
                      </select>
                    </Field>
                    <label className="flex items-center gap-1.5 text-xs text-foreground/80"><input type="checkbox" checked={l.can_read} onChange={(e) => setLanguages(languages.map((x, k) => k === i ? { ...x, can_read: e.target.checked } : x))} /> Read</label>
                    <label className="flex items-center gap-1.5 text-xs text-foreground/80"><input type="checkbox" checked={l.can_write} onChange={(e) => setLanguages(languages.map((x, k) => k === i ? { ...x, can_write: e.target.checked } : x))} /> Write</label>
                    <button type="button" onClick={() => setLanguages(languages.filter((_, k) => k !== i))} className="text-destructive hover:opacity-70"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
              <datalist id="lang-suggestions">{langMaster.map((l) => <option key={l} value={l} />)}</datalist>
            </SectionCard>
            <SectionCard title="What do you have?">
              <div className="flex flex-wrap gap-2">
                {(visibleAssets.length ? visibleAssets : assetsMaster).map((a) => {
                  const on = assets.includes(a.slug);
                  return (
                    <button key={a.slug} type="button" onClick={() => setAssets(on ? assets.filter((x) => x !== a.slug) : [...assets, a.slug])}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        )}

        {currentLabel === "Preferences" && (
          <div className="space-y-6">
            <SectionCard title="Job preferences">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Looking for" required>
                  <div className="flex flex-wrap gap-2">
                    {JOB_TYPE_OPTIONS.map((j) => {
                      const on = jobTypes.includes(j.id);
                      const disabled = expStatus === "student" && j.id !== "internship";
                      return <button key={j.id} type="button" disabled={disabled} onClick={() => setJobTypes(on ? jobTypes.filter((x) => x !== j.id) : [...jobTypes, j.id])}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"} ${disabled ? "opacity-40" : ""}`}>{j.label}</button>;
                    })}
                  </div>
                  {expStatus === "student" && <p className="mt-1 text-xs text-muted-foreground">Students can apply only to Internships.</p>}
                </Field>
                <Field label="Work mode" required hint="Select one or more">
                  <div className="flex flex-wrap gap-2">
                    {WORK_MODES.map((w) => {
                      const on = workModes.includes(w.id);
                      return (
                        <button key={w.id} type="button" onClick={() => setWorkModes(on ? workModes.filter((x) => x !== w.id) : [...workModes, w.id])}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>{w.label}</button>
                      );
                    })}
                  </div>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Preferred cities" required hint="1–4 cities">
                    <ChipInput values={preferredCities} onChange={(v) => setPreferredCities(v.slice(0, 4))} suggestions={INDIAN_CITIES} placeholder="Add cities" />
                  </Field>
                </div>
                {expStatus !== "student" && (
                  <Field label={`Expected monthly salary (₹)${expStatus === "experienced" ? " *" : ""}`}>
                    <input type="number" className="form-input" value={expectedSalary} onChange={(e) => setExpectedSalary(e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 25000" />
                  </Field>
                )}
                {expStatus === "experienced" && (
                  <Field label="Notice period (days) *">
                    <input type="number" className="form-input" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value ? Number(e.target.value) : "")} placeholder="0 if immediately available" />
                  </Field>
                )}
              </div>
            </SectionCard>
          </div>
        )}
          </motion.div>
        </AnimatePresence>

        {/* Footer nav — no skips */}
        <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-xl border border-border bg-card/95 p-3 shadow-[var(--shadow-card)] backdrop-blur sm:p-4">
          <button type="button" disabled={step === 0 || saving} onClick={() => saveStep(-1)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button type="button" onClick={handleNext} disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : step === visibleSteps.length - 1 ? <>Finish <Check className="h-4 w-4" /></> : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}

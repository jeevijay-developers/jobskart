import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2, Upload, FileText, Compass } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { ChipInput, Field, SectionCard } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { INDIAN_CITIES, SUGGESTED_SKILLS, SUGGESTED_LANGUAGES, ASSETS, JOB_TYPE_OPTIONS, WORK_MODES, EDUCATION_LEVELS } from "@/lib/options";
import { computeProfileStrength } from "@/lib/profileStrength";
import { ResumeUpload } from "@/components/candidate/ResumeUpload";
import type { ParsedResumePayload } from "@/lib/resume.functions";

export const Route = createFileRoute("/_authenticated/onboarding/candidate")({
  head: () => ({ meta: [{ title: "Complete your profile · JobsKart" }] }),
  component: OnboardingPage,
});

type Experience = { id?: string; job_title: string; company_name: string; start_date: string; end_date: string; is_current: boolean; description: string };
type Education = { id?: string; level: string; board_or_university: string; institute: string; year_of_passing: number | ""; marks: string };
type Language = { id?: string; language: string; proficiency: "basic" | "conversational" | "fluent" | "native"; can_read: boolean; can_write: boolean };

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
  const [city, setCity] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"male" | "female" | "other" | "prefer_not" | "">("");
  const [headline, setHeadline] = useState("");

  // Work status
  const [expStatus, setExpStatus] = useState<"fresher" | "experienced" | "student">("fresher");
  const [years, setYears] = useState<number>(0);
  const [lastRole, setLastRole] = useState("");

  // Experience
  const [experiences, setExperiences] = useState<Experience[]>([]);

  // Education
  const [educations, setEducations] = useState<Education[]>([{ level: "10th", board_or_university: "", institute: "", year_of_passing: "", marks: "" }]);

  // Skills & languages
  const [skills, setSkills] = useState<string[]>([]);
  const [languages, setLanguages] = useState<Language[]>([{ language: "Hindi", proficiency: "fluent", can_read: true, can_write: true }]);
  const [assets, setAssets] = useState<string[]>([]);

  // Preferences
  const [jobTypes, setJobTypes] = useState<string[]>(["full_time"]);
  const [workMode, setWorkMode] = useState("on_site");
  const [preferredCities, setPreferredCities] = useState<string[]>([]);
  const [expectedSalary, setExpectedSalary] = useState<number | "">("");
  const [noticeDays, setNoticeDays] = useState<number | "">(0);
  const [resume, setResume] = useState<{ name: string; path: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const u = sess.session?.user.id;
      if (!u) return;
      setUid(u);
      const [{ data: p }, { data: c }, { data: ex }, { data: ed }, { data: lg }] = await Promise.all([
        supabase.from("profiles").select("full_name, mobile, city").eq("id", u).maybeSingle(),
        supabase.from("candidate_profiles").select("*").eq("user_id", u).maybeSingle(),
        supabase.from("candidate_experiences").select("*").eq("user_id", u).order("start_date", { ascending: false }),
        supabase.from("candidate_education").select("*").eq("user_id", u).order("year_of_passing", { ascending: false }),
        supabase.from("candidate_languages").select("*").eq("user_id", u),
      ]);
      if (p) { setFullName(p.full_name || ""); setMobile(p.mobile || ""); setCity(p.city || ""); }
      if (c) {
        setHeadline(c.headline || "");
        setDob(c.date_of_birth || ""); setGender((c.gender as typeof gender) || "");
        setExpStatus(c.experience_status as typeof expStatus); setYears(c.years_experience || 0); setLastRole(c.last_role || "");
        setSkills(c.skills || []); setAssets(c.assets || []);
        setJobTypes(c.preferred_job_types?.length ? c.preferred_job_types : ["full_time"]);
        setWorkMode(c.preferred_work_mode || "on_site");
        setPreferredCities(c.preferred_cities || []);
        setExpectedSalary(c.expected_salary || "");
        setNoticeDays(c.notice_period_days ?? 0);
        if (c.resume_url) setResume({ name: c.resume_name || "Resume", path: c.resume_url });
      }
      if (ex?.length) setExperiences(ex.map((e) => ({ ...e, start_date: e.start_date || "", end_date: e.end_date || "", description: e.description || "" })));
      if (ed?.length) setEducations(ed.map((e) => ({ ...e, board_or_university: e.board_or_university || "", institute: e.institute || "", year_of_passing: e.year_of_passing ?? "", marks: e.marks || "" })));
      if (lg?.length) setLanguages(lg.map((l) => ({ ...l, proficiency: l.proficiency as Language["proficiency"] })));
      setLoading(false);
    })();
  }, []);

  const strength = useMemo(() => computeProfileStrength({
    full_name: fullName, mobile, city, headline, last_role: lastRole, skills,
    years_experience: years, preferred_job_types: jobTypes, preferred_cities: preferredCities,
    expected_salary: typeof expectedSalary === "number" ? expectedSalary : null,
    resume_url: resume?.path, experiences_count: experiences.length, education_count: educations.length,
    languages_count: languages.length,
  }), [fullName, mobile, city, headline, lastRole, skills, years, jobTypes, preferredCities, expectedSalary, resume, experiences, educations, languages]);

  const saveStep = async (advance: 1 | -1 | "finish") => {
    if (!uid) return;
    setSaving(true);
    try {
      // Always upsert core profile + candidate_profile
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
        preferred_work_mode: workMode,
        preferred_cities: preferredCities,
        expected_salary: typeof expectedSalary === "number" ? expectedSalary : null,
        notice_period_days: typeof noticeDays === "number" ? noticeDays : null,
        resume_url: resume?.path || null,
        resume_name: resume?.name || null,
        profile_strength: strength,
        onboarding_completed: advance === "finish" ? true : undefined,
      }).eq("user_id", uid);

      if (step === 2) {
        // Sync experiences: simple replace strategy
        await supabase.from("candidate_experiences").delete().eq("user_id", uid);
        if (experiences.length) {
          await supabase.from("candidate_experiences").insert(experiences.map((e) => ({
            user_id: uid, job_title: e.job_title, company_name: e.company_name,
            start_date: e.start_date || null, end_date: e.is_current ? null : (e.end_date || null),
            is_current: e.is_current, description: e.description || null,
          })));
        }
      }
      if (step === 3) {
        await supabase.from("candidate_education").delete().eq("user_id", uid);
        if (educations.length) {
          await supabase.from("candidate_education").insert(educations.map((e) => ({
            user_id: uid, level: e.level, board_or_university: e.board_or_university || null,
            institute: e.institute || null, year_of_passing: e.year_of_passing || null, marks: e.marks || null,
          })));
        }
      }
      if (step === 4) {
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
      setStep((s) => Math.max(0, Math.min(STEPS.length - 1, s + (advance as number))));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const validateBasics = () => {
    if (!fullName.trim()) return "Please enter your full name.";
    if (!/^[6-9]\d{9}$/.test(mobile)) return "Enter a valid 10-digit mobile number.";
    if (!city) return "Please choose your city.";
    return null;
  };

  const handleNext = () => {
    if (step === 0) { const err = validateBasics(); if (err) return toast.error(err); }
    if (step === STEPS.length - 1) return saveStep("finish");
    saveStep(1);
  };

  const uploadResume = async (file: File) => {
    if (!uid) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Resume must be under 5 MB.");
    if (!/pdf|word|officedocument/i.test(file.type)) return toast.error("Upload a PDF or DOC file.");
    setUploading(true);
    const path = `${uid}/resume-${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
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
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        {/* Hero progress card */}
        <div
          className="mb-8 overflow-hidden rounded-3xl p-6 text-white shadow-[0_20px_60px_-20px_rgba(15,27,61,0.4)] sm:p-8"
          style={{
            background:
              "radial-gradient(circle at 10% 10%, rgba(16,185,129,0.30), transparent 55%), linear-gradient(135deg,#0f1b3d 0%,#1e3a5f 100%)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white ring-1 ring-white/25">
                <Compass className="h-3 w-3" /> Step {step + 1} of {STEPS.length}
              </p>
              <h1 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">{STEPS[step]}</h1>
              <p className="mt-1 text-sm text-white/60">A few quick details — you can edit anytime.</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Profile</p>
              <p className="text-3xl font-bold text-white">{strength}%</p>
            </div>
          </div>
          <div className="mt-6 flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  i < step ? "bg-primary" : i === step ? "bg-white" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >

        {step === 0 && (
          <div className="space-y-5">
            <ResumeUpload
              onParsed={(d: ParsedResumePayload) => {
                if (d.full_name && !fullName) setFullName(d.full_name);
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
                if (d.education?.length) {
                  setEducations(
                    d.education.map((ed) => ({
                      level: ed.level || "Graduate",
                      board_or_university: ed.board_or_university || "",
                      institute: ed.institute || "",
                      year_of_passing: ed.year_of_passing ?? "",
                      marks: ed.marks || "",
                    })),
                  );
                }
              }}
            />
            <SectionCard title="Tell us about yourself">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required><input className="form-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" /></Field>
                <Field label="Mobile number" required hint="10-digit Indian number">
                  <input className="form-input" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="98xxxxxxxx" />
                </Field>
                <Field label="Headline" hint="One-line summary about you">
                  <input className="form-input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Delivery executive with 2 years exp" />
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

        {step === 1 && (
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
                  <input className="form-input" value={lastRole} onChange={(e) => setLastRole(e.target.value)} placeholder="e.g. Cashier" />
                </Field>
              </div>
            )}
          </SectionCard>
        )}

        {step === 2 && (
          <SectionCard title="Work experience" action={
            <button type="button" onClick={() => setExperiences([...experiences, { job_title: "", company_name: "", start_date: "", end_date: "", is_current: false, description: "" }])}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
              <Plus className="h-4 w-4" /> Add
            </button>
          }>
            {experiences.length === 0 ? (
              <p className="text-sm text-muted-foreground">No experience yet — that's okay if you're a fresher. Click <strong>Add</strong> to include any.</p>
            ) : (
              <div className="space-y-4">
                {experiences.map((e, i) => (
                  <div key={i} className="rounded-xl border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Experience #{i + 1}</span>
                      <button type="button" onClick={() => setExperiences(experiences.filter((_, k) => k !== i))} className="text-destructive hover:opacity-70"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Job title" required><input className="form-input" value={e.job_title} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, job_title: ev.target.value } : x))} /></Field>
                      <Field label="Company" required><input className="form-input" value={e.company_name} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, company_name: ev.target.value } : x))} /></Field>
                      <Field label="Start date"><input type="date" className="form-input" value={e.start_date} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, start_date: ev.target.value } : x))} /></Field>
                      <Field label="End date">
                        <input type="date" className="form-input" disabled={e.is_current} value={e.end_date} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, end_date: ev.target.value } : x))} />
                        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <input type="checkbox" checked={e.is_current} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, is_current: ev.target.checked } : x))} />
                          I currently work here
                        </label>
                      </Field>
                    </div>
                    <Field label="Description"><textarea className="form-input min-h-[70px]" value={e.description} onChange={(ev) => setExperiences(experiences.map((x, k) => k === i ? { ...x, description: ev.target.value } : x))} placeholder="What did you do here?" /></Field>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {step === 3 && (
          <SectionCard title="Education" action={
            <button type="button" onClick={() => setEducations([...educations, { level: "Graduate", board_or_university: "", institute: "", year_of_passing: "", marks: "" }])}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
              <Plus className="h-4 w-4" /> Add
            </button>
          }>
            <div className="space-y-4">
              {educations.map((e, i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Education #{i + 1}</span>
                    {educations.length > 1 && (
                      <button type="button" onClick={() => setEducations(educations.filter((_, k) => k !== i))} className="text-destructive hover:opacity-70"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Level" required>
                      <select className="form-input" value={e.level} onChange={(ev) => setEducations(educations.map((x, k) => k === i ? { ...x, level: ev.target.value } : x))}>
                        {EDUCATION_LEVELS.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Board / University"><input className="form-input" value={e.board_or_university} onChange={(ev) => setEducations(educations.map((x, k) => k === i ? { ...x, board_or_university: ev.target.value } : x))} /></Field>
                    <Field label="School / College"><input className="form-input" value={e.institute} onChange={(ev) => setEducations(educations.map((x, k) => k === i ? { ...x, institute: ev.target.value } : x))} /></Field>
                    <Field label="Year of passing"><input type="number" min={1970} max={2035} className="form-input" value={e.year_of_passing} onChange={(ev) => setEducations(educations.map((x, k) => k === i ? { ...x, year_of_passing: ev.target.value ? Number(ev.target.value) : "" } : x))} /></Field>
                    <Field label="Marks / Grade"><input className="form-input" value={e.marks} onChange={(ev) => setEducations(educations.map((x, k) => k === i ? { ...x, marks: ev.target.value } : x))} placeholder="e.g. 78%" /></Field>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <SectionCard title="Skills">
              <ChipInput values={skills} onChange={setSkills} suggestions={SUGGESTED_SKILLS} placeholder="Add a skill" />
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
              <datalist id="lang-suggestions">{SUGGESTED_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
            </SectionCard>
            <SectionCard title="What do you have?">
              <div className="flex flex-wrap gap-2">
                {ASSETS.map((a) => {
                  const on = assets.includes(a.id);
                  return (
                    <button key={a.id} type="button" onClick={() => setAssets(on ? assets.filter((x) => x !== a.id) : [...assets, a.id])}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <SectionCard title="Job preferences">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Looking for">
                  <div className="flex flex-wrap gap-2">
                    {JOB_TYPE_OPTIONS.map((j) => {
                      const on = jobTypes.includes(j.id);
                      return <button key={j.id} type="button" onClick={() => setJobTypes(on ? jobTypes.filter((x) => x !== j.id) : [...jobTypes, j.id])}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>{j.label}</button>;
                    })}
                  </div>
                </Field>
                <Field label="Work mode">
                  <div className="flex gap-2">
                    {WORK_MODES.map((w) => (
                      <button key={w.id} type="button" onClick={() => setWorkMode(w.id)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${workMode === w.id ? "border-primary bg-primary-light text-primary" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>{w.label}</button>
                    ))}
                  </div>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Preferred cities">
                    <ChipInput values={preferredCities} onChange={setPreferredCities} suggestions={INDIAN_CITIES} placeholder="Add cities" />
                  </Field>
                </div>
                <Field label="Expected monthly salary (₹)">
                  <input type="number" className="form-input" value={expectedSalary} onChange={(e) => setExpectedSalary(e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 25000" />
                </Field>
                <Field label="Notice period (days)">
                  <input type="number" className="form-input" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value ? Number(e.target.value) : "")} placeholder="0 if immediately available" />
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Upload resume">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface p-8 text-center hover:border-primary">
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && uploadResume(e.target.files[0])} />
                {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : resume ? <FileText className="h-7 w-7 text-success" /> : <Upload className="h-7 w-7 text-muted-foreground" />}
                <p className="text-sm font-medium text-foreground">{resume ? resume.name : "Click to upload (PDF / DOC, ≤ 5 MB)"}</p>
                {resume && <p className="text-xs text-success">Uploaded · click to replace</p>}
              </label>
            </SectionCard>
          </div>
        )}
          </motion.div>
        </AnimatePresence>

        {/* Footer nav */}
        <div className="sticky bottom-0 mt-6 flex items-center justify-between rounded-xl border border-border bg-card/95 p-3 shadow-[var(--shadow-card)] backdrop-blur sm:p-4">
          <button type="button" disabled={step === 0 || saving} onClick={() => saveStep(-1)}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            {step < STEPS.length - 1 && (
              <button type="button" onClick={() => saveStep(1)} disabled={saving} className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline">
                Skip for now
              </button>
            )}
            <button type="button" onClick={handleNext} disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : step === STEPS.length - 1 ? <>Finish <Check className="h-4 w-4" /></> : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

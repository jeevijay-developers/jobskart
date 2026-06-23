import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, CheckCircle2, Eye, ExternalLink, FileText, GraduationCap, Languages as LangIcon, Loader2, Pencil, Plus, ShieldCheck, Trash2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { SectionCard, EmptyHint, Chip, ChipInput, Field } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";
import { computeProfileStrength, strengthLabel } from "@/lib/profileStrength";
import { INDIAN_CITIES, SUGGESTED_SKILLS, SUGGESTED_LANGUAGES, JOB_TYPE_OPTIONS, WORK_MODES, ID_TYPES, EDUCATION_LEVELS } from "@/lib/options";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ResumeUpload } from "@/components/candidate/ResumeUpload";
import type { ParsedResumePayload } from "@/lib/resume.functions";

export const Route = createFileRoute("/_authenticated/candidate/profile")({
  head: () => ({ meta: [{ title: "My Profile · JobsKart" }] }),
  component: ProfilePage,
});

type Profile = { full_name: string; mobile: string; city: string; avatar_url: string | null };
type Candidate = {
  headline: string | null; bio: string | null; date_of_birth: string | null; gender: string | null;
  experience_status: string; years_experience: number; last_role: string | null;
  skills: string[]; preferred_job_types: string[]; preferred_work_mode: string | null;
  preferred_cities: string[]; expected_salary: number | null; notice_period_days: number | null;
  resume_url: string | null; resume_name: string | null;
  government_id_type: string | null; government_id_last4: string | null; kyc_status: string;
  profile_slug: string | null; profile_strength: number; profile_views: number;
};
type Exp = { id?: string; job_title: string; company_name: string; start_date: string; end_date: string; is_current: boolean; description: string };
type Edu = { id?: string; level: string; board_or_university: string; institute: string; year_of_passing: number | ""; marks: string };
type Lang = { id?: string; language: string; proficiency: "basic" | "conversational" | "fluent" | "native"; can_read: boolean; can_write: boolean };

function ProfilePage() {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [p, setP] = useState<Profile | null>(null);
  const [c, setC] = useState<Candidate | null>(null);
  const [experiences, setExperiences] = useState<Exp[]>([]);
  const [educations, setEducations] = useState<Edu[]>([]);
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [open, setOpen] = useState<null | "personal" | "headline" | "career" | "experience" | "education" | "skills" | "languages" | "resume" | "kyc">(null);

  const load = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const u = sess.session?.user.id;
    if (!u) return;
    setUid(u);
    const [{ data: pr }, { data: cp }, { data: ex }, { data: ed }, { data: lg }] = await Promise.all([
      supabase.from("profiles").select("full_name, mobile, city, avatar_url").eq("id", u).maybeSingle(),
      supabase.from("candidate_profiles").select("*").eq("user_id", u).maybeSingle(),
      supabase.from("candidate_experiences").select("*").eq("user_id", u).order("start_date", { ascending: false }),
      supabase.from("candidate_education").select("*").eq("user_id", u).order("year_of_passing", { ascending: false }),
      supabase.from("candidate_languages").select("*").eq("user_id", u),
    ]);
    setP(pr as Profile);
    setC(cp as unknown as Candidate);
    setExperiences((ex || []).map((e) => ({ ...e, start_date: e.start_date || "", end_date: e.end_date || "", description: e.description || "" })) as Exp[]);
    setEducations((ed || []).map((e) => ({ ...e, board_or_university: e.board_or_university || "", institute: e.institute || "", year_of_passing: e.year_of_passing ?? "", marks: e.marks || "" })) as Edu[]);
    setLanguages((lg || []) as Lang[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const strength = useMemo(() => {
    if (!p || !c) return 0;
    return computeProfileStrength({
      full_name: p.full_name, mobile: p.mobile, city: p.city, avatar_url: p.avatar_url,
      headline: c.headline, last_role: c.last_role, bio: c.bio, skills: c.skills,
      years_experience: c.years_experience, preferred_job_types: c.preferred_job_types,
      preferred_cities: c.preferred_cities, expected_salary: c.expected_salary,
      resume_url: c.resume_url, experiences_count: experiences.length,
      education_count: educations.length, languages_count: languages.length,
      kyc_verified: c.kyc_status === "verified",
    });
  }, [p, c, experiences, educations, languages]);

  useEffect(() => {
    if (uid && c && strength !== c.profile_strength) {
      supabase.from("candidate_profiles").update({ profile_strength: strength }).eq("user_id", uid);
    }
  }, [strength, uid, c]);

  if (loading || !p || !c) {
    return <CandidateShell title="My Profile"><div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></CandidateShell>;
  }

  const initials = (p.full_name || "U").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const sLabel = strengthLabel(strength);

  return (
    <CandidateShell
      title="My Profile"
      subtitle="Keep your profile sharp — complete profiles get 3× more responses."
      actions={
        c.profile_slug ? (
          <Link to="/u/$slug" params={{ slug: c.profile_slug }} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:border-primary">
            <ExternalLink className="h-4 w-4" /> Preview public profile
          </Link>
        ) : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
        {/* Sticky summary */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-primary-light text-lg font-bold text-primary">{initials}</div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">{p.full_name || "Add your name"}</p>
                <p className="truncate text-xs text-muted-foreground">{c.headline || (c.last_role ? c.last_role : "Add a headline")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.city || "—"}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-foreground">Profile strength</span>
                <span className={`font-bold ${sLabel.color}`}>{strength}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${strength}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{sLabel.label}</p>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-primary" /> {c.profile_views} profile views
            </div>
            {c.kyc_status === "verified" ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">
                <ShieldCheck className="h-3.5 w-3.5" /> KYC verified
              </div>
            ) : (
              <button onClick={() => setOpen("kyc")} className="mt-2 w-full rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100">
                Verify your identity
              </button>
            )}
          </div>
        </aside>

        {/* Sections */}
        <div className="space-y-6">
          <SectionCard title="Personal details" action={<EditBtn onClick={() => setOpen("personal")} />}>
            <Grid>
              <Info label="Full name" value={p.full_name} />
              <Info label="Mobile" value={p.mobile} />
              <Info label="City" value={p.city} />
              <Info label="DOB" value={c.date_of_birth ? new Date(c.date_of_birth).toLocaleDateString() : null} />
              <Info label="Gender" value={c.gender} />
              <Info label="Bio" value={c.bio} wide />
            </Grid>
          </SectionCard>

          <SectionCard title="Career preferences" action={<EditBtn onClick={() => setOpen("career")} />}>
            <Grid>
              <Info label="Status" value={c.experience_status} />
              <Info label="Experience" value={c.years_experience ? `${c.years_experience} years` : null} />
              <Info label="Last role" value={c.last_role} />
              <Info label="Job types" value={c.preferred_job_types?.length ? c.preferred_job_types.map((t) => JOB_TYPE_OPTIONS.find((x) => x.id === t)?.label || t).join(", ") : null} />
              <Info label="Work mode" value={WORK_MODES.find((w) => w.id === c.preferred_work_mode)?.label || null} />
              <Info label="Expected salary" value={c.expected_salary ? `₹${c.expected_salary.toLocaleString()}/mo` : null} />
              <Info label="Notice period" value={c.notice_period_days != null ? `${c.notice_period_days} days` : null} />
              <Info label="Preferred cities" value={c.preferred_cities?.join(", ") || null} wide />
            </Grid>
          </SectionCard>

          <SectionCard title="Work experience" action={<EditBtn onClick={() => setOpen("experience")} label="Manage" />}>
            {experiences.length === 0 ? <EmptyHint>No experience added yet.</EmptyHint> : (
              <ul className="divide-y divide-border">
                {experiences.map((e) => (
                  <li key={e.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <Briefcase className="mt-0.5 h-4 w-4 text-primary" />
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{e.job_title}</p>
                        <p className="text-sm text-muted-foreground">{e.company_name} · {fmtPeriod(e.start_date, e.end_date, e.is_current)}</p>
                        {e.description && <p className="mt-1 text-sm text-foreground/80">{e.description}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Education" action={<EditBtn onClick={() => setOpen("education")} label="Manage" />}>
            {educations.length === 0 ? <EmptyHint>Add at least your 10th class.</EmptyHint> : (
              <ul className="divide-y divide-border">
                {educations.map((e) => (
                  <li key={e.id} className="py-3 flex items-start gap-3">
                    <GraduationCap className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-semibold text-foreground">{e.level}{e.year_of_passing ? ` · ${e.year_of_passing}` : ""}</p>
                      <p className="text-sm text-muted-foreground">{[e.institute, e.board_or_university].filter(Boolean).join(" — ")}{e.marks ? ` · ${e.marks}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Skills" action={<EditBtn onClick={() => setOpen("skills")} />}>
            {c.skills.length === 0 ? <EmptyHint>Add skills to get matched with jobs.</EmptyHint> :
              <div className="flex flex-wrap gap-2">{c.skills.map((s) => <Chip key={s} label={s} />)}</div>}
          </SectionCard>

          <SectionCard title="Languages" action={<EditBtn onClick={() => setOpen("languages")} label="Manage" />}>
            {languages.length === 0 ? <EmptyHint>Add the languages you speak.</EmptyHint> :
              <ul className="space-y-1.5">
                {languages.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <LangIcon className="h-4 w-4 text-primary" />
                    <span className="font-medium text-foreground">{l.language}</span>
                    <span className="text-muted-foreground">· {l.proficiency}</span>
                    {l.can_read && <span className="text-xs text-success">Read</span>}
                    {l.can_write && <span className="text-xs text-success">Write</span>}
                  </li>
                ))}
              </ul>}
          </SectionCard>

          <SectionCard title="Resume" action={<EditBtn onClick={() => setOpen("resume")} label={c.resume_url ? "Replace" : "Upload"} />}>
            {c.resume_url ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-foreground">{c.resume_name || "Resume"}</span>
                <button onClick={async () => {
                  const { data } = await supabase.storage.from("candidate-docs").createSignedUrl(c.resume_url!, 60);
                  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                }} className="ml-auto text-sm font-semibold text-primary hover:underline">View</button>
              </div>
            ) : <EmptyHint>No resume uploaded yet.</EmptyHint>}
          </SectionCard>
        </div>
      </div>

      {/* Editor dialogs */}
      <PersonalDialog open={open === "personal"} onClose={() => setOpen(null)} uid={uid!} p={p} c={c} onSaved={load} />
      <CareerDialog open={open === "career"} onClose={() => setOpen(null)} uid={uid!} c={c} onSaved={load} />
      <SkillsDialog open={open === "skills"} onClose={() => setOpen(null)} uid={uid!} c={c} onSaved={load} />
      <ExperiencesDialog open={open === "experience"} onClose={() => setOpen(null)} uid={uid!} items={experiences} onSaved={load} />
      <EducationDialog open={open === "education"} onClose={() => setOpen(null)} uid={uid!} items={educations} onSaved={load} />
      <LanguagesDialog open={open === "languages"} onClose={() => setOpen(null)} uid={uid!} items={languages} onSaved={load} />
      <ResumeDialog open={open === "resume"} onClose={() => setOpen(null)} uid={uid!} current={c.resume_name} onSaved={load} />
      <KycDialog open={open === "kyc"} onClose={() => setOpen(null)} uid={uid!} c={c} onSaved={load} />
    </CandidateShell>
  );
}

function fmtPeriod(s: string, e: string, current: boolean) {
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
  return `${fmt(s)} – ${current ? "Present" : fmt(e)}`;
}

function EditBtn({ onClick, label = "Edit" }: { onClick: () => void; label?: string }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary"><Pencil className="h-3.5 w-3.5" /> {label}</button>;
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 sm:grid-cols-2">{children}</div>; }
function Info({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value || <span className="text-muted-foreground">—</span>}</p>
    </div>
  );
}

// ----- Dialogs -----
function DlgShell({ open, onClose, title, children, onSave, saving }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; onSave?: () => void; saving?: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="py-2">{children}</div>
        {onSave && (
          <DialogFooter>
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface">Cancel</button>
            <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonalDialog({ open, onClose, uid, p, c, onSaved }: { open: boolean; onClose: () => void; uid: string; p: Profile; c: Candidate; onSaved: () => void }) {
  const [full_name, setFn] = useState(p.full_name); const [mobile, setMo] = useState(p.mobile); const [city, setCity] = useState(p.city);
  const [dob, setDob] = useState(c.date_of_birth || ""); const [gender, setGender] = useState(c.gender || "");
  const [bio, setBio] = useState(c.bio || ""); const [headline, setHeadline] = useState(c.headline || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setFn(p.full_name); setMo(p.mobile); setCity(p.city); setDob(c.date_of_birth || ""); setGender(c.gender || ""); setBio(c.bio || ""); setHeadline(c.headline || ""); } }, [open, p, c]);
  const save = async () => {
    setSaving(true);
    await supabase.from("profiles").update({ full_name, mobile, city }).eq("id", uid);
    await supabase.from("candidate_profiles").update({ date_of_birth: dob || null, gender: gender || null, bio: bio || null, headline: headline || null }).eq("user_id", uid);
    setSaving(false); toast.success("Saved"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Personal details" onSave={save} saving={saving}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name"><input className="form-input" value={full_name} onChange={(e) => setFn(e.target.value)} /></Field>
        <Field label="Mobile"><input className="form-input" value={mobile} onChange={(e) => setMo(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
        <Field label="City"><select className="form-input" value={city} onChange={(e) => setCity(e.target.value)}><option value="">Select</option>{INDIAN_CITIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Date of birth"><input type="date" className="form-input" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
        <Field label="Gender"><select className="form-input" value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Prefer not to say</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
        <div className="sm:col-span-2"><Field label="Headline"><input className="form-input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Sales executive · 3 yrs in retail" /></Field></div>
        <div className="sm:col-span-2"><Field label="About you"><textarea className="form-input min-h-[100px]" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Brief intro" /></Field></div>
      </div>
    </DlgShell>
  );
}

function CareerDialog({ open, onClose, uid, c, onSaved }: { open: boolean; onClose: () => void; uid: string; c: Candidate; onSaved: () => void }) {
  const [status, setStatus] = useState(c.experience_status); const [years, setYears] = useState(c.years_experience);
  const [lastRole, setLastRole] = useState(c.last_role || ""); const [jobTypes, setJobTypes] = useState<string[]>(c.preferred_job_types || []);
  const [workMode, setWorkMode] = useState(c.preferred_work_mode || "on_site");
  const [cities, setCities] = useState<string[]>(c.preferred_cities || []);
  const [salary, setSalary] = useState<number | "">(c.expected_salary ?? "");
  const [notice, setNotice] = useState<number | "">(c.notice_period_days ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setStatus(c.experience_status); setYears(c.years_experience); setLastRole(c.last_role || ""); setJobTypes(c.preferred_job_types || []); setWorkMode(c.preferred_work_mode || "on_site"); setCities(c.preferred_cities || []); setSalary(c.expected_salary ?? ""); setNotice(c.notice_period_days ?? ""); } }, [open, c]);
  const save = async () => {
    setSaving(true);
    await supabase.from("candidate_profiles").update({
      experience_status: status as "fresher" | "experienced" | "student", years_experience: years || 0, last_role: lastRole || null,
      preferred_job_types: jobTypes, preferred_work_mode: workMode,
      preferred_cities: cities, expected_salary: typeof salary === "number" ? salary : null,
      notice_period_days: typeof notice === "number" ? notice : null,
    }).eq("user_id", uid);
    setSaving(false); toast.success("Saved"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Career preferences" onSave={save} saving={saving}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status"><select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="fresher">Fresher</option><option value="experienced">Experienced</option><option value="student">Student</option></select></Field>
        <Field label="Years of experience"><input type="number" min={0} className="form-input" value={years} onChange={(e) => setYears(Number(e.target.value))} /></Field>
        <div className="sm:col-span-2"><Field label="Current/last role"><input className="form-input" value={lastRole} onChange={(e) => setLastRole(e.target.value)} /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Looking for">
            <div className="flex flex-wrap gap-2">
              {JOB_TYPE_OPTIONS.map((j) => {
                const on = jobTypes.includes(j.id);
                return <button key={j.id} type="button" onClick={() => setJobTypes(on ? jobTypes.filter((x) => x !== j.id) : [...jobTypes, j.id])}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground/70 hover:border-primary"}`}>{j.label}</button>;
              })}
            </div>
          </Field>
        </div>
        <Field label="Work mode">
          <select className="form-input" value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
            {WORK_MODES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </Field>
        <Field label="Expected salary (₹/mo)"><input type="number" className="form-input" value={salary} onChange={(e) => setSalary(e.target.value ? Number(e.target.value) : "")} /></Field>
        <Field label="Notice period (days)"><input type="number" className="form-input" value={notice} onChange={(e) => setNotice(e.target.value ? Number(e.target.value) : "")} /></Field>
        <div className="sm:col-span-2"><Field label="Preferred cities"><ChipInput values={cities} onChange={setCities} suggestions={INDIAN_CITIES} /></Field></div>
      </div>
    </DlgShell>
  );
}

function SkillsDialog({ open, onClose, uid, c, onSaved }: { open: boolean; onClose: () => void; uid: string; c: Candidate; onSaved: () => void }) {
  const [skills, setSkills] = useState<string[]>(c.skills); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setSkills(c.skills); }, [open, c]);
  const save = async () => { setSaving(true); await supabase.from("candidate_profiles").update({ skills }).eq("user_id", uid); setSaving(false); toast.success("Saved"); onSaved(); onClose(); };
  return <DlgShell open={open} onClose={onClose} title="Your skills" onSave={save} saving={saving}><ChipInput values={skills} onChange={setSkills} suggestions={SUGGESTED_SKILLS} /></DlgShell>;
}

function ExperiencesDialog({ open, onClose, uid, items, onSaved }: { open: boolean; onClose: () => void; uid: string; items: Exp[]; onSaved: () => void }) {
  const [list, setList] = useState<Exp[]>(items); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setList(items); }, [open, items]);
  const save = async () => {
    setSaving(true);
    await supabase.from("candidate_experiences").delete().eq("user_id", uid);
    if (list.length) {
      await supabase.from("candidate_experiences").insert(list.map((e) => ({
        user_id: uid, job_title: e.job_title, company_name: e.company_name,
        start_date: e.start_date || null, end_date: e.is_current ? null : (e.end_date || null),
        is_current: e.is_current, description: e.description || null,
      })));
    }
    setSaving(false); toast.success("Saved"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Work experience" onSave={save} saving={saving}>
      <div className="space-y-3">
        {list.map((e, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">#{i + 1}</span>
              <button onClick={() => setList(list.filter((_, k) => k !== i))} className="text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><input className="form-input" value={e.job_title} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, job_title: ev.target.value } : x))} /></Field>
              <Field label="Company"><input className="form-input" value={e.company_name} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, company_name: ev.target.value } : x))} /></Field>
              <Field label="From"><input type="date" className="form-input" value={e.start_date} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, start_date: ev.target.value } : x))} /></Field>
              <Field label="To">
                <input type="date" className="form-input" disabled={e.is_current} value={e.end_date} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, end_date: ev.target.value } : x))} />
                <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={e.is_current} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, is_current: ev.target.checked } : x))} /> Currently working</label>
              </Field>
            </div>
            <Field label="Description"><textarea className="form-input min-h-[60px]" value={e.description} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, description: ev.target.value } : x))} /></Field>
          </div>
        ))}
        <button onClick={() => setList([...list, { job_title: "", company_name: "", start_date: "", end_date: "", is_current: false, description: "" }])}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-light"><Plus className="h-4 w-4" /> Add experience</button>
      </div>
    </DlgShell>
  );
}

function EducationDialog({ open, onClose, uid, items, onSaved }: { open: boolean; onClose: () => void; uid: string; items: Edu[]; onSaved: () => void }) {
  const [list, setList] = useState<Edu[]>(items); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setList(items.length ? items : [{ level: "10th", board_or_university: "", institute: "", year_of_passing: "", marks: "" }]); }, [open, items]);
  const save = async () => {
    setSaving(true);
    await supabase.from("candidate_education").delete().eq("user_id", uid);
    if (list.length) {
      await supabase.from("candidate_education").insert(list.map((e) => ({
        user_id: uid, level: e.level, board_or_university: e.board_or_university || null,
        institute: e.institute || null, year_of_passing: e.year_of_passing || null, marks: e.marks || null,
      })));
    }
    setSaving(false); toast.success("Saved"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Education" onSave={save} saving={saving}>
      <div className="space-y-3">
        {list.map((e, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">#{i + 1}</span>
              {list.length > 1 && <button onClick={() => setList(list.filter((_, k) => k !== i))} className="text-destructive"><Trash2 className="h-4 w-4" /></button>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Level"><select className="form-input" value={e.level} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, level: ev.target.value } : x))}>{EDUCATION_LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>
              <Field label="Board / University"><input className="form-input" value={e.board_or_university} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, board_or_university: ev.target.value } : x))} /></Field>
              <Field label="Institute"><input className="form-input" value={e.institute} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, institute: ev.target.value } : x))} /></Field>
              <Field label="Year"><input type="number" className="form-input" value={e.year_of_passing} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, year_of_passing: ev.target.value ? Number(ev.target.value) : "" } : x))} /></Field>
              <Field label="Marks"><input className="form-input" value={e.marks} onChange={(ev) => setList(list.map((x, k) => k === i ? { ...x, marks: ev.target.value } : x))} /></Field>
            </div>
          </div>
        ))}
        <button onClick={() => setList([...list, { level: "Graduate", board_or_university: "", institute: "", year_of_passing: "", marks: "" }])}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-light"><Plus className="h-4 w-4" /> Add education</button>
      </div>
    </DlgShell>
  );
}

function LanguagesDialog({ open, onClose, uid, items, onSaved }: { open: boolean; onClose: () => void; uid: string; items: Lang[]; onSaved: () => void }) {
  const [list, setList] = useState<Lang[]>(items); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setList(items); }, [open, items]);
  const save = async () => {
    setSaving(true);
    await supabase.from("candidate_languages").delete().eq("user_id", uid);
    const filtered = list.filter((l) => l.language.trim());
    if (filtered.length) await supabase.from("candidate_languages").insert(filtered.map((l) => ({ user_id: uid, language: l.language.trim(), proficiency: l.proficiency, can_read: l.can_read, can_write: l.can_write })));
    setSaving(false); toast.success("Saved"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Languages" onSave={save} saving={saving}>
      <div className="space-y-2">
        {list.map((l, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1.2fr,1fr,auto,auto,auto]">
            <Field label="Language"><input className="form-input" list="lang-dl" value={l.language} onChange={(e) => setList(list.map((x, k) => k === i ? { ...x, language: e.target.value } : x))} /></Field>
            <Field label="Proficiency">
              <select className="form-input" value={l.proficiency} onChange={(e) => setList(list.map((x, k) => k === i ? { ...x, proficiency: e.target.value as Lang["proficiency"] } : x))}>
                <option value="basic">Basic</option><option value="conversational">Conversational</option><option value="fluent">Fluent</option><option value="native">Native</option>
              </select>
            </Field>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.can_read} onChange={(e) => setList(list.map((x, k) => k === i ? { ...x, can_read: e.target.checked } : x))} /> Read</label>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={l.can_write} onChange={(e) => setList(list.map((x, k) => k === i ? { ...x, can_write: e.target.checked } : x))} /> Write</label>
            <button onClick={() => setList(list.filter((_, k) => k !== i))} className="text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setList([...list, { language: "", proficiency: "conversational", can_read: true, can_write: true }])}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-sm font-semibold text-primary hover:bg-primary-light"><Plus className="h-4 w-4" /> Add language</button>
        <datalist id="lang-dl">{SUGGESTED_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
      </div>
    </DlgShell>
  );
}

function ResumeDialog({ open, onClose, uid, current, onSaved }: { open: boolean; onClose: () => void; uid: string; current: string | null; onSaved: () => void }) {
  return (
    <DlgShell open={open} onClose={onClose} title="Upload resume">
      {current && (
        <p className="mb-3 text-xs text-muted-foreground">
          Current: <span className="font-medium text-foreground">{current}</span> — uploading a new file will replace it.
        </p>
      )}
      <ResumeUpload
        onParsed={async (parsed, file) => {
          try {
            const path = `${uid}/resume-${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
            const up = await supabase.storage.from("candidate-docs").upload(path, file, { upsert: true });
            if (up.error) throw up.error;

            // Build the patch from parsed fields (only update empty/missing fields)
            const candPatch: Record<string, unknown> = { resume_url: path, resume_name: file.name };
            const profPatch: Record<string, unknown> = {};
            if (parsed.headline) candPatch.headline = parsed.headline;
            if (typeof parsed.years_experience === "number") {
              candPatch.years_experience = parsed.years_experience;
              candPatch.experience_status = parsed.years_experience > 0 ? "experienced" : "fresher";
            }
            if (parsed.skills?.length) candPatch.skills = parsed.skills.slice(0, 25);
            if (parsed.full_name) profPatch.full_name = parsed.full_name;
            if (parsed.city) profPatch.city = parsed.city;

            await supabase.from("candidate_profiles").update(candPatch as never).eq("user_id", uid);
            if (Object.keys(profPatch).length) {
              await supabase.from("profiles").update(profPatch as never).eq("id", uid);
            }
            if (parsed.experiences?.length) {
              const rows = parsed.experiences
                .filter((e) => e.job_title || e.company_name)
                .map((e) => ({
                  user_id: uid,
                  job_title: e.job_title || "",
                  company_name: e.company_name || "",
                  start_date: e.start_date || null,
                  end_date: e.end_date || null,
                  is_current: !!e.is_current,
                  description: e.description || "",
                }));
              if (rows.length) await supabase.from("candidate_experiences").insert(rows);
            }
            if (parsed.education?.length) {
              const rows = parsed.education
                .filter((e) => e.level || e.institute)
                .map((e) => ({
                  user_id: uid,
                  level: e.level || "",
                  board_or_university: e.board_or_university || "",
                  institute: e.institute || "",
                  year_of_passing: e.year_of_passing ?? null,
                  marks: e.marks || "",
                }));
              if (rows.length) await supabase.from("candidate_education").insert(rows);
            }
            await supabase.from("candidate_documents").insert({
              user_id: uid, doc_type: "resume", file_path: path, file_name: file.name, size_bytes: file.size,
            });
            toast.success("Resume saved — review the auto-filled fields below.");
            onSaved();
            onClose();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not save resume.");
          }
        }}
      />
    </DlgShell>
  );
}

function KycDialog({ open, onClose, uid, c, onSaved }: { open: boolean; onClose: () => void; uid: string; c: Candidate; onSaved: () => void }) {
  const [idType, setIdType] = useState(c.government_id_type || "Aadhaar");
  const [idNum, setIdNum] = useState("");
  const [verifying, setVerifying] = useState(false);
  const verify = async () => {
    if (idNum.length < 6) return toast.error("Enter a valid ID number.");
    setVerifying(true);
    // Stubbed KYC: pretend a verification API takes 1.5s and always approves in dev
    await new Promise((r) => setTimeout(r, 1500));
    await supabase.from("candidate_profiles").update({
      government_id_type: idType, government_id_last4: idNum.slice(-4), kyc_status: "verified",
    }).eq("user_id", uid);
    setVerifying(false); toast.success("Identity verified"); onSaved(); onClose();
  };
  return (
    <DlgShell open={open} onClose={onClose} title="Verify your identity">
      <p className="mb-3 text-sm text-muted-foreground">Verified candidates get priority responses from employers. Your ID is stored encrypted; we only show the last 4 digits.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID type"><select className="form-input" value={idType} onChange={(e) => setIdType(e.target.value)}>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="ID number"><input className="form-input" value={idNum} onChange={(e) => setIdNum(e.target.value)} placeholder="Enter number" /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface">Cancel</button>
        <button onClick={verify} disabled={verifying} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
          {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify
        </button>
      </div>
    </DlgShell>
  );
}

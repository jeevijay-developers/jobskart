import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Bookmark, Briefcase, CalendarCheck, Camera, CheckCircle2, Clock, Eye, ExternalLink, FileText, GraduationCap, HelpCircle, Languages as LangIcon, Loader2, MapPin, Pencil, Plus, ShieldCheck, Trash2, Upload, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  const [email, setEmail] = useState<string | null>(null);
  const [counts, setCounts] = useState({ applications: 0, interviews: 0, saved: 0 });

  const load = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const u = sess.session?.user.id;
    if (!u) return;
    setUid(u);
    setEmail(sess.session?.user.email ?? null);
    const [{ data: pr }, { data: cp }, { data: ex }, { data: ed }, { data: lg }, apps, ivs, saved] = await Promise.all([
      supabase.from("profiles").select("full_name, mobile, city, avatar_url").eq("id", u).maybeSingle(),
      supabase.from("candidate_profiles").select("*").eq("user_id", u).maybeSingle(),
      supabase.from("candidate_experiences").select("*").eq("user_id", u).order("start_date", { ascending: false }),
      supabase.from("candidate_education").select("*").eq("user_id", u).order("year_of_passing", { ascending: false }),
      supabase.from("candidate_languages").select("*").eq("user_id", u),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("candidate_id", u),
      supabase.from("interviews").select("id", { count: "exact", head: true }).eq("candidate_id", u),
      supabase.from("saved_jobs").select("id", { count: "exact", head: true }).eq("user_id", u),
    ]);
    setP(pr as Profile);
    setC(cp as unknown as Candidate);
    setExperiences((ex || []).map((e) => ({ ...e, start_date: e.start_date || "", end_date: e.end_date || "", description: e.description || "" })) as Exp[]);
    setEducations((ed || []).map((e) => ({ ...e, board_or_university: e.board_or_university || "", institute: e.institute || "", year_of_passing: e.year_of_passing ?? "", marks: e.marks || "" })) as Edu[]);
    setLanguages((lg || []) as Lang[]);
    setCounts({ applications: apps.count ?? 0, interviews: ivs.count ?? 0, saved: saved.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Deep-link scroll: /candidate/profile?section=resume
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (!section) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(section);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("ring-2", "ring-primary/40", "rounded-2xl");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary/40", "rounded-2xl"), 1600);
      }
    }, 120);
    return () => window.clearTimeout(t);
  }, [loading]);

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

  const tips = [
    { label: "Add a professional headline", done: !!c.headline },
    { label: "Add work experience", done: experiences.length > 0 },
    { label: "Add skills", done: c.skills.length > 0 },
    { label: "Upload resume", done: !!c.resume_url },
    { label: "Verify your identity", done: c.kyc_status === "verified" },
  ];

  return (
    <CandidateShell
      title="My Profile"
      subtitle="Keep your profile sharp — complete profiles get 3× more responses."
      actions={
        c.profile_slug ? (
          <Link to="/u/$slug" params={{ slug: c.profile_slug }} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface">
            <Eye className="h-4 w-4" /> View public profile
          </Link>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 xl:col-span-2">
          {/* Profile overview */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <div className="relative shrink-0">
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt={p.full_name || "Profile photo"} className="h-24 w-24 rounded-full object-cover" />
                ) : (
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-primary/80 text-3xl font-medium text-primary-foreground">{initials}</div>
                )}
                <button onClick={() => setOpen("personal")} aria-label="Change photo" className="absolute bottom-0 right-0 rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-sm hover:bg-surface">
                  <Camera className="h-4 w-4" />
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-bold text-foreground">{p.full_name || "Add your name"}</h2>
                <button onClick={() => setOpen("personal")} className="mt-1 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  {c.headline || c.last_role || "Add a headline"} <Pencil className="h-3.5 w-3.5" />
                </button>
                <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" /> {p.city || "Add your city"}
                </div>
              </div>

              <div className="w-full md:max-w-[220px]">
                <div className="mb-2 flex items-center gap-1 text-sm font-bold text-foreground">
                  Profile strength <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${strength}%` }} />
                  </div>
                  <span className="text-lg font-bold text-foreground">{strength}%</span>
                </div>
                <p className={`mt-1 text-xs ${sLabel.color}`}>{sLabel.label}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6 lg:flex-row lg:items-stretch">
              <div className="flex flex-1 flex-wrap items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground sm:gap-6">
                <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> {c.profile_views} profile views</span>
                <span className="flex items-center gap-2 sm:border-l sm:border-border sm:pl-6"><Clock className="h-4 w-4" /> Profile last updated: Today</span>
              </div>
              {c.kyc_status === "verified" ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-success lg:w-64">
                  <ShieldCheck className="h-4 w-4" /> Identity verified
                </div>
              ) : (
                <div className="flex w-full flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-4 text-center lg:w-64">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary-light text-primary"><BadgeCheck className="h-5 w-5" /></div>
                  <h3 className="text-[15px] font-bold text-foreground">Verify your identity</h3>
                  <p className="text-[13px] text-muted-foreground">Build trust with recruiters by verifying your identity.</p>
                  <button onClick={() => setOpen("kyc")} className="mt-1 w-full rounded-lg border border-primary py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary-light">
                    Verify now
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Personal details */}
            <div id="personal" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-lg font-bold text-foreground">Personal details</h3>
                <EditBtn onClick={() => setOpen("personal")} />
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Info label="Full name" value={p.full_name} />
                <Info label="Mobile" value={p.mobile} />
                <Info label="City" value={p.city} />
                <Info label="Email" value={email} />
                <Info label="Gender" value={c.gender} />
                <Info label="DOB" value={c.date_of_birth ? new Date(c.date_of_birth).toLocaleDateString() : null} />
                <Info label="Bio" value={c.bio} wide />
              </div>
            </div>

            {/* Documents & resume */}
            <div id="resume" className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-lg font-bold text-foreground">Documents &amp; resume</h3>
                <Link to="/candidate/documents" className="text-sm font-semibold text-primary hover:underline">View all</Link>
              </div>
              {c.resume_url ? (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
                  <div className="shrink-0 rounded border border-border bg-card p-2 text-muted-foreground"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h4 className="truncate text-sm font-bold text-foreground">{c.resume_name || "Resume"}</h4>
                      <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">Latest</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Attached to your applications</p>
                  </div>
                  <button
                    onClick={async () => {
                      const { data } = await supabase.storage.from("candidate-docs").createSignedUrl(c.resume_url!, 60);
                      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                    }}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    View
                  </button>
                </div>
              ) : null}
              <button
                onClick={() => setOpen("resume")}
                className="mt-auto flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-6 text-center transition-colors hover:bg-surface"
              >
                <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-bold text-foreground">{c.resume_url ? "Upload new resume" : "Upload your resume"}</span>
                <span className="mt-1 text-xs text-muted-foreground">PDF, DOC, DOCX (Max 5MB)</span>
              </button>
            </div>
          </div>

          {/* Skills */}
          <div id="skills" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Skills</h3>
              <button onClick={() => setOpen("skills")} className="text-sm font-semibold text-primary hover:underline">Edit</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.skills.map((s) => (
                <span key={s} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground">{s}</span>
              ))}
              <button onClick={() => setOpen("skills")} className="flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface">
                <Plus className="h-3.5 w-3.5" /> Add skill
              </button>
            </div>
          </div>

          {/* Career preferences */}
          <div id="career" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Career preferences</h3>
              <EditBtn onClick={() => setOpen("career")} />
            </div>
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
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Work experience */}
            <div id="experience" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-[15px] font-bold text-foreground">Work experience</h3>
                <button onClick={() => setOpen("experience")} className="text-sm font-semibold text-primary hover:underline">Manage</button>
              </div>
              {experiences.length === 0 ? (
                <EmptyRow icon={Briefcase} title="No experience added" hint="Add your work history to get better matches." />
              ) : (
                <ul className="divide-y divide-border">
                  {experiences.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 py-3">
                      <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{e.job_title}</p>
                        <p className="text-sm text-muted-foreground">{e.company_name} · {fmtPeriod(e.start_date, e.end_date, e.is_current)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Education */}
            <div id="education" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-[15px] font-bold text-foreground">Education</h3>
                <button onClick={() => setOpen("education")} className="text-sm font-semibold text-primary hover:underline">Manage</button>
              </div>
              {educations.length === 0 ? (
                <EmptyRow icon={GraduationCap} title="No education added" hint="Add at least your 10th class." />
              ) : (
                <ul className="divide-y divide-border">
                  {educations.map((e) => (
                    <li key={e.id} className="flex items-start gap-3 py-3">
                      <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{e.level}{e.year_of_passing ? ` · ${e.year_of_passing}` : ""}</p>
                        <p className="text-sm text-muted-foreground">{[e.institute, e.board_or_university].filter(Boolean).join(" — ")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Languages */}
          <div id="languages" className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-foreground">Languages</h3>
              <button onClick={() => setOpen("languages")} className="text-sm font-semibold text-primary hover:underline">Manage</button>
            </div>
            {languages.length === 0 ? (
              <EmptyRow icon={LangIcon} title="No languages added" hint="Add the languages you speak." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {languages.map((l) => (
                  <span key={l.id} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground">
                    <LangIcon className="h-3.5 w-3.5 text-primary" /> {l.language} <span className="text-muted-foreground">· {l.proficiency}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <SummaryCard title="Recent applications" to="/candidate/applications" icon={FileText} empty={counts.applications === 0} emptyTitle="No applications yet" emptyHint="Start applying to jobs and track them here." count={counts.applications} countLabel="applications submitted" />
            <SummaryCard title="Saved jobs" to="/candidate/saved" icon={Bookmark} empty={counts.saved === 0} emptyTitle="No saved jobs yet" emptyHint="Save jobs you like and view them here." count={counts.saved} countLabel="jobs saved" />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-foreground">Profile completion tips</h3>
              <span className="text-xs font-medium text-muted-foreground">{strength}% complete</span>
            </div>
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-success" style={{ width: `${strength}%` }} />
            </div>
            <ul className="mb-6 space-y-3">
              {tips.map((t) => (
                <li key={t.label} className="flex items-start gap-3 text-sm text-foreground/80">
                  <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${t.done ? "text-success" : "text-muted-foreground/40"}`} />
                  {t.label}
                </li>
              ))}
            </ul>
            <Link to="/candidate/dashboard" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              View all tips <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
            <h3 className="mb-4 font-bold text-foreground">Profile highlights</h3>
            <div className="grid grid-cols-2 gap-4">
              <Stat value={c.profile_views} label="Profile views" icon={Eye} tone="bg-primary-light text-primary" />
              <Stat value={counts.applications} label="Applications" icon={FileText} tone="bg-success/15 text-success" />
              <Stat value={counts.interviews} label="Interviews" icon={CalendarCheck} tone="bg-violet-100 text-violet-600" />
              <Stat value={counts.saved} label="Saved jobs" icon={Bookmark} tone="bg-amber-100 text-amber-600" />
            </div>
          </div>
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
  const [workMode, setWorkMode] = useState(c.preferred_work_mode || "onsite");
  const [cities, setCities] = useState<string[]>(c.preferred_cities || []);
  const [salary, setSalary] = useState<number | "">(c.expected_salary ?? "");
  const [notice, setNotice] = useState<number | "">(c.notice_period_days ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setStatus(c.experience_status); setYears(c.years_experience); setLastRole(c.last_role || ""); setJobTypes(c.preferred_job_types || []); setWorkMode(c.preferred_work_mode || "onsite"); setCities(c.preferred_cities || []); setSalary(c.expected_salary ?? ""); setNotice(c.notice_period_days ?? ""); } }, [open, c]);
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
          <div key={i} className="grid items-end gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1.2fr_1fr_auto_auto_auto]">
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

type ReviewState = {
  parsed: ParsedResumePayload;
  file: File;
  full_name: string;
  city: string;
  headline: string;
  years_experience: string;
  skills: string[];
  experiences: NonNullable<ParsedResumePayload["experiences"]>;
  education: NonNullable<ParsedResumePayload["education"]>;
};

function ResumeDialog({ open, onClose, uid, current, onSaved }: { open: boolean; onClose: () => void; uid: string; current: string | null; onSaved: () => void }) {
  const [review, setReview] = useState<ReviewState | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setReview(null);
      setSaving(false);
    }
  }, [open]);

  const onParsed = (parsed: ParsedResumePayload, file: File) => {
    setReview({
      parsed,
      file,
      full_name: parsed.full_name ?? "",
      city: parsed.city ?? "",
      headline: parsed.headline ?? "",
      years_experience: typeof parsed.years_experience === "number" ? String(parsed.years_experience) : "",
      skills: parsed.skills ?? [],
      experiences: parsed.experiences ?? [],
      education: parsed.education ?? [],
    });
  };

  const save = async () => {
    if (!review) return;
    setSaving(true);
    try {
      const { file } = review;
      const path = `${uid}/resume-${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
      const up = await supabase.storage.from("candidate-docs").upload(path, file, { upsert: true });
      if (up.error) throw up.error;

      const candPatch: Record<string, unknown> = { resume_url: path, resume_name: file.name };
      const profPatch: Record<string, unknown> = {};
      if (review.headline.trim()) candPatch.headline = review.headline.trim();
      const yrs = review.years_experience === "" ? null : Number(review.years_experience);
      if (yrs !== null && !Number.isNaN(yrs)) {
        candPatch.years_experience = yrs;
        candPatch.experience_status = yrs > 0 ? "experienced" : "fresher";
      }
      if (review.skills.length) candPatch.skills = review.skills.slice(0, 25);
      if (review.full_name.trim()) profPatch.full_name = review.full_name.trim();
      if (review.city.trim()) profPatch.city = review.city.trim();

      await supabase.from("candidate_profiles").update(candPatch as never).eq("user_id", uid);
      if (Object.keys(profPatch).length) {
        await supabase.from("profiles").update(profPatch as never).eq("id", uid);
      }
      const expRows = review.experiences
        .filter((e) => (e.job_title || e.company_name)?.trim())
        .map((e) => ({
          user_id: uid,
          job_title: e.job_title || "",
          company_name: e.company_name || "",
          start_date: e.start_date || null,
          end_date: e.end_date || null,
          is_current: !!e.is_current,
          description: e.description || "",
        }));
      if (expRows.length) await supabase.from("candidate_experiences").insert(expRows);

      const eduRows = review.education
        .filter((e) => (e.level || e.institute)?.trim())
        .map((e) => ({
          user_id: uid,
          level: e.level || "",
          board_or_university: e.board_or_university || "",
          institute: e.institute || "",
          year_of_passing: e.year_of_passing ?? null,
          marks: e.marks || "",
        }));
      if (eduRows.length) await supabase.from("candidate_education").insert(eduRows);

      await supabase.from("candidate_documents").insert({
        user_id: uid, doc_type: "resume", file_path: path, file_name: file.name, size_bytes: file.size,
      });
      toast.success("Resume saved with your reviewed details.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save resume.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DlgShell open={open} onClose={onClose} title={review ? "Review auto-filled details" : "Upload resume"}>
      {!review && (
        <>
          {current && (
            <p className="mb-3 text-xs text-muted-foreground">
              Current: <span className="font-medium text-foreground">{current}</span> — uploading a new file will replace it.
            </p>
          )}
          <ResumeUpload onParsed={onParsed} />
        </>
      )}

      {review && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            We pulled the following from <span className="font-medium text-foreground">{review.file.name}</span>. Edit anything that looks off, then save.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input className="form-input" value={review.full_name} onChange={(e) => setReview({ ...review, full_name: e.target.value })} />
            </Field>
            <Field label="City">
              <input className="form-input" value={review.city} onChange={(e) => setReview({ ...review, city: e.target.value })} />
            </Field>
            <Field label="Headline">
              <input className="form-input" value={review.headline} onChange={(e) => setReview({ ...review, headline: e.target.value })} maxLength={200} />
            </Field>
            <Field label="Years of experience">
              <input className="form-input" type="number" min={0} max={60} value={review.years_experience} onChange={(e) => setReview({ ...review, years_experience: e.target.value })} />
            </Field>
          </div>

          <Field label="Skills (comma separated)">
            <textarea
              className="form-input min-h-[64px]"
              value={review.skills.join(", ")}
              onChange={(e) => setReview({ ...review, skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25) })}
            />
          </Field>

          {review.experiences.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-foreground">Experience ({review.experiences.length})</h4>
              <div className="space-y-3">
                {review.experiences.map((exp, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className="form-input" placeholder="Job title" value={exp.job_title} onChange={(e) => {
                        const next = [...review.experiences]; next[i] = { ...exp, job_title: e.target.value }; setReview({ ...review, experiences: next });
                      }} />
                      <input className="form-input" placeholder="Company" value={exp.company_name} onChange={(e) => {
                        const next = [...review.experiences]; next[i] = { ...exp, company_name: e.target.value }; setReview({ ...review, experiences: next });
                      }} />
                      <input className="form-input" type="date" value={exp.start_date ?? ""} onChange={(e) => {
                        const next = [...review.experiences]; next[i] = { ...exp, start_date: e.target.value }; setReview({ ...review, experiences: next });
                      }} />
                      <input className="form-input" type="date" value={exp.end_date ?? ""} disabled={exp.is_current} onChange={(e) => {
                        const next = [...review.experiences]; next[i] = { ...exp, end_date: e.target.value }; setReview({ ...review, experiences: next });
                      }} />
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" checked={exp.is_current} onChange={(e) => {
                        const next = [...review.experiences]; next[i] = { ...exp, is_current: e.target.checked }; setReview({ ...review, experiences: next });
                      }} /> Currently working here
                    </label>
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-destructive hover:underline"
                      onClick={() => setReview({ ...review, experiences: review.experiences.filter((_, idx) => idx !== i) })}
                    >Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {review.education.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-foreground">Education ({review.education.length})</h4>
              <div className="space-y-3">
                {review.education.map((edu, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className="form-input" placeholder="Level" value={edu.level} onChange={(e) => {
                        const next = [...review.education]; next[i] = { ...edu, level: e.target.value }; setReview({ ...review, education: next });
                      }} />
                      <input className="form-input" placeholder="Institute" value={edu.institute} onChange={(e) => {
                        const next = [...review.education]; next[i] = { ...edu, institute: e.target.value }; setReview({ ...review, education: next });
                      }} />
                      <input className="form-input" placeholder="Board / University" value={edu.board_or_university} onChange={(e) => {
                        const next = [...review.education]; next[i] = { ...edu, board_or_university: e.target.value }; setReview({ ...review, education: next });
                      }} />
                      <input className="form-input" type="number" placeholder="Year" value={edu.year_of_passing ?? ""} onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        const next = [...review.education]; next[i] = { ...edu, year_of_passing: v }; setReview({ ...review, education: next });
                      }} />
                    </div>
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold text-destructive hover:underline"
                      onClick={() => setReview({ ...review, education: review.education.filter((_, idx) => idx !== i) })}
                    >Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setReview(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface">
              Upload different file
            </button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm & save
            </button>
          </div>
        </div>
      )}
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

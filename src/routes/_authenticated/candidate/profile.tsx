import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/profile")({
  head: () => ({ meta: [{ title: "My Profile · JobsKart" }] }),
  component: ProfilePage,
});

const EXPERIENCE_STATUSES = ["fresher", "experienced"] as const;
const JOB_TYPE_OPTIONS = ["full_time", "part_time", "contract", "internship", "temporary"] as const;
const JOB_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

function ProfilePage() {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [city, setCity] = useState("");

  const [experienceStatus, setExperienceStatus] = useState<"fresher" | "experienced">("fresher");
  const [yearsExperience, setYearsExperience] = useState<number>(0);
  const [lastRole, setLastRole] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [preferredJobTypes, setPreferredJobTypes] = useState<string[]>(["full_time"]);

  const [strength, setStrength] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const u = sess.session?.user.id;
      if (!u) return;
      setUid(u);

      const [{ data: profile }, { data: cand }] = await Promise.all([
        supabase.from("profiles").select("full_name, mobile, city").eq("id", u).maybeSingle(),
        supabase.from("candidate_profiles").select("*").eq("user_id", u).maybeSingle(),
      ]);

      setFullName(profile?.full_name || "");
      setMobile(profile?.mobile || "");
      setCity(profile?.city || "");

      if (cand) {
        setExperienceStatus(cand.experience_status);
        setYearsExperience(cand.years_experience || 0);
        setLastRole(cand.last_role || "");
        setBio(cand.bio || "");
        setSkills(cand.skills || []);
        setPreferredJobTypes(cand.preferred_job_types?.length ? cand.preferred_job_types : ["full_time"]);
        setStrength(cand.profile_strength || 0);
      }
      setLoading(false);
    })();
  }, []);

  const addSkill = () => {
    const v = skillInput.trim();
    if (!v) return;
    if (skills.includes(v)) return;
    setSkills([...skills, v]);
    setSkillInput("");
  };

  const removeSkill = (s: string) => setSkills(skills.filter((x) => x !== s));

  const togglePref = (t: string) =>
    setPreferredJobTypes(preferredJobTypes.includes(t) ? preferredJobTypes.filter((x) => x !== t) : [...preferredJobTypes, t]);

  const save = async () => {
    if (!uid) return;
    setSaving(true);
    let s = 25;
    if (fullName) s += 10;
    if (mobile) s += 10;
    if (city) s += 10;
    if (lastRole) s += 15;
    if (skills.length) s += 20;
    if (yearsExperience > 0) s += 5;
    if (bio) s += 5;
    s = Math.min(s, 100);
    setStrength(s);

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from("profiles").update({ full_name: fullName, mobile, city }).eq("id", uid),
      supabase.from("candidate_profiles").upsert(
        {
          user_id: uid,
          experience_status: experienceStatus,
          years_experience: yearsExperience,
          last_role: lastRole || null,
          bio: bio || null,
          skills,
          preferred_job_types: preferredJobTypes,
          profile_strength: s,
        },
        { onConflict: "user_id" },
      ),
    ]);
    setSaving(false);
    if (e1 || e2) {
      toast.error((e1 || e2)!.message);
      return;
    }
    toast.success("Profile updated");
  };

  if (loading) {
    return (
      <CandidateShell title="My profile">
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </CandidateShell>
    );
  }

  return (
    <CandidateShell title="My profile" subtitle="Complete profiles get 3× more responses from employers.">
      <div className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Profile strength</p>
          <span className="text-sm font-bold text-primary">{strength}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all" style={{ width: `${strength}%` }} />
        </div>
      </div>

      <div className="grid gap-5">
        <Section title="Basic details">
          <Field label="Full name">
            <input className="form-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Mobile">
            <input className="form-input" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Field label="City">
            <input className="form-input" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
        </Section>

        <Section title="Experience">
          <Field label="I am">
            <div className="flex gap-2">
              {EXPERIENCE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setExperienceStatus(s)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                    experienceStatus === s ? "border-primary bg-primary-light text-primary" : "border-border text-foreground/70"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
          {experienceStatus === "experienced" && (
            <>
              <Field label="Years of experience">
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  max={50}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(Number(e.target.value))}
                />
              </Field>
              <Field label="Most recent role">
                <input className="form-input" value={lastRole} onChange={(e) => setLastRole(e.target.value)} placeholder="e.g. Delivery Executive at BlueCart" />
              </Field>
            </>
          )}
          <Field label="Short bio">
            <textarea
              className="form-input min-h-[100px] resize-y py-2"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell employers about yourself in a few lines…"
            />
          </Field>
        </Section>

        <Section title="Skills">
          <div className="flex gap-2">
            <input
              className="form-input"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Type a skill and press Enter"
            />
            <button onClick={addSkill} type="button" className="inline-flex h-11 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-surface">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          {skills.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary-light px-3 py-1 text-sm font-medium text-primary">
                  {s}
                  <button type="button" onClick={() => removeSkill(s)} className="rounded-full p-0.5 hover:bg-primary/10">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="Job preferences">
          <Field label="Preferred job types">
            <div className="flex flex-wrap gap-2">
              {JOB_TYPE_OPTIONS.map((t) => {
                const on = preferredJobTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => togglePref(t)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      on ? "border-primary bg-primary-light text-primary" : "border-border text-foreground/70 hover:bg-surface"
                    }`}
                  >
                    {JOB_TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </Field>
        </Section>

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
        </div>
      </div>
    </CandidateShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
      <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

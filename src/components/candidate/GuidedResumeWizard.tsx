import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { RichTextField } from "@/components/candidate/RichTextField";
import { Chip } from "@/components/candidate/primitives";
import {
  CATEGORY_EXTRA_SECTIONS,
  RESUME_ROLES,
  ROLE_CATEGORY_LABELS,
  getRole,
  type RoleCategory,
} from "@/lib/resumeBuilder/templates/roleTemplates";
import { RESUME_TEMPLATE_LIST } from "@/lib/resumeBuilder/templates/registry";
import type { ResumeCheckItem } from "@/lib/resumeBuilder/validateResume";
import type {
  CertificationItem,
  EducationItem,
  ExperienceItem,
  ResumeExtras,
  ResumeSchema,
} from "@/lib/resumeBuilder/schema";

const newId = () => Math.random().toString(36).slice(2, 10);
const input = "form-input h-9 py-0 text-sm";

const STEPS = [
  "Role & template",
  "Personal details",
  "Education",
  "Experience",
  "Skills & licences",
  "Preview",
  "Save & download",
] as const;

// Short guidance per step; reopened any time with the "Tips" toggle.
const TIPS: Record<number, string> = {
  0: "Pick the job you are applying for. We recommend a layout for it, and you can switch to any other layout.",
  1: "Your name and contact come from your profile. Add a one or two line summary in your own words, for example: ",
  2: "Education comes from your profile. Freshers: list your highest qualification first. If something is missing, add it on your profile.",
  3: "Describe what you actually did: tasks, tools, results. No experience yet? Just skip this step. The section stays out of your resume.",
  4: "Skills come from your profile. Add licences, certificates and training you really hold. Only fill what applies to you.",
  5: "Check the preview next to this panel. Empty sections are hidden automatically. Use Back to change anything.",
  6: "Save your changes, then generate your resume. Your saved resumes are in Version History, where you can download them again.",
};

interface Props {
  snapshot: ResumeSchema; // profile-derived data
  resume: ResumeSchema; // with the working extras applied
  extras: ResumeExtras;
  setExtras: (value: ResumeExtras) => void;
  selectedTemplate: string;
  onSelectTemplate: (id: string) => void;
  checklist: ResumeCheckItem[];
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onGenerate: () => void;
  generating: boolean;
  editingLabel: string | null;
  lastPdfUrl: string | null;
  onClose: () => void;
  // Mobile only: hide the panel so the preview shows; the page offers a way back.
  peek: boolean;
  onPeek: () => void;
}

export function GuidedResumeWizard({
  snapshot,
  resume,
  extras,
  setExtras,
  selectedTemplate,
  onSelectTemplate,
  checklist,
  isDirty,
  isSaving,
  onSave,
  onGenerate,
  generating,
  editingLabel,
  lastPdfUrl,
  onClose,
  peek,
  onPeek,
}: Props) {
  const [step, setStep] = useState(0);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(true);
  const role = getRole(roleId);
  const category: RoleCategory = role?.category ?? "white";
  const set = (patch: Partial<ResumeExtras>) => setExtras({ ...extras, ...patch });

  const profileSection = <K extends ResumeSchema["sections"][number]["content"]["kind"]>(kind: K) =>
    snapshot.sections.find((s) => s.content.kind === kind);
  const experiences = ((
    profileSection("experience")?.content as { items?: ExperienceItem[] } | undefined
  )?.items ?? []) as ExperienceItem[];
  const educations = ((
    profileSection("education")?.content as { items?: EducationItem[] } | undefined
  )?.items ?? []) as EducationItem[];
  const skills = snapshot.sections.find((s) => s.type === "skills");
  const skillItems = skills?.content.kind === "list" ? skills.content.items : [];

  const certs = extras.certifications ?? [];
  const updateCert = (id: string, patch: Partial<CertificationItem>) =>
    set({ certifications: certs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const customs = extras.customSections ?? [];
  const updateCustom = (id: string, text: string) =>
    set({ customSections: customs.map((c) => (c.id === id ? { ...c, text } : c)) });
  const extraTitles = CATEGORY_EXTRA_SECTIONS[category].filter(
    (t) => !customs.some((c) => c.title.trim().toLowerCase() === t.toLowerCase()),
  );

  const chooseRole = (id: string) => {
    setRoleId(id);
    const r = getRole(id);
    if (r) {
      onSelectTemplate(r.templateId);
      if (!extras.targetJobRole?.trim()) set({ targetJobRole: r.label });
    }
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const isLast = step === STEPS.length - 1;
  const profileLink = (
    <a href="/candidate/profile" className="font-semibold text-primary hover:underline">
      Edit on your profile
    </a>
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex-col bg-card shadow-lg lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[420px] lg:border-l lg:border-border ${peek ? "hidden lg:flex" : "flex"}`}
    >
      {/* Header + progress */}
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">Guided Resume Builder</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close guided builder"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}:{" "}
          <span className="font-medium text-foreground">{STEPS[step]}</span>
        </p>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuenow={step + 1}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg bg-primary/5 p-3 text-xs text-foreground">
          <button
            type="button"
            onClick={() => setShowTips((v) => !v)}
            className="flex w-full items-center gap-1.5 font-semibold text-primary"
          >
            <Lightbulb className="h-3.5 w-3.5" /> {showTips ? "Hide tips" : "Show tips"}
          </button>
          {showTips && (
            <p className="mt-1.5 text-muted-foreground">
              {TIPS[step]}
              {step === 1 && (
                <em>
                  {role
                    ? `“${role.summaryExample}”`
                    : "“Reliable team member with … years of experience in …”"}
                </em>
              )}
            </p>
          )}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            {(Object.keys(ROLE_CATEGORY_LABELS) as RoleCategory[]).map((cat) => (
              <div key={cat}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ROLE_CATEGORY_LABELS[cat]}
                </p>
                <div className="flex flex-wrap gap-2">
                  {RESUME_ROLES.filter((r) => r.category === cat).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => chooseRole(r.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        roleId === r.id
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:border-primary/40"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Template
              </p>
              <div className="space-y-2">
                {RESUME_TEMPLATE_LIST.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTemplate(t.id)}
                    className={`relative w-full rounded-xl border-2 p-3 text-left transition-all ${
                      selectedTemplate === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/40"
                    }`}
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {t.label}
                      {role?.templateId === t.id && (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                          Recommended
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    {selectedTemplate === t.id && (
                      <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold text-foreground">
                {resume.candidateName || "Name not set"}
              </p>
              <p className="text-xs text-muted-foreground">
                {[resume.contact?.mobile, resume.contact?.email, resume.contact?.city]
                  .filter(Boolean)
                  .join("  ·  ") || "No contact details yet"}
              </p>
              <p className="mt-2 text-xs">{profileLink}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Target role</p>
              <input
                className={input}
                value={extras.targetJobRole ?? ""}
                onChange={(e) => set({ targetJobRole: e.target.value })}
                placeholder="e.g. Delivery Executive"
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Summary</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Optional. Leave empty to use the bio from your profile.
              </p>
              <RichTextField
                value={extras.summary ?? ""}
                onChange={(v) => set({ summary: v })}
                suggestionKind="summaries"
                placeholder={role?.summaryExample ?? "A short introduction about you"}
              />
            </div>
          </div>
        )}

        {step === 2 &&
          (educations.length > 0 ? (
            <div className="space-y-2">
              {educations.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-semibold text-foreground">{e.degree || "Education"}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.institution, e.fieldOfStudy].filter(Boolean).join("  ·  ")}
                  </p>
                </div>
              ))}
              <p className="text-xs">{profileLink}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No education on your profile yet. {profileLink} or skip, and the section will stay out
              of your resume.
            </p>
          ))}

        {step === 3 &&
          (experiences.length > 0 ? (
            <div className="space-y-3">
              {experiences.map((exp) => (
                <div key={exp.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {exp.position}
                    {exp.company ? ` — ${exp.company}` : ""}
                  </p>
                  <RichTextField
                    value={extras.experienceOverrides?.[exp.id] ?? exp.description ?? ""}
                    onChange={(v) =>
                      set({
                        experienceOverrides: { ...(extras.experienceOverrides ?? {}), [exp.id]: v },
                      })
                    }
                    rows={3}
                    suggestionKind="bullets"
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                This rewrites how each job reads on this resume only. {profileLink} to add or remove
                jobs.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No work experience on your profile. If you are a fresher, skip this step. Otherwise{" "}
              {profileLink}.
            </p>
          ))}

        {step === 4 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Skills</p>
              {skillItems.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {skillItems.map((s) => (
                    <Chip key={s} label={s} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No skills on your profile yet.</p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {role ? `Think about: ${role.skillHint}. ` : ""}
                {profileLink}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground">
                {category === "blue" ? "Licences & certificates" : "Certifications & training"}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                {category === "blue"
                  ? "For example a driving licence type, security guard certificate or trade licence. Only what you hold."
                  : "Only used in this resume. Not added to your profile."}
              </p>
              <div className="space-y-2">
                {certs.map((c) => (
                  <div key={c.id} className="grid grid-cols-[1fr_1fr_70px_auto] items-center gap-2">
                    <input
                      className={input}
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) => updateCert(c.id, { name: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder="Issued by"
                      value={c.issuingOrganization ?? ""}
                      onChange={(e) => updateCert(c.id, { issuingOrganization: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder="Year"
                      maxLength={4}
                      value={c.issueDate ?? ""}
                      onChange={(e) =>
                        updateCert(c.id, { issueDate: e.target.value.replace(/\D/g, "") })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => set({ certifications: certs.filter((x) => x.id !== c.id) })}
                      className="rounded p-1.5 text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => set({ certifications: [...certs, { id: newId(), name: "" }] })}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  <Plus className="h-3.5 w-3.5" /> Add{" "}
                  {category === "blue" ? "licence" : "certification"}
                </button>
              </div>
            </div>

            {(customs.length > 0 || extraTitles.length > 0) && (
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {category === "white" ? "Projects & achievements" : "Tools & training"}
                </p>
                <div className="mt-2 space-y-3">
                  {customs.map((c) => (
                    <div key={c.id}>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {c.title || "Custom section"}
                      </p>
                      <RichTextField
                        value={c.text}
                        onChange={(v) => updateCustom(c.id, v)}
                        rows={3}
                        suggestionKind="bullets"
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {extraTitles.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          set({ customSections: [...customs, { id: newId(), title: t, text: "" }] })
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-semibold text-primary"
                      >
                        <Plus className="h-3 w-3" /> {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Layout in use:{" "}
              <span className="font-semibold text-foreground">
                {RESUME_TEMPLATE_LIST.find((t) => t.id === selectedTemplate)?.label}
              </span>
              . Switch it in step 1 if you prefer another.
            </p>
            <button
              type="button"
              onClick={onPeek}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface lg:hidden"
            >
              View preview
            </button>
            {checklist.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" /> Your resume looks complete.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {checklist.map((item) => (
                  <li key={item.key} className="text-xs text-muted-foreground">
                    • {item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty || isSaving}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-semibold text-foreground hover:bg-surface disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isDirty ? "1. Save changes" : "1. Changes saved"}
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating || isDirty}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {editingLabel ? `2. Update ${editingLabel}` : "2. Generate & Save Resume"}
            </button>
            {lastPdfUrl && (
              <a
                href={lastPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-semibold text-foreground hover:bg-surface"
              >
                <Download className="h-4 w-4" /> Download Last PDF
              </a>
            )}
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="flex items-center justify-between gap-2 border-t border-border p-3">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-surface disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        {!isLast ? (
          <div className="flex items-center gap-2">
            {step > 0 && step < 5 && (
              <button
                type="button"
                onClick={next}
                className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}

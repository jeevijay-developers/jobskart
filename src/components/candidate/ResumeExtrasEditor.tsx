import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ChipInput } from "@/components/candidate/primitives";
import { RichTextField } from "@/components/candidate/RichTextField";
import type { CertificationItem, ExperienceItem, ResumeExtras, TextAlign } from "@/lib/resumeBuilder/schema";

const newId = () => Math.random().toString(36).slice(2, 10);
const input = "form-input h-9 py-0 text-sm";

function Block({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function ResumeExtrasEditor({
  extras,
  onChange,
  experiences,
  sections,
}: {
  extras: ResumeExtras;
  onChange: (next: ResumeExtras) => void;
  experiences: ExperienceItem[];
  // Current sections in display order (including unsaved edits) — drives the order list.
  sections: { id: string; title: string }[];
}) {
  const set = (patch: Partial<ResumeExtras>) => onChange({ ...extras, ...patch });
  const snippets = extras.snippets ?? [];
  const saveSnippet = (text: string) => {
    if (snippets.includes(text)) return;
    set({ snippets: [...snippets, text].slice(-30) });
  };

  const certs = extras.certifications ?? [];
  const updateCert = (id: string, patch: Partial<CertificationItem>) =>
    set({ certifications: certs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const customs = extras.customSections ?? [];
  const updateCustom = (id: string, patch: Partial<{ title: string; text: string; align: TextAlign }>) =>
    set({ customSections: customs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((x) => x.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    set({ sectionOrder: ids });
  };

  return (
    <div className="space-y-6">
      {sections.length > 1 && (
        <Block title="Section order" hint="Move sections up or down to change the order they appear on your resume.">
          <ul className="space-y-1">
            {sections.map((sec, i) => (
              <li key={sec.id} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{sec.title}</span>
                <button
                  type="button"
                  onClick={() => moveSection(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  className="rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(i, 1)}
                  disabled={i === sections.length - 1}
                  title="Move down"
                  className="rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block id="rb-summary" title="Summary" hint="A 2–3 line introduction. Leave empty to use the bio from your profile.">
        <RichTextField
          value={extras.summary ?? ""}
          onChange={(v) => set({ summary: v })}
          suggestionKind="summaries"
          snippets={snippets}
          onSaveSnippet={saveSnippet}
          placeholder="e.g. Reliable warehouse associate with 3 years of experience…"
        />
      </Block>

      <Block title="Target role" hint="Shown to tailor your resume, e.g. “Delivery Executive”.">
        <input className={input} value={extras.targetJobRole ?? ""} onChange={(e) => set({ targetJobRole: e.target.value })} />
      </Block>

      <Block id="rb-certifications" title="Certifications & courses" hint="Only used in this resume — not added to your profile.">
        <div className="space-y-2">
          {certs.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_1fr_90px_auto] items-center gap-2">
              <input className={input} placeholder="Name" value={c.name} onChange={(e) => updateCert(c.id, { name: e.target.value })} />
              <input className={input} placeholder="Issued by" value={c.issuingOrganization ?? ""} onChange={(e) => updateCert(c.id, { issuingOrganization: e.target.value })} />
              <input className={input} placeholder="Year" maxLength={4} value={c.issueDate ?? ""} onChange={(e) => updateCert(c.id, { issueDate: e.target.value.replace(/\D/g, "") })} />
              <button type="button" onClick={() => set({ certifications: certs.filter((x) => x.id !== c.id) })} className="rounded p-1.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ certifications: [...certs, { id: newId(), name: "" }] })}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add certification
          </button>
        </div>
      </Block>

      <Block id="rb-hobbies" title="Hobbies & interests">
        <ChipInput
          values={extras.hobbies ?? []}
          onChange={(v) => set({ hobbies: v })}
          placeholder="Type a hobby and press Enter"
          suggestions={["Cricket", "Reading", "Cooking", "Travelling", "Music", "Volunteering"]}
          max={10}
        />
      </Block>

      <Block title="Custom sections" hint="Add anything else: achievements, projects, awards, availability…">
        <div className="space-y-3">
          {customs.map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <input className={input} placeholder="Section title (e.g. Achievements)" value={c.title} onChange={(e) => updateCustom(c.id, { title: e.target.value })} />
                <button type="button" onClick={() => set({ customSections: customs.filter((x) => x.id !== c.id) })} className="rounded p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <RichTextField
                value={c.text}
                onChange={(v) => updateCustom(c.id, { text: v })}
                rows={3}
                suggestionKind="bullets"
                snippets={snippets}
                onSaveSnippet={saveSnippet}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Text alignment</span>
                <div className="inline-flex overflow-hidden rounded-lg border border-border">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => updateCustom(c.id, { align: a })}
                      className={`px-2.5 py-1 text-xs font-medium capitalize ${
                        (c.align ?? "left") === a ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-surface"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ customSections: [...customs, { id: newId(), title: "", text: "" }] })}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Add section
          </button>
        </div>
      </Block>

      {experiences.length > 0 && (
        <Block title="Polish your experience" hint="Rewrite how each job reads on this resume. Your profile is not changed.">
          <div className="space-y-3">
            {experiences.map((exp) => (
              <div key={exp.id}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {exp.position}{exp.company ? ` — ${exp.company}` : ""}
                </p>
                <RichTextField
                  value={extras.experienceOverrides?.[exp.id] ?? exp.description ?? ""}
                  onChange={(v) => set({ experienceOverrides: { ...(extras.experienceOverrides ?? {}), [exp.id]: v } })}
                  rows={3}
                  suggestionKind="bullets"
                  snippets={snippets}
                  onSaveSnippet={saveSnippet}
                />
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}

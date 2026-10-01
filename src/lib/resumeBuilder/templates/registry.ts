// Single source of truth for which component renders which templateId —
// imported by both the client-side live preview (PDFViewer) and the
// server-side PDF generator, so "preview" and "download" are always the
// exact same render, not two independently maintained layouts.
import type { ComponentType } from "react";
import type { ResumeSchema } from "../schema";
import { ClassicAtsResume } from "./classicAts";
import { ModernResume } from "./modern";

export type ResumeTemplateComponent = ComponentType<{ resume: ResumeSchema }>;

export const RESUME_TEMPLATES: Record<string, ResumeTemplateComponent> = {
  "classic-ats": ClassicAtsResume,
  modern: ModernResume,
};

export const RESUME_TEMPLATE_LIST = [
  { id: "classic-ats", label: "Classic ATS", description: "Clean, single-column, widely accepted" },
  { id: "modern", label: "Modern", description: "Same ATS-safe structure with a subtle accent header" },
] as const;

export function getResumeTemplate(templateId: string): ResumeTemplateComponent {
  return RESUME_TEMPLATES[templateId] ?? RESUME_TEMPLATES["classic-ats"];
}

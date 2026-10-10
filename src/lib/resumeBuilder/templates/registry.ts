// Single source of truth for which component renders which templateId —
// imported by both the client-side live preview (PDFViewer) and the
// server-side PDF generator, so "preview" and "download" are always the
// exact same render, not two independently maintained layouts.
import type { ComponentType } from "react";
import type { ResumeSchema } from "../schema";
import { ClassicAtsResume } from "./classicAts";
import { ModernResume } from "./modern";
import { PracticalResume, ProfessionalResume, TechnicalResume } from "./roleResume";

export type ResumeTemplateComponent = ComponentType<{ resume: ResumeSchema }>;

export const RESUME_TEMPLATES: Record<string, ResumeTemplateComponent> = {
  "classic-ats": ClassicAtsResume,
  modern: ModernResume,
  professional: ProfessionalResume,
  practical: PracticalResume,
  technical: TechnicalResume,
};

export const RESUME_TEMPLATE_LIST = [
  { id: "classic-ats", label: "Classic ATS", description: "Clean, single-column, widely accepted" },
  { id: "modern", label: "Modern", description: "Same ATS-safe structure with a subtle accent header" },
  { id: "professional", label: "Professional", description: "White-collar: education, projects and achievements first" },
  { id: "practical", label: "Practical", description: "Blue-collar: key skills, licences and experience first" },
  { id: "technical", label: "Technical", description: "Grey-collar: technical skills, tools and training first" },
] as const;

export function getResumeTemplate(templateId: string): ResumeTemplateComponent {
  return RESUME_TEMPLATES[templateId] ?? RESUME_TEMPLATES["classic-ats"];
}

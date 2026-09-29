// src/lib/resumeBuilder/validateResume.ts
import type { ResumeSchema } from './schema';

/**
 * Validate a resume snapshot and return an array of warning messages.
 * Returns empty array if resume passes basic validation.
 */
export function validateResume(resume: ResumeSchema): string[] {
  const warnings: string[] = [];

  if (!resume.title || resume.title.trim() === '') {
    warnings.push('Resume title is missing');
  }

  const hasSummary = resume.sections.some(sec => sec.type === 'summary');
  if (!hasSummary) {
    warnings.push('Consider adding a summary section');
  }

  const hasSkills = resume.sections.some(sec => sec.type === 'skills');
  if (!hasSkills) {
    warnings.push('Consider adding a skills section');
  }

  const hasExperience = resume.sections.some(sec => sec.type === 'experience');
  if (!hasExperience) {
    warnings.push('No experience section found');
  }

  const hasEducation = resume.sections.some(sec => sec.type === 'education');
  if (!hasEducation) {
    warnings.push('No education section found');
  }

  // Check for excessively long sections? Not needed.

  return warnings;
}
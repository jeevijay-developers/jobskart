// src/lib/resumeBuilder/validateResume.ts
import type { ResumeSchema } from './schema';

export interface ResumeCheckItem {
  key: string;
  message: string;
  // Where the candidate can fix it: inside the builder panel, or on their
  // Profile (data that is derived from it: skills, experience, education…).
  fix: 'builder' | 'profile';
  anchor?: string; // builder field id to scroll to
  severity: 'required' | 'recommended';
}

/**
 * Completeness checklist for a resume (with builder extras already applied).
 * Empty array means nothing is missing.
 */
export function validateResume(resume: ResumeSchema): ResumeCheckItem[] {
  const items: ResumeCheckItem[] = [];
  const has = (type: string) => resume.sections.some((s) => s.type === type);

  if (!resume.candidateName?.trim()) {
    items.push({ key: 'name', message: 'Add your full name on your Profile', fix: 'profile', severity: 'required' });
  }
  if (!resume.contact?.mobile && !resume.contact?.email) {
    items.push({ key: 'contact', message: 'Add a phone number or email so recruiters can reach you', fix: 'profile', severity: 'required' });
  }
  if (!has('summary')) {
    items.push({ key: 'summary', message: 'Write a short summary about yourself', fix: 'builder', anchor: 'rb-summary', severity: 'required' });
  }
  if (!has('skills')) {
    items.push({ key: 'skills', message: 'Add your skills on your Profile', fix: 'profile', severity: 'required' });
  }
  if (!has('experience')) {
    items.push({ key: 'experience', message: 'Add work experience on your Profile (skip if you are a fresher)', fix: 'profile', severity: 'recommended' });
  }
  if (!has('education')) {
    items.push({ key: 'education', message: 'Add your education on your Profile', fix: 'profile', severity: 'required' });
  }
  if (!has('certifications')) {
    items.push({ key: 'certifications', message: 'Add any certifications or training courses', fix: 'builder', anchor: 'rb-certifications', severity: 'recommended' });
  }
  if (!resume.sections.some((s) => s.id === 'hobbies')) {
    items.push({ key: 'hobbies', message: 'Add hobbies or interests', fix: 'builder', anchor: 'rb-hobbies', severity: 'recommended' });
  }
  return items;
}

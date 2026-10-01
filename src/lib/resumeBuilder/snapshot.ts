// src/lib/resumeBuilder/snapshot.ts
import { ResumeSchema, ResumeExtras, ResumeSection, ResumeSectionContent, ExperienceItem, EducationItem, CertificationItem, LinkItem } from './schema';
import type { CandidateProfile, CandidateExperience, CandidateEducation, CandidateCertification, CandidateLanguage, CandidateLink } from './types';

/**
 * Build a resume snapshot from a candidate profile with optional relations.
 * This function maps the raw database columns to the structured resume format
 * used by the template and PDF renderer.
 */
export function buildResumeSnapshot(
  profile: CandidateProfile & {
    experiences?: CandidateExperience[];
    educations?: CandidateEducation[];
    certifications?: CandidateCertification[];
    languages?: CandidateLanguage[];
    links?: CandidateLink[];
  },
  // full_name/mobile/email/city live on `profiles`, not `candidate_profiles` —
  // candidate_profiles has no identity columns of its own. Passed in
  // separately so this function doesn't need to know which table they came from.
  identity: { fullName: string; mobile?: string | null; email?: string | null; city?: string | null },
): ResumeSchema {
  const now = new Date().toISOString();
  const sections: ResumeSection[] = [];

  // Summary section (use bio)
  if (profile.bio) {
    sections.push({
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      content: { kind: 'text', value: profile.bio },
    });
  }

  // Skills section
  if (profile.skills && Array.isArray(profile.skills) && profile.skills.length > 0) {
    sections.push({
      id: 'skills',
      type: 'skills',
      title: 'Skills',
      content: { kind: 'list', items: profile.skills },
    });
  }

  // Experience section
  const experienceItems: ExperienceItem[] = (profile.experiences ?? []).map(exp => ({
    id: exp.id,
    position: exp.job_title ?? '',
    company: exp.company_name ?? '',
    location: '', // not available in candidate_experiences
    startDate: exp.start_date ?? '',
    endDate: exp.end_date ?? '',
    description: exp.description ?? '',
    achievements: [], // highlights not available
  }));
  if (experienceItems.length > 0) {
    sections.push({
      id: 'experience',
      type: 'experience',
      title: 'Experience',
      content: { kind: 'experience', items: experienceItems },
    });
  }

  // Education section
  const educationItems: EducationItem[] = (profile.educations ?? []).map(edu => ({
    id: edu.id,
    institution: edu.institute ?? '',
    degree: edu.level ?? '',
    fieldOfStudy: edu.board_or_university ?? '',
    location: '',
    startDate: '',
    endDate: '',
    description: '',
  }));
  if (educationItems.length > 0) {
    sections.push({
      id: 'education',
      type: 'education',
      title: 'Education',
      content: { kind: 'education', items: educationItems },
    });
  }

  // Certifications section
  const certificationItems: CertificationItem[] = (profile.certifications ?? []).map(cert => ({
    id: cert.id,
    name: cert.name ?? '',
    issuingOrganization: cert.issuing_organization ?? '',
    issueDate: cert.issue_date ?? '',
    expirationDate: cert.expiration_date ?? '',
    credentialId: cert.credential_id ?? '',
    credentialUrl: cert.credential_url ?? '',
  }));
  if (certificationItems.length > 0) {
    sections.push({
      id: 'certifications',
      type: 'certifications',
      title: 'Certifications',
      content: { kind: 'certification', items: certificationItems },
    });
  }

  // Languages section
  const languageItems = (profile.languages ?? []).map(lang => ({
    id: lang.id,
    language: lang.language ?? '',
    proficiency: lang.proficiency ?? '',
  }));
  if (languageItems.length > 0) {
    sections.push({
      id: 'languages',
      type: 'languages',
      title: 'Languages',
      content: { kind: 'list', items: languageItems.map(l => `${l.language}: ${l.proficiency}`) },
    });
  }

  // Links section
  const linkItems: LinkItem[] = (profile.links ?? []).map(link => ({
    id: link.id,
    label: link.label ?? '',
    url: link.url ?? '',
  }));
  if (linkItems.length > 0) {
    sections.push({
      id: 'links',
      type: 'links',
      title: 'Links',
      content: { kind: 'link', items: linkItems },
    });
  }

  // Default template (could be configurable)
  const templateId = 'classic-ats';

  const name = identity.fullName.trim();

  return {
    version: 1,
    userId: profile.user_id,
    title: name ? `${name} — Resume` : 'Resume',
    candidateName: name,
    contact: {
      mobile: identity.mobile ?? undefined,
      email: identity.email ?? undefined,
      city: identity.city ?? undefined,
    },
    targetJobRole: undefined, // not available
    templateId,
    sections,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Merge candidate-authored extras (resume_drafts.extras) into a base snapshot.
 * Pure + browser-safe so the live preview and the server-side version save
 * produce identical sections from identical inputs.
 */
export function applyResumeExtras(base: ResumeSchema, extras: ResumeExtras): ResumeSchema {
  let sections: ResumeSection[] = base.sections.map((s) => ({ ...s }));

  const summaryText = extras.summary?.trim();
  if (summaryText) {
    const summarySection: ResumeSection = {
      id: 'summary',
      type: 'summary',
      title: 'Summary',
      content: { kind: 'text', value: summaryText },
      overridden: true,
    };
    const idx = sections.findIndex((s) => s.type === 'summary');
    if (idx >= 0) sections[idx] = summarySection;
    else sections.unshift(summarySection);
  }

  const overrides = extras.experienceOverrides ?? {};
  sections = sections.map((s) => {
    if (s.content.kind !== 'experience') return s;
    return {
      ...s,
      content: {
        kind: 'experience',
        items: s.content.items.map((item) =>
          overrides[item.id] !== undefined ? { ...item, description: overrides[item.id] } : item,
        ),
      },
    };
  });

  const certs = (extras.certifications ?? []).filter((c) => c.name.trim());
  if (certs.length > 0) {
    const certSection: ResumeSection = {
      id: 'certifications',
      type: 'certifications',
      title: 'Certifications',
      content: { kind: 'certification', items: certs },
    };
    const existing = sections.findIndex((s) => s.type === 'certifications');
    if (existing >= 0) sections[existing] = certSection;
    else {
      const afterEducation = sections.findIndex((s) => s.type === 'education');
      sections.splice(afterEducation >= 0 ? afterEducation + 1 : sections.length, 0, certSection);
    }
  }

  const hobbies = (extras.hobbies ?? []).map((h) => h.trim()).filter(Boolean);
  if (hobbies.length > 0) {
    sections.push({
      id: 'hobbies',
      type: 'custom',
      title: 'Hobbies & Interests',
      content: { kind: 'list', items: hobbies },
    });
  }

  for (const custom of extras.customSections ?? []) {
    if (!custom.title.trim() || !custom.text.trim()) continue;
    sections.push({
      id: `custom-${custom.id}`,
      type: 'custom',
      title: custom.title.trim(),
      content: { kind: 'text', value: custom.text },
    });
  }

  const targetJobRole = extras.targetJobRole?.trim() || base.targetJobRole;
  return { ...base, targetJobRole, sections };
}

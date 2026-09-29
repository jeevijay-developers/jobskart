// src/lib/resumeBuilder/snapshot.ts
import { ResumeSchema, ResumeSection, ResumeSectionContent, ExperienceItem, EducationItem, CertificationItem, LinkItem } from './schema';
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
  }
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
  const languageItems: any = (profile.languages ?? []).map(lang => ({
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

  // Determine name: we don't have name in candidate_profiles; placeholder
  const name = '';

  return {
    version: 1,
    userId: profile.user_id,
    title: `${name} Resume`.trim() || 'Resume',
    targetJobRole: null, // not available
    templateId,
    sections,
    createdAt: now,
    updatedAt: now,
  };
}
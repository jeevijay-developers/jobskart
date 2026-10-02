// src/lib/resumeBuilder/schema.ts
export interface ResumeSchema {
  version: number; // immutable version identifier
  userId: string; // owner
  title: string; // e.g., "Software Engineer Resume"
  candidateName: string; // full name, shown as the resume header — was previously dropped entirely
  contact: ResumeContact;
  targetJobRole?: string; // optional target role for tailoring
  templateId: string; // reference to resume_template_catalog
  layout?: ResumeLayoutSettings; // optional: absent on versions saved before layout controls existed
  sections: ResumeSection[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// Candidate-authored content that has no home on the profile. Stored in
// resume_drafts.extras and merged into the snapshot — never written back to
// candidate_profiles. Free-text fields use the constrained rich-text markup
// parsed by templates/richText.tsx (**bold**, *italic*, "- " bullets).
export interface ResumeExtras {
  summary?: string;
  targetJobRole?: string;
  hobbies?: string[];
  certifications?: CertificationItem[];
  customSections?: { id: string; title: string; text: string; align?: TextAlign }[];
  experienceOverrides?: Record<string, string>;
  snippets?: string[];
  sectionOrder?: string[]; // section ids in display order; unlisted sections keep their natural position
}

export type TextAlign = 'left' | 'center' | 'right';

// LaTeX-style typesetting controls (geometry / enumitem / vspace equivalents),
// stored per resume version next to templateId. Built-in PDF fonts only.
export interface ResumeLayoutSettings {
  marginPreset: 'compact' | 'standard' | 'spacious' | 'custom';
  margins?: { top: number; bottom: number; left: number; right: number }; // pt, used when marginPreset === 'custom'
  fontFamily: 'helvetica' | 'times' | 'courier';
  baseFontSize: number; // pt, all other sizes scale from this
  lineHeightScale: number; // multiplier on every line-height
  sectionSpacingScale: number; // multiplier on gaps between sections and items
  sectionHeaderStyle: 'underline' | 'plain' | 'colored';
  accentColor: string; // #RRGGBB
}

export interface ResumeContact {
  mobile?: string;
  email?: string;
  city?: string;
}

export interface ResumeSection {
  id: string; // stable identifier within document
  type: 'summary' | 'skills' | 'experience' | 'education' | 'certifications' | 'languages' | 'links' | 'custom';
  title: string; // display title
  content: ResumeSectionContent;
  // optional override flag for manual edits
  overridden?: boolean;
  align?: TextAlign; // custom text sections only
}

export type ResumeSectionContent =
  | { kind: 'text'; value: string } // summary, custom
  | { kind: 'list'; items: string[] } // skills, languages
  | { kind: 'experience'; items: ExperienceItem[] }
  | { kind: 'education'; items: EducationItem[] }
  | { kind: 'certification'; items: CertificationItem[] }
  | { kind: 'link'; items: LinkItem[] };

export interface ExperienceItem {
  id: string;
  company: string;
  position: string;
  location?: string;
  startDate: string; // ISO date or year-month
  endDate?: string; // null for present
  description: string; // optional free text
  achievements?: string[]; // bullet points
}

export interface EducationItem {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface CertificationItem {
  id: string;
  name: string;
  issuingOrganization?: string;
  issueDate?: string;
  expirationDate?: string;
  credentialId?: string;
  credentialUrl?: string;
}

export interface LinkItem {
  id: string;
  label: string; // e.g., "LinkedIn", "Portfolio"
  url: string;
}
import { Database } from '../../integrations/supabase/types';

/**
 * Candidate profile shape as stored in the database.
 * For resume builder we use the core fields; relations (experience, education)
 * can be populated separately and added to the snapshot as needed.
 */
 export type CandidateProfile = Database['public']['Tables']['candidate_profiles']['Row'];

/**
 * Extended profile that includes optional relational data for resume building.
 */
 export interface CandidateProfileWithRelations extends CandidateProfile {
  experiences?: CandidateExperience[];
  educations?: CandidateEducation[];
}

/**
 * Experience row from candidate_experiences table.
 */
 export type CandidateExperience = Database['public']['Tables']['candidate_experiences']['Row'];

/**
 * Education row from candidate_education table.
 */
 export type CandidateEducation = Database['public']['Tables']['candidate_education']['Row'];

/**
 * Certification row from candidate_certifications table.
 */
// export type CandidateCertification = Database['public']['Tables']['candidate_certifications']['Row'];
 export type CandidateCertification = {
  id: string;
  name: string | null;
  issuing_organization: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  credential_id: string | null;
  credential_url: string | null;
  user_id: string;
};

/**
 * Language row from candidate_languages table.
 */
 export type CandidateLanguage = Database['public']['Tables']['candidate_languages']['Row'];

/**
 * External link row from candidate_links table.
 */
// export type CandidateLink = Database['public']['Tables']['candidate_links']['Row'];
 export type CandidateLink = {
  id: string;
  label: string | null;
  url: string | null;
  user_id: string;
};
/**
 * Resume version row from resume_versions table.
 */
export interface ResumeVersion {
  id: string;
  user_id: string;
  snapshot: any; // ResumeSchema
  template_id: string;
  version_number: number;
  created_at: string;
}

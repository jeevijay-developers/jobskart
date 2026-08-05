import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchJobs from "./tools/search-jobs";
import getJob from "./tools/get-job";
import myProfile from "./tools/my-profile";
import myApplications from "./tools/my-applications";
import mySavedJobs from "./tools/my-saved-jobs";
import myCompanyJobs from "./tools/my-company-jobs";
import jobApplicants from "./tools/job-applicants";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "jobskart-connect",
  title: "JobsKart Connect",
  version: "0.1.0",
  instructions:
    "Tools for JobsKart, an India-focused job marketplace. Use `search_jobs` and `get_job` for public listings. Signed-in candidates can use `my_profile`, `my_applications` and `my_saved_jobs`; signed-in employers can use `my_profile`, `my_company_jobs` and `job_applicants`. All personal data is scoped to the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchJobs, getJob, myProfile, myApplications, mySavedJobs, myCompanyJobs, jobApplicants],
});

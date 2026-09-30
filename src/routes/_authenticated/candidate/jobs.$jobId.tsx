import { createFileRoute } from "@tanstack/react-router";
import { JobDetailPage } from "@/routes/jobs.$jobId";

// Candidate-section mirror of the public /jobs/$jobId route — same
// UI/data-fetching/Apply-Save-Share logic (JobDetailPage is shared, not
// duplicated), just kept under /candidate/* so a signed-in candidate
// clicking a job from /candidate/browse never leaves the candidate section.
export const Route = createFileRoute("/_authenticated/candidate/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job · JobsKart" }] }),
  component: CandidateJobDetailPage,
});

function CandidateJobDetailPage() {
  const { jobId } = Route.useParams();
  return (
    <JobDetailPage jobId={jobId} basePath="/candidate/jobs" listPath="/candidate/browse" embedded />
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { JobDetailPage } from "@/routes/jobs.$jobId";
import { NotificationContextBanner } from "@/components/candidate/NotificationContextBanner";

// Candidate-section mirror of the public /jobs/$jobId route — same
// UI/data-fetching/Apply-Save-Share logic (JobDetailPage is shared, not
// duplicated), just kept under /candidate/* so a signed-in candidate
// clicking a job from /candidate/browse never leaves the candidate section.
const jobSearchSchema = z.object({
  // Point 16: set when a "candidate.invited_to_apply" notification linked
  // here (see notificationDestination.ts) — shows that notification's
  // title/description/date above the job, Apply button untouched.
  notification: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/candidate/jobs/$jobId")({
  validateSearch: jobSearchSchema,
  head: () => ({ meta: [{ title: "Job · JobsKart" }] }),
  component: CandidateJobDetailPage,
});

function CandidateJobDetailPage() {
  const { jobId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <>
      {search.notification && (
        <div className="mx-auto w-full max-w-none px-4 pt-6 sm:px-6 lg:px-8">
          <NotificationContextBanner
            notificationId={search.notification}
            onDismiss={() =>
              navigate({
                from: Route.fullPath,
                search: (prev: z.infer<typeof jobSearchSchema>) => ({
                  ...prev,
                  notification: undefined,
                }),
                replace: true,
              })
            }
          />
        </div>
      )}
      <JobDetailPage
        jobId={jobId}
        basePath="/candidate/jobs"
        listPath="/candidate/browse"
        embedded
      />
    </>
  );
}

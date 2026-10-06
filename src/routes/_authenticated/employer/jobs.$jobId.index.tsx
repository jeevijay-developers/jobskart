import { createFileRoute } from "@tanstack/react-router";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { JobDetailPage } from "@/routes/jobs.$jobId";

// Job detail opened from the employer Jobs list on desktop: same shared
// JobDetailPage, rendered inside the employer shell so the sidebar stays.
export const Route = createFileRoute("/_authenticated/employer/jobs/$jobId/")({
  head: () => ({ meta: [{ title: "Job · JobsKart" }] }),
  component: EmployerJobDetailPage,
});

function EmployerJobDetailPage() {
  const { jobId } = Route.useParams();
  return (
    <EmployerShell title="Jobs">
      <JobDetailPage
        jobId={jobId}
        basePath="/employer/jobs"
        listPath="/employer/jobs"
        embedded
        employerView
      />
    </EmployerShell>
  );
}

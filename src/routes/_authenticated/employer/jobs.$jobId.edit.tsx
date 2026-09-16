import { createFileRoute } from "@tanstack/react-router";
import { JobWizard } from "@/components/employer/JobWizard";

export const Route = createFileRoute("/_authenticated/employer/jobs/$jobId/edit")({
  head: () => ({ meta: [{ title: "Edit Job · JobsKart" }] }),
  component: EditJobPage,
});

function EditJobPage() {
  const { jobId } = Route.useParams();
  return <JobWizard editJobId={jobId} />;
}

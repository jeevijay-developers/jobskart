import { createFileRoute } from "@tanstack/react-router";
import { JobWizard } from "@/components/employer/JobWizard";

export const Route = createFileRoute("/_authenticated/employer/jobs/new")({
  head: () => ({ meta: [{ title: "Post a Job · JobsKart" }] }),
  component: () => <JobWizard />,
});

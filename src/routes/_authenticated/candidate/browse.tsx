import { createFileRoute } from "@tanstack/react-router";
import { jobsSearchSchema } from "@/lib/jobs-search";
import { JobsList } from "@/routes/jobs";

export const Route = createFileRoute("/_authenticated/candidate/browse")({
  validateSearch: jobsSearchSchema,
  head: () => ({ meta: [{ title: "Browse Jobs · JobsKart" }] }),
  component: CandidateBrowse,
});

function CandidateBrowse() {
  return <JobsList embeddedInCandidateApp />;
}

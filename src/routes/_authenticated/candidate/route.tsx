import { createFileRoute } from "@tanstack/react-router";
import { CandidateAppLayout } from "@/components/candidate/CandidateShell";

export const Route = createFileRoute("/_authenticated/candidate")({
  component: CandidateAppLayout,
});

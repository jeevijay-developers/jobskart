import { createFileRoute } from "@tanstack/react-router";
import { LearnContent } from "@/routes/learn";

export const Route = createFileRoute("/_authenticated/candidate/learning")({
  head: () => ({ meta: [{ title: "Learning & Content · JobsKart" }] }),
  component: () => <LearnContent inCandidate />,
});

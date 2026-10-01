import { createFileRoute } from "@tanstack/react-router";
import { CertificationContent } from "@/routes/learn_.certification.$slug";

export const Route = createFileRoute("/_authenticated/candidate/learning_/certification/$slug")({
  component: CertificationPage,
});

function CertificationPage() {
  const { slug } = Route.useParams();
  return <CertificationContent slug={slug} inCandidate />;
}

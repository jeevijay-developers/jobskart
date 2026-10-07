import { createFileRoute } from "@tanstack/react-router";
import { ExamContent } from "@/routes/learn_.certification.$slug_.exam";

export const Route = createFileRoute("/_authenticated/candidate/learning_/certification/$slug_/exam")({
  component: ExamPage,
});

function ExamPage() {
  const { slug } = Route.useParams();
  return <ExamContent slug={slug} inCandidate />;
}

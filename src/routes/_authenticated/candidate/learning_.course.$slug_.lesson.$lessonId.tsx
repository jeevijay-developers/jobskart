import { createFileRoute } from "@tanstack/react-router";
import { LessonContent } from "@/routes/learn_.course.$slug_.lesson.$lessonId";

export const Route = createFileRoute(
  "/_authenticated/candidate/learning_/course/$slug_/lesson/$lessonId",
)({
  component: LessonPage,
});

function LessonPage() {
  const { slug, lessonId } = Route.useParams();
  return <LessonContent slug={slug} lessonId={lessonId} inCandidate />;
}

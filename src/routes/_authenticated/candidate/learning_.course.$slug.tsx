import { createFileRoute } from "@tanstack/react-router";
import { CourseContent } from "@/routes/learn_.course.$slug";

export const Route = createFileRoute("/_authenticated/candidate/learning_/course/$slug")({
  component: CoursePage,
});

function CoursePage() {
  const { slug } = Route.useParams();
  return <CourseContent slug={slug} inCandidate />;
}

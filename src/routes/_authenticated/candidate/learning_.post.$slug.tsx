import { createFileRoute } from "@tanstack/react-router";
import { PostContent } from "@/routes/learn_.post.$slug";

export const Route = createFileRoute("/_authenticated/candidate/learning_/post/$slug")({
  component: PostPage,
});

function PostPage() {
  const { slug } = Route.useParams();
  return <PostContent slug={slug} inCandidate />;
}

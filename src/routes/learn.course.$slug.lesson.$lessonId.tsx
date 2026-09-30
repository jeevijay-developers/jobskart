import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { useCandidateCheckout } from "@/hooks/use-candidate-checkout";
import { FormattedMarkdown } from "@/lib/markdownLite";
import { createCourseOrder, getLessonContent } from "@/lib/learning.functions";

export const Route = createFileRoute("/learn/course/$slug/lesson/$lessonId")({
  component: LessonPage,
});

type Content = { title: string; kind: string; videoUrl: string | null; bodyMd: string | null };

/** youtube.com/watch?v=, youtu.be/, or vimeo.com/ links → an embeddable iframe URL. */
function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com")) return `https://player.vimeo.com/video${u.pathname}`;
    return null;
  } catch {
    return null;
  }
}

function LessonPage() {
  const { slug, lessonId } = Route.useParams();
  const fetchContent = useServerFn(getLessonContent);
  const createOrder = useServerFn(createCourseOrder);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "locked"; courseId: string }
    | { status: "error"; message: string }
    | { status: "ok"; content: Content }
  >({ status: "loading" });
  // Re-run the same load() the page already uses, instead of a full page reload —
  // matches how the course/certification pages update local state after a
  // purchase rather than reloading (learn.course.$slug.tsx, learn.certification.$slug.tsx).
  const { buying, buy } = useCandidateCheckout(() => {
    void load();
  });

  const load = async () => {
    setState({ status: "loading" });
    try {
      const result = await fetchContent({ data: { lessonId } });
      if (result.unlocked) setState({ status: "ok", content: result });
      else setState({ status: "locked", courseId: result.courseId });
    } catch (e) {
      setState({
        status: "error",
        message: e instanceof Error ? e.message : "Could not load this lesson.",
      });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const handleBuy = () => {
    if (state.status !== "locked") return;
    void buy(() => createOrder({ data: { courseId: state.courseId } }));
  };

  const embed =
    state.status === "ok" && state.content.videoUrl ? toEmbedUrl(state.content.videoUrl) : null;

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          to="/learn/course/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to course
        </Link>

        {state.status === "loading" ? (
          <div className="mt-8 grid place-items-center rounded-xl border border-border bg-card p-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : state.status === "locked" ? (
          <div className="mt-8 rounded-xl border border-border bg-card p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-semibold text-foreground">This lesson is locked</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Buy this course to unlock every lesson.
            </p>
            <button
              onClick={handleBuy}
              disabled={buying}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {buying && <Loader2 className="h-4 w-4 animate-spin" />}
              Buy this course
            </button>
          </div>
        ) : state.status === "error" ? (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {state.message}
          </div>
        ) : (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
              {state.content.title}
            </h1>
            {embed ? (
              <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl border border-border">
                <iframe
                  src={embed}
                  title={state.content.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : state.content.videoUrl ? (
              <a
                href={state.content.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-primary underline"
              >
                Open video
              </a>
            ) : null}
            {state.content.bodyMd && (
              <div className="mt-4">
                <FormattedMarkdown text={state.content.bodyMd} />
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

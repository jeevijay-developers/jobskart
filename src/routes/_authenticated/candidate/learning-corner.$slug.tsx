import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink, Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/candidate/learning-corner/$slug")({
  head: () => ({ meta: [{ title: "Learning corner · JobsKart" }] }),
  component: LearningCornerArticle,
});

type Resource = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  content_url: string;
  kind: string;
  category: string | null;
};

function LearningCornerArticle() {
  const { slug } = Route.useParams();
  const [item, setItem] = useState<Resource | null | "not_found">(null);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    supabase
      .from("learning_resources")
      .select("id, title, description, cover_url, content_url, kind, category")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setItem((data as Resource | null) ?? "not_found");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const isVideo = item !== null && item !== "not_found" && item.kind === "video";

  return (
    <div className="w-full rounded-3xl bg-card p-4 shadow-sm sm:p-8">
      <Link
        to="/candidate/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      {item === null ? (
        <div className="mt-8 grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : item === "not_found" ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          This article isn't available.
        </div>
      ) : (
        <article className="mt-6">
          {item.cover_url && (
            <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface sm:aspect-[3/1]">
              <img
                src={item.cover_url}
                alt=""
                className="absolute inset-0 h-full w-full object-contain object-center"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2.5 py-1 font-semibold text-primary">
              {isVideo ? <PlayCircle className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
              {isVideo ? "Video" : "Article"}
            </span>
            {item.category && (
              <span className="rounded-full bg-surface px-2.5 py-1 font-semibold text-muted-foreground">
                {item.category}
              </span>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {item.title}
          </h1>
          <hr className="mt-6 border-border" />
          {item.description && (
            <p className="mt-6 whitespace-pre-line text-base leading-7 text-foreground/90">
              {item.description}
            </p>
          )}
          <a
            href={item.content_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            {isVideo ? "Watch video" : "Read full article"} <ExternalLink className="h-4 w-4" />
          </a>
        </article>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";
import { FormattedMarkdown } from "@/lib/markdownLite";

export const Route = createFileRoute("/learn_/post/$slug")({
  component: PostPage,
});

type Post = {
  id: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  published_at: string | null;
  content_posts: { body_md: string } | { body_md: string }[] | null;
};

function PostPage() {
  const { slug } = Route.useParams();
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <PostContent slug={slug} />
      </main>
      <Footer />
    </div>
  );
}

/** Detail body, shared by the public page and the candidate dashboard. */
export function PostContent({ slug, inCandidate }: { slug: string; inCandidate?: boolean }) {
  const [post, setPost] = useState<Post | null | "not_found">(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("content_items")
      .select("id, title, excerpt, cover_url, published_at, content_posts(body_md)")
      .eq("slug", slug)
      .eq("content_type", "post")
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPost((data as unknown as Post | null) ?? "not_found");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className={inCandidate ? "w-full rounded-3xl bg-card p-4 shadow-sm sm:p-8" : undefined}>
      <Link
        to={inCandidate ? "/candidate/learning" : "/learn"}
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Learning
      </Link>

      {post === null ? (
        <div className="mt-8 grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : post === "not_found" ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          This article isn't available.
        </div>
      ) : (
        <article className="mt-6">
          {post.cover_url &&
            (inCandidate ? (
              <div className="relative mb-6 aspect-[16/9] w-full sm:aspect-[3/1] overflow-hidden rounded-2xl bg-surface">
                <img
                  src={post.cover_url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain object-center"
                />
              </div>
            ) : (
              <img src={post.cover_url} alt="" className="mb-6 w-full rounded-xl object-cover" />
            ))}
          <h1
            className={
              inCandidate
                ? "text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
                : "text-2xl font-bold text-foreground sm:text-3xl"
            }
          >
            {post.title}
          </h1>
          {inCandidate && post.excerpt && (
            <p className="mt-2 text-lg text-muted-foreground">{post.excerpt}</p>
          )}
          {inCandidate && <hr className="mt-6 border-border" />}
          <div
            className={
              inCandidate
                ? "mt-6 max-w-none [&_li]:text-base [&_li]:leading-7 [&_p]:text-base [&_p]:leading-7"
                : "mt-6 max-w-none"
            }
          >
            <FormattedMarkdown
              text={
                (Array.isArray(post.content_posts) ? post.content_posts[0] : post.content_posts)
                  ?.body_md ?? ""
              }
            />
          </div>
        </article>
      )}
    </div>
  );
}

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
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          to="/learn"
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
            {post.cover_url && (
              <img src={post.cover_url} alt="" className="mb-6 w-full rounded-xl object-cover" />
            )}
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{post.title}</h1>
            <div className="mt-6 max-w-none">
              <FormattedMarkdown
                text={
                  (Array.isArray(post.content_posts) ? post.content_posts[0] : post.content_posts)
                    ?.body_md ?? ""
                }
              />
            </div>
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}

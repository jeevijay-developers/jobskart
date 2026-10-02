import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, GraduationCap, Award } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/learn")({
  head: () => ({
    meta: [
      { title: "Learning & Content · JobsKart" },
      { name: "description", content: "Free career articles, courses and paid certifications." },
    ],
  }),
  component: LearnHub,
});

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
};
type Course = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  courses: { price_inr: number } | { price_inr: number }[] | null;
};
type Cert = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  certifications: { price_inr: number } | { price_inr: number }[] | null;
};

/** Supabase-js types a `to-one` embed as an array; this project's schema makes it 0-or-1. */
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function LearnHub() {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <LearnContent />
      </main>
      <Footer />
    </div>
  );
}

/** Learning hub body, shared by the public /learn page and the candidate dashboard. */
export function LearnContent({ inCandidate }: { inCandidate?: boolean }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [certs, setCerts] = useState<Cert[] | null>(null);

  useEffect(() => {
    supabase
      .from("content_items")
      .select("id, slug, title, excerpt, cover_url")
      .eq("content_type", "post")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .then(({ data }) => setPosts((data ?? []) as Post[]));

    supabase
      .from("content_items")
      .select("id, slug, title, excerpt, cover_url, courses(price_inr)")
      .eq("content_type", "course")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .then(({ data }) => setCourses((data ?? []) as unknown as Course[]));

    supabase
      .from("content_items")
      .select("id, slug, title, excerpt, cover_url, certifications(price_inr)")
      .eq("content_type", "certification")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .then(({ data }) => setCerts((data ?? []) as unknown as Cert[]));
  }, []);

  return (
    <>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Learning &amp; Content</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Free articles and courses to help you get hired, plus paid certifications you can add to
        your profile.
      </p>

      <Tabs defaultValue="posts" className="mt-6 w-full">
        <TabsList
          className={`grid w-full grid-cols-3 ${inCandidate ? "h-auto max-w-2xl rounded-xl bg-card p-1 shadow-sm" : ""}`}
        >
          <TabsTrigger value="posts" className="min-h-11">
            Articles
          </TabsTrigger>
          <TabsTrigger value="courses" className="min-h-11">
            Courses
          </TabsTrigger>
          <TabsTrigger value="certifications" className="min-h-11">
            Certifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-4">
          <CardGrid
            items={posts}
            icon={BookOpen}
            empty="No articles published yet — check back soon."
            kind="post"
            inCandidate={inCandidate}
            linkLabel="Read more"
          />
        </TabsContent>

        <TabsContent value="courses" className="mt-4">
          <CardGrid
            items={courses}
            icon={GraduationCap}
            empty="No courses published yet — check back soon."
            kind="course"
            inCandidate={inCandidate}
            linkLabel="View course"
            badge={(c) => {
              const price = one(c.courses)?.price_inr ?? 0;
              return price > 0 ? `₹${price}` : "Free";
            }}
          />
        </TabsContent>

        <TabsContent value="certifications" className="mt-4">
          <CardGrid
            items={certs}
            icon={Award}
            empty="No certifications published yet — check back soon."
            kind="certification"
            inCandidate={inCandidate}
            linkLabel="View certification"
            badge={(c) => {
              const price = one(c.certifications)?.price_inr ?? 0;
              return price > 0 ? `₹${price}` : "Free";
            }}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

type LearnItemKind = "post" | "course" | "certification";

/**
 * Each branch below uses `to` as a literal, not a value computed and spread from a
 * variable — TanStack Router only validates a route (existence, and the shape of
 * `params`) against the registered route tree for a literal `to`; a `to: string`
 * threaded through a prop or callback loses that checking entirely, silently
 * accepting a typo'd or renamed route. Kept as its own component (not inlined in
 * CardGrid) so each of the three `<Link>` calls stays a real literal.
 */
function ItemLink({
  kind,
  slug,
  className,
  children,
  inCandidate,
}: {
  kind: LearnItemKind;
  slug: string;
  inCandidate?: boolean;
  className: string;
  children: ReactNode;
}) {
  if (inCandidate) {
    if (kind === "post")
      return (
        <Link to="/candidate/learning/post/$slug" params={{ slug }} className={className}>
          {children}
        </Link>
      );
    if (kind === "course")
      return (
        <Link to="/candidate/learning/course/$slug" params={{ slug }} className={className}>
          {children}
        </Link>
      );
    return (
      <Link to="/candidate/learning/certification/$slug" params={{ slug }} className={className}>
        {children}
      </Link>
    );
  }
  if (kind === "post")
    return (
      <Link to="/learn/post/$slug" params={{ slug }} className={className}>
        {children}
      </Link>
    );
  if (kind === "course")
    return (
      <Link to="/learn/course/$slug" params={{ slug }} className={className}>
        {children}
      </Link>
    );
  return (
    <Link to="/learn/certification/$slug" params={{ slug }} className={className}>
      {children}
    </Link>
  );
}

function CardGrid<
  T extends {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    cover_url: string | null;
  },
>({
  items,
  icon: Icon,
  empty,
  kind,
  linkLabel,
  inCandidate,
  badge,
}: {
  items: T[] | null;
  icon: typeof BookOpen;
  empty: string;
  kind: LearnItemKind;
  linkLabel: string;
  inCandidate?: boolean;
  badge?: (item: T) => string;
}) {
  if (items === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading content"
        className={inCandidate ? "grid gap-4 lg:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}
      >
        {Array.from({ length: inCandidate ? 2 : 4 }).map((_, i) => (
          <div
            key={i}
            className={
              inCandidate
                ? "flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
                : "flex flex-col rounded-xl border border-border bg-card p-4"
            }
          >
            <Skeleton
              className={
                inCandidate
                  ? "h-44 w-full shrink-0 rounded-xl sm:h-32 sm:w-64"
                  : "mb-3 h-32 w-full rounded-lg"
              }
            />
            <div
              className={
                inCandidate
                  ? "flex min-w-0 flex-1 flex-col justify-center gap-2"
                  : "flex flex-col gap-2"
              }
            >
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0)
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-light text-primary">
          <Icon className="h-6 w-6" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  return (
    <div className={inCandidate ? "grid gap-4 lg:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
      {items.map((item) => (
        <div
          key={item.id}
          className={
            inCandidate
              ? "flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center"
              : "flex flex-col rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
          }
        >
          {item.cover_url &&
            (inCandidate ? (
              <div className="relative h-44 w-full shrink-0 overflow-hidden rounded-xl bg-surface sm:h-32 sm:w-64">
                <img
                  src={item.cover_url}
                  alt={item.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-contain object-center"
                />
              </div>
            ) : (
              <img
                src={item.cover_url}
                alt={item.title}
                loading="lazy"
                className="mb-3 h-32 w-full rounded-lg object-cover"
              />
            ))}
          <div className={inCandidate ? "flex min-w-0 flex-1 flex-col justify-center" : "contents"}>
            <div className="flex items-start justify-between gap-2">
              <h2
                className={
                  inCandidate
                    ? "text-lg font-bold text-foreground"
                    : "font-semibold text-foreground"
                }
              >
                {item.title}
              </h2>
              {badge && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    badge(item) === "Free"
                      ? "bg-success/15 text-success"
                      : "bg-primary-light text-primary"
                  }`}
                >
                  {badge(item)}
                </span>
              )}
            </div>
            {item.excerpt && (
              <p
                className={
                  inCandidate
                    ? "mt-1.5 line-clamp-2 text-[15px] text-muted-foreground"
                    : "mt-1 line-clamp-2 text-sm text-muted-foreground"
                }
              >
                {item.excerpt}
              </p>
            )}
            <ItemLink
              kind={kind}
              slug={item.slug}
              inCandidate={inCandidate}
              className={
                inCandidate
                  ? "mt-3 inline-flex min-h-11 w-fit items-center rounded-lg text-base font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  : "mt-3 inline-flex min-h-11 w-fit items-center rounded-lg text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              }
            >
              {linkLabel}
            </ItemLink>
          </div>
        </div>
      ))}
    </div>
  );
}

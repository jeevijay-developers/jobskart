import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, GraduationCap, Award, Loader2 } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
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
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Learning &amp; Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Free articles and courses to help you get hired, plus paid certifications you can add to
          your profile.
        </p>

        <Tabs defaultValue="posts" className="mt-6 w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="posts">Articles</TabsTrigger>
            <TabsTrigger value="courses">Courses</TabsTrigger>
            <TabsTrigger value="certifications">Certifications</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-4">
            <CardGrid
              items={posts}
              icon={BookOpen}
              empty="No articles published yet — check back soon."
              kind="post"
              linkLabel="Read more"
            />
          </TabsContent>

          <TabsContent value="courses" className="mt-4">
            <CardGrid
              items={courses}
              icon={GraduationCap}
              empty="No courses published yet — check back soon."
              kind="course"
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
              linkLabel="View certification"
              badge={(c) => {
                const price = one(c.certifications)?.price_inr ?? 0;
                return price > 0 ? `₹${price}` : "Free";
              }}
            />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
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
}: {
  kind: LearnItemKind;
  slug: string;
  className: string;
  children: ReactNode;
}) {
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
  badge,
}: {
  items: T[] | null;
  icon: typeof BookOpen;
  empty: string;
  kind: LearnItemKind;
  linkLabel: string;
  badge?: (item: T) => string;
}) {
  if (items === null)
    return (
      <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  if (items.length === 0)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card p-8 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" /> {empty}
      </div>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
          {item.cover_url && (
            <img src={item.cover_url} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />
          )}
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-foreground">{item.title}</h2>
            {badge && (
              <span className="shrink-0 rounded-full bg-primary-light px-2 py-0.5 text-xs font-bold text-primary">
                {badge(item)}
              </span>
            )}
          </div>
          {item.excerpt && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.excerpt}</p>
          )}
          <ItemLink
            kind={kind}
            slug={item.slug}
            className="mt-3 inline-flex w-fit items-center text-sm font-semibold text-primary hover:underline"
          >
            {linkLabel}
          </ItemLink>
        </div>
      ))}
    </div>
  );
}

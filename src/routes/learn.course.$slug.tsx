import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock, PlayCircle } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/learn/course/$slug")({
  component: CoursePage,
});

type Lesson = {
  id: string;
  title: string;
  position: number;
  duration_minutes: number | null;
  free_preview: boolean | null;
};
type ModuleRow = {
  id: string;
  title: string;
  position: number;
  duration_minutes: number | null;
  free_preview: boolean | null;
  course_lessons: Lesson[] | null;
};
type Course = {
  id: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  course_modules: ModuleRow[] | null;
};

function CoursePage() {
  const { slug } = Route.useParams();
  const [course, setCourse] = useState<Course | null | "not_found">(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("content_items")
      .select(
        "id, title, excerpt, cover_url, course_modules(id, title, position, duration_minutes, free_preview, course_lessons(id, title, position, duration_minutes, free_preview))",
      )
      .eq("slug", slug)
      .eq("content_type", "course")
      .eq("status", "published")
      .order("position", { referencedTable: "course_modules" })
      .order("position", { referencedTable: "course_modules.course_lessons" })
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCourse((data as unknown as Course | null) ?? "not_found");
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

        {course === null ? (
          <div className="mt-8 grid place-items-center rounded-xl border border-border bg-card p-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : course === "not_found" ? (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            This course isn't available.
          </div>
        ) : (
          <div className="mt-6">
            {course.cover_url && (
              <img src={course.cover_url} alt="" className="mb-6 w-full rounded-xl object-cover" />
            )}
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{course.title}</h1>
            {course.excerpt && <p className="mt-2 text-muted-foreground">{course.excerpt}</p>}

            <h2 className="mt-8 text-lg font-semibold text-foreground">Modules</h2>
            <div className="mt-3 space-y-3">
              {(course.course_modules ?? []).map((m, idx) => (
                <div key={m.id} className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-foreground">
                    Module {idx + 1}: {m.title}
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {(m.course_lessons ?? []).map((l) => (
                      <li key={l.id} className="flex items-center gap-2 text-sm text-foreground/90">
                        {l.free_preview ? (
                          <PlayCircle className="h-4 w-4 shrink-0 text-primary" />
                        ) : (
                          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        {l.title}
                        {l.duration_minutes ? (
                          <span className="text-xs text-muted-foreground">
                            · {l.duration_minutes} min
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {(course.course_modules ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Modules coming soon.</p>
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, GraduationCap, Loader2, Lock, PlayCircle } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useCandidateCheckout } from "@/hooks/use-candidate-checkout";
import { createCourseOrder, getMyCoursePurchases } from "@/lib/learning.functions";

export const Route = createFileRoute("/learn_/course/$slug")({
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
  courses: { price_inr: number } | { price_inr: number }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function CoursePage() {
  const { slug } = Route.useParams();
  const [course, setCourse] = useState<Course | null | "not_found">(null);
  const [owned, setOwned] = useState(false);
  const createOrder = useServerFn(createCourseOrder);
  const myPurchases = useServerFn(getMyCoursePurchases);
  const { buying, buy } = useCandidateCheckout(() => setOwned(true));

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("content_items")
      .select(
        "id, title, excerpt, cover_url, courses(price_inr), " +
          "course_modules(id, title, position, duration_minutes, free_preview, " +
          "course_lessons(id, title, position, duration_minutes, free_preview))",
      )
      .eq("slug", slug)
      .eq("content_type", "course")
      .eq("status", "published")
      .order("position", { referencedTable: "course_modules" })
      .order("position", { referencedTable: "course_modules.course_lessons" })
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = (data as unknown as Course | null) ?? "not_found";
        setCourse(row);
        if (row !== "not_found") {
          myPurchases({ data: undefined })
            .then((rows) => {
              if (!cancelled && rows.some((r) => r.course_id === row.id)) setOwned(true);
            })
            .catch(() => {
              // Not signed in — treat as "not owned"; Buy re-checks server-side anyway.
            });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const handleBuy = () => {
    if (course === null || course === "not_found") return;
    void buy(() => createOrder({ data: { courseId: course.id } }));
  };

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
          (() => {
            const price = one(course.courses)?.price_inr ?? 0;
            const unlocked = owned || price <= 0;
            return (
              <div className="mt-6">
                {course.cover_url && (
                  <img
                    src={course.cover_url}
                    alt=""
                    className="mb-6 w-full rounded-xl object-cover"
                  />
                )}
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-6 w-6 text-primary" />
                  <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{course.title}</h1>
                </div>
                {course.excerpt && <p className="mt-2 text-muted-foreground">{course.excerpt}</p>}

                <div className="mt-4 rounded-xl border border-border bg-card p-5">
                  {owned ? (
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="h-5 w-5" />
                      <p className="font-semibold">You own this course</p>
                    </div>
                  ) : price > 0 ? (
                    <>
                      <p className="text-lg font-bold text-foreground">₹{price}</p>
                      <button
                        onClick={handleBuy}
                        disabled={buying}
                        className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {buying && <Loader2 className="h-4 w-4 animate-spin" />}
                        Buy now
                      </button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Free-preview lessons below are open to everyone.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">This course is free.</p>
                  )}
                </div>

                <h2 className="mt-8 text-lg font-semibold text-foreground">Modules</h2>
                <div className="mt-3 space-y-3">
                  {(course.course_modules ?? []).map((m, idx) => (
                    <div key={m.id} className="rounded-xl border border-border bg-card p-4">
                      <h3 className="font-semibold text-foreground">
                        Module {idx + 1}: {m.title}
                      </h3>
                      <ul className="mt-2 space-y-1.5">
                        {(m.course_lessons ?? []).map((l) => {
                          const lessonUnlocked = unlocked || !!l.free_preview;
                          return (
                            <li key={l.id}>
                              <Link
                                to="/learn/course/$slug/lesson/$lessonId"
                                params={{ slug, lessonId: l.id }}
                                className="flex items-center gap-2 rounded-lg p-1.5 text-sm text-foreground/90 hover:bg-surface"
                              >
                                {lessonUnlocked ? (
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
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  {(course.course_modules ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">Modules coming soon.</p>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </main>
      <Footer />
    </div>
  );
}

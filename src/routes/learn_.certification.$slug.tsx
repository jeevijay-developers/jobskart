import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CheckCircle2, FileCheck2, Loader2, Lock } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useCandidateCheckout } from "@/hooks/use-candidate-checkout";
import { createCertificationOrder, getMyCertificatePurchases } from "@/lib/learning.functions";

export const Route = createFileRoute("/learn_/certification/$slug")({
  component: CertificationPage,
});

type Cert = {
  id: string;
  title: string;
  excerpt: string | null;
  cover_url: string | null;
  certifications:
    | {
        price_inr: number;
        provider: string;
        partner_name: string | null;
        pass_mark: number;
        max_attempts: number;
      }
    | {
        price_inr: number;
        provider: string;
        partner_name: string | null;
        pass_mark: number;
        max_attempts: number;
      }[]
    | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function CertificationPage() {
  const { slug } = Route.useParams();
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <CertificationContent slug={slug} />
      </main>
      <Footer />
    </div>
  );
}

/** Detail body, shared by the public page and the candidate dashboard. */
export function CertificationContent({
  slug,
  inCandidate,
}: {
  slug: string;
  inCandidate?: boolean;
}) {
  const [cert, setCert] = useState<Cert | null | "not_found">(null);
  const [owned, setOwned] = useState<{ certificate_no: string } | null>(null);
  const createOrder = useServerFn(createCertificationOrder);
  const myPurchases = useServerFn(getMyCertificatePurchases);
  const { buying, buy } = useCandidateCheckout((r) =>
    setOwned({ certificate_no: r.certificateNo ?? "" }),
  );

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("content_items")
      .select(
        "id, title, excerpt, cover_url, certifications(price_inr, provider, partner_name, pass_mark, max_attempts)",
      )
      .eq("slug", slug)
      .eq("content_type", "certification")
      .eq("status", "published")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = (data as unknown as Cert | null) ?? "not_found";
        setCert(row);
        if (row !== "not_found") {
          myPurchases({ data: undefined })
            .then((rows) => {
              const mine = rows.find((r) => r.certification_id === row.id);
              if (!cancelled && mine) setOwned({ certificate_no: mine.certificate_no ?? "" });
            })
            .catch(() => {
              // Not signed in, or the check failed — treat as "not yet purchased"; the
              // Buy button itself requires sign-in and re-checks server-side anyway.
            });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const handleBuy = () => {
    if (cert === null || cert === "not_found") return;
    void buy(() => createOrder({ data: { certificationId: cert.id } }));
  };

  return (
    <>
      <Link
        to={inCandidate ? "/candidate/learning" : "/learn"}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Learning
      </Link>

      {cert === null ? (
        <div role="status" aria-live="polite" aria-label="Loading certification" className="mt-6">
          <Skeleton className="mb-6 h-56 w-full rounded-xl" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-6 h-24 w-full rounded-xl" />
        </div>
      ) : cert === "not_found" ? (
        <div
          role="alert"
          className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground"
        >
          This certification isn't available.
        </div>
      ) : (
        (() => {
          const details = one(cert.certifications);
          const price = details?.price_inr ?? 0;
          return (
            <div className="mt-6">
              {cert.cover_url && (
                inCandidate ? (
                  // Same fixed-size, contain-fit box as the Articles cover: the image never sets the height.
                  <div className="relative mb-6 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-surface sm:aspect-[3/1]">
                    <img
                      src={cert.cover_url}
                      alt={cert.title}
                      className="absolute inset-0 h-full w-full object-contain object-center"
                    />
                  </div>
                ) : (
                  <img
                    src={cert.cover_url}
                    alt={cert.title}
                    className="mb-6 w-full rounded-xl object-cover"
                  />
                )
              )}
              <div className="flex items-center gap-2">
                <Award className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{cert.title}</h1>
              </div>
              {cert.excerpt && <p className="mt-2 text-muted-foreground">{cert.excerpt}</p>}

              {details && (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      Pass mark
                    </dt>
                    <dd className="text-foreground">{details.pass_mark}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase text-muted-foreground">
                      Attempts
                    </dt>
                    <dd className="text-foreground">{details.max_attempts}</dd>
                  </div>
                  {details.provider === "partner" && details.partner_name && (
                    <div className="col-span-2">
                      <dt className="text-xs font-semibold uppercase text-muted-foreground">
                        Issued with
                      </dt>
                      <dd className="text-foreground">{details.partner_name}</dd>
                    </div>
                  )}
                </dl>
              )}

              <div className="mt-6 rounded-xl border border-border bg-card p-5">
                {owned ? (
                  <>
                    <div className="flex items-center gap-2 text-success">
                      <CheckCircle2 className="h-5 w-5" />
                      <div>
                        <p className="font-semibold">You own this certification</p>
                        {owned.certificate_no && (
                          <p className="text-xs text-muted-foreground">
                            Certificate No. {owned.certificate_no}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      to={
                        inCandidate
                          ? "/candidate/learning/certification/$slug/exam"
                          : "/learn/certification/$slug/exam"
                      }
                      params={{ slug }}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <FileCheck2 className="h-4 w-4" /> Start exam
                    </Link>
                  </>
                ) : price > 0 ? (
                  <>
                    <p className="text-lg font-bold text-foreground">₹{price}</p>
                    <button
                      onClick={handleBuy}
                      disabled={buying}
                      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
                    >
                      {buying && <Loader2 className="h-4 w-4 animate-spin" />}
                      Buy now
                    </button>
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" /> Secure checkout via Razorpay.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">This certification is free.</p>
                )}
              </div>
            </div>
          );
        })()
      )}
    </>
  );
}

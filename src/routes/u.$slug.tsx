import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Briefcase, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Chip } from "@/components/candidate/primitives";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/u/$slug")({
  head: ({ loaderData }) => {
    const c = loaderData as PublicCandidate | undefined;
    const title = c?.full_name ? `${c.full_name} — ${c.headline || c.last_role || "Job seeker"} · JobsKart` : "Candidate profile · JobsKart";
    const desc = c ? `${c.full_name} from ${c.city || "India"}. ${c.headline || ""} ${c.skills?.slice(0, 5).join(", ") || ""}`.trim() : "View this candidate's public profile on JobsKart.";
    return { meta: [{ title }, { name: "description", content: desc }, { property: "og:title", content: title }, { property: "og:description", content: desc }] };
  },
  loader: async ({ params }) => {
    const { data, error } = await supabase.rpc("get_public_candidate", { _slug: params.slug });
    if (error || !data || !Array.isArray(data) || data.length === 0) throw notFound();
    return data[0] as PublicCandidate;
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-surface"><Navbar />
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-foreground">Profile not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This profile may have been removed or is incomplete.</p>
        <Link to="/jobs" className="mt-6 inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">Browse jobs</Link>
      </div>
    </div>
  ),
  errorComponent: () => <div className="grid min-h-screen place-items-center"><p>Something went wrong.</p></div>,
  component: PublicProfile,
});

type PublicCandidate = {
  user_id: string; profile_slug: string; full_name: string; city: string | null; avatar_url: string | null;
  headline: string | null; last_role: string | null; skills: string[]; years_experience: number;
  experience_status: string; bio: string | null; preferred_job_types: string[]; preferred_cities: string[];
  kyc_status: string; profile_strength: number;
};

function PublicProfile() {
  const c = Route.useLoaderData() as PublicCandidate;
  useEffect(() => { supabase.rpc("increment_profile_views", { _slug: c.profile_slug }); }, [c.profile_slug]);
  const initials = c.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center gap-5">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-primary-light text-2xl font-bold text-primary">{initials}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{c.full_name}</h1>
                {c.kyc_status === "verified" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success"><ShieldCheck className="h-3 w-3" /> Verified</span>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground/80">{c.headline || c.last_role || "Job seeker"}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {c.city || "India"}</p>
            </div>
            <button className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-primary">Contact (recruiters)</button>
          </div>

          {c.bio && <p className="mt-6 whitespace-pre-line text-sm text-foreground/90">{c.bio}</p>}

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <Section title="Experience" icon={Briefcase}>
              <p className="text-sm text-foreground/90 capitalize">{c.experience_status}{c.years_experience ? ` · ${c.years_experience} yrs` : ""}</p>
              {c.last_role && <p className="text-xs text-muted-foreground">Last role: {c.last_role}</p>}
            </Section>
            <Section title="Looking for" icon={Sparkles}>
              <p className="text-sm text-foreground/90">{c.preferred_job_types?.join(", ") || "—"}</p>
              {c.preferred_cities?.length ? <p className="text-xs text-muted-foreground">Cities: {c.preferred_cities.join(", ")}</p> : null}
            </Section>
          </div>

          {c.skills?.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Skills</h2>
              <div className="flex flex-wrap gap-2">{c.skills.map((s) => <Chip key={s} label={s} />)}</div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Briefcase; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-primary" /> {title}</div>
      {children}
    </div>
  );
}

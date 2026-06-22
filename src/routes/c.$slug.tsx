import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Briefcase, ExternalLink, MapPin, ShieldCheck, Users } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { JobCard, type JobCardData } from "@/components/site/JobCard";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Company = {
  id: string; slug: string; name: string; about: string | null; industry: string | null;
  size: string | null; website: string | null; logo_url: string | null; cover_url: string | null;
  hq_city: string | null; founded_year: number | null; verification_status: string;
};

type LoaderShape = { company: Company | null; jobs: JobCardData[] };

const publicClient = () =>
  createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

const fetchCompany = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<LoaderShape> => {
    const sb = publicClient();
    const { data: row } = await sb.rpc("get_public_company", { _slug: data.slug });
    const company = ((row as unknown as Company[] | null)?.[0] ?? null);
    if (!company) return { company: null, jobs: [] };
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, companies (name, is_verified)")
      .eq("company_id", company.id)
      .eq("status", "active" as never)
      .order("created_at", { ascending: false })
      .limit(20);
    return { company, jobs: (jobs || []) as unknown as JobCardData[] };
  });

export const Route = createFileRoute("/c/$slug")({
  loader: async ({ params }) => {
    const res = await fetchCompany({ data: { slug: params.slug } });
    if (!res.company) throw notFound();
    return res;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${(loaderData?.company as { name?: string })?.name || "Company"} · JobsKart` },
      { name: "description", content: (loaderData?.company as { about?: string })?.about?.slice(0, 160) || "Company profile on JobsKart" },
    ],
  }),
  notFoundComponent: () => (
    <div className="min-h-screen bg-surface"><Navbar />
      <main className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">Company not found</h1>
        <Link to="/jobs" className="mt-4 inline-block text-primary">Browse jobs →</Link>
      </main>
    </div>
  ),
  errorComponent: () => (
    <div className="min-h-screen bg-surface"><Navbar />
      <main className="mx-auto max-w-2xl px-4 py-20 text-center"><p>Something went wrong.</p></main>
    </div>
  ),
  component: CompanyPublicPage,
});

function CompanyPublicPage() {
  const { company, jobs } = Route.useLoaderData() as LoaderShape & { company: Company };
  const verified = company.verification_status === "verified";


function CompanyPublicPage() {
  const { company, jobs } = Route.useLoaderData() as { company: Company; jobs: JobCardData[] };
  const verified = company.verification_status === "verified";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="relative bg-gradient-to-br from-primary-light to-success-light">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-5">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-20 w-20 rounded-2xl border-4 border-card object-cover" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-2xl border-4 border-card bg-primary text-3xl font-bold text-primary-foreground">
                  {company.name.slice(0, 1)}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold sm:text-3xl">{company.name}</h1>
                  {verified && <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2 py-1 text-xs font-semibold text-success"><ShieldCheck className="h-3 w-3" /> Verified</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
                  {company.industry && <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> {company.industry}</span>}
                  {company.hq_city && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {company.hq_city}</span>}
                  {company.size && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {company.size}</span>}
                </div>
                {company.website && (
                  <a href={company.website} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    Visit website <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="text-lg font-bold">About {company.name}</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/80">{company.about || "This company hasn't added a description yet."}</p>
            </div>
            <aside className="rounded-2xl border border-border bg-card p-5">
              <h3 className="text-sm font-bold">Quick facts</h3>
              <dl className="mt-3 space-y-2 text-sm">
                {company.founded_year && <div className="flex justify-between"><dt className="text-muted-foreground">Founded</dt><dd className="font-medium">{company.founded_year}</dd></div>}
                {company.size && <div className="flex justify-between"><dt className="text-muted-foreground">Size</dt><dd className="font-medium">{company.size}</dd></div>}
                {company.hq_city && <div className="flex justify-between"><dt className="text-muted-foreground">HQ</dt><dd className="font-medium">{company.hq_city}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted-foreground">Active jobs</dt><dd className="font-medium">{jobs.length}</dd></div>
              </dl>
            </aside>
          </div>

          <div className="mt-12">
            <h2 className="text-lg font-bold">Open positions ({jobs.length})</h2>
            {jobs.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">No active jobs right now. Check back soon!</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {jobs.map((j) => <JobCard key={j.id} job={j} />)}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Flame, MapPin, Sparkles, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Digest = {
  total_matches: number;
  hot_count: number;
  nearby_count: number;
  active_count: number;
  top_job_id: string | null;
  top_job_title: string | null;
  top_job_matches: number | null;
};

export function RecommendedCandidatesWidget({ companyId }: { companyId: string }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("get_recommended_candidates_digest", { _company_id: companyId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data && data.length > 0) setDigest(data[0] as Digest);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (loading) {
    return (
      <section className="overflow-hidden rounded-[1.375rem] border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
        <div className="h-24 animate-pulse rounded-xl bg-surface" />
      </section>
    );
  }

  if (!digest || digest.total_matches === 0) return null;

  return (
    <section className="overflow-hidden rounded-[1.375rem] border border-primary/20 bg-primary-light/30 p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        Active Hiring Intelligence
      </div>
      <p className="mt-3 text-sm leading-relaxed text-foreground">
        <strong>{digest.total_matches} candidates</strong> in our database match your live jobs but
        haven't applied yet.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
        {digest.hot_count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff3e0] px-2.5 py-1 text-orange-600">
            <Flame className="h-3 w-3" /> {digest.hot_count} hot profiles
          </span>
        )}
        {digest.nearby_count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-blue-600">
            <MapPin className="h-3 w-3" /> {digest.nearby_count} nearby
          </span>
        )}
        {digest.active_count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-600">
            <Zap className="h-3 w-3" /> {digest.active_count} recently active
          </span>
        )}
      </div>
      {digest.top_job_id && (
        <Link
          to="/employer/jobs/$jobId/applicants"
          params={{ jobId: digest.top_job_id }}
          search={{ source: "recommended" }}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {digest.top_job_matches} matches for "{digest.top_job_title}" — view now
        </Link>
      )}
    </section>
  );
}

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type PlatformStats = {
  jobs: number;
  companies: number;
  candidates: number;
  cities: number;
};

export const getPlatformStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformStats> => {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const [jobsRes, companiesRes, candidatesRes] = await Promise.all([
      supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("user_type", "candidate"),
    ]);

    // Cities — best-effort distinct count from jobs.location_city (skip if RLS blocks)
    let cities = 0;
    try {
      const { data } = await supabase.from("jobs").select("location_city").eq("status", "published").limit(1000);
      cities = new Set((data ?? []).map((r) => r.location_city).filter(Boolean)).size;
    } catch {
      cities = 0;
    }

    return {
      jobs: jobsRes.count ?? 0,
      companies: companiesRes.count ?? 0,
      candidates: candidatesRes.count ?? 0,
      cities,
    };
  },
);

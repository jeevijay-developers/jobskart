import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  companyId: z.string().uuid(),
  rangeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});

export type EmployerAnalytics = {
  totals: { jobs: number; activeJobs: number; views: number; applications: number; hires: number; interviews: number };
  deltas: { applications: number; views: number };
  conversionRate: number;
  funnel: Record<"applied" | "shortlisted" | "interview" | "hired" | "rejected" | "withdrawn", number>;
  topJobs: { id: string; title: string; applications: number; views: number; status: string }[];
  daily: { date: string; applications: number }[];
};

export const getEmployerAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<EmployerAnalytics> => {
    const { supabase, userId } = context;
    const { companyId, rangeDays } = data;

    const { data: membership } = await supabase
      .from("employer_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("Forbidden");

    const now = Date.now();
    const start = new Date(now - rangeDays * 86400e3).toISOString();
    const prevStart = new Date(now - 2 * rangeDays * 86400e3).toISOString();

    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, status, applications_count, views_count")
      .eq("company_id", companyId);
    const jobsList = jobs || [];
    const jobIds = jobsList.map((j) => j.id);
    const safeIds = jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"];

    const STATUSES = ["applied", "shortlisted", "interview", "hired", "rejected", "withdrawn"] as const;
    const funnelRes = await Promise.all(
      STATUSES.map((s) =>
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", s),
      ),
    );
    const funnel = STATUSES.reduce<EmployerAnalytics["funnel"]>((acc, s, i) => {
      acc[s] = funnelRes[i].count || 0;
      return acc;
    }, { applied: 0, shortlisted: 0, interview: 0, hired: 0, rejected: 0, withdrawn: 0 });

    const [{ count: appsCur }, { count: appsPrev }] = await Promise.all([
      supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).gte("created_at", start),
      supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).gte("created_at", prevStart).lt("created_at", start),
    ]);

    const views = jobsList.reduce((a, b) => a + (b.views_count || 0), 0);
    const applications = jobsList.reduce((a, b) => a + (b.applications_count || 0), 0);

    const { data: rows } = await supabase
      .from("applications")
      .select("created_at")
      .in("job_id", safeIds)
      .gte("created_at", start)
      .order("created_at", { ascending: true });
    const buckets = new Map<string, number>();
    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(now - (rangeDays - 1 - i) * 86400e3).toISOString().slice(0, 10);
      buckets.set(d, 0);
    }
    (rows || []).forEach((r) => {
      const k = (r.created_at as string).slice(0, 10);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) || 0) + 1);
    });
    const daily = Array.from(buckets, ([date, applications]) => ({ date, applications }));

    const topJobs = [...jobsList]
      .sort((a, b) => (b.applications_count || 0) - (a.applications_count || 0))
      .slice(0, 5)
      .map((j) => ({
        id: j.id,
        title: j.title,
        applications: j.applications_count || 0,
        views: j.views_count || 0,
        status: j.status as string,
      }));

    return {
      totals: {
        jobs: jobsList.length,
        activeJobs: jobsList.filter((j) => j.status === "active").length,
        views,
        applications,
        hires: funnel.hired,
        interviews: funnel.interview,
      },
      deltas: {
        applications: (appsCur || 0) - (appsPrev || 0),
        views: 0,
      },
      conversionRate: views ? Math.round(((appsCur || 0) / views) * 1000) / 10 : 0,
      funnel,
      topJobs,
      daily,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: { rpc: (...a: unknown[]) => Promise<{ data: unknown; error: { message: string } | null }> }, userId: string) {
  const { data, error } = await supabase.rpc("has_platform_role", { _user_id: userId, _role: "super_admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since7 = new Date(Date.now() - 7 * 86400e3).toISOString();
    const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
    const [users, users7, candidates, employers, companies, jobs, jobsOpen, apps, apps7, kycPending, revPaid] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since7),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("user_type", "candidate"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("user_type", "employer"),
      supabaseAdmin.from("companies").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabaseAdmin.from("applications").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("applications").select("id", { count: "exact", head: true }).gte("created_at", since7),
      supabaseAdmin.from("companies").select("id", { count: "exact", head: true }).eq("verification_status", "pending"),
      supabaseAdmin.from("razorpay_orders").select("amount, created_at").eq("status", "paid").gte("created_at", since30),
    ]);
    const revenue30 = (revPaid.data ?? []).reduce((s: number, r: { amount: number | null }) => s + (r.amount ?? 0), 0) / 100;
    return {
      users: users.count ?? 0,
      users7: users7.count ?? 0,
      candidates: candidates.count ?? 0,
      employers: employers.count ?? 0,
      companies: companies.count ?? 0,
      jobs: jobs.count ?? 0,
      jobsOpen: jobsOpen.count ?? 0,
      applications: apps.count ?? 0,
      applications7: apps7.count ?? 0,
      kycPending: kycPending.count ?? 0,
      revenue30,
    };
  });

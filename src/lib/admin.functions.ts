import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D+/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_platform_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Idempotent: ensures every admin_seed identifier has a Supabase auth user with a default password.
 *  Public — safe because it only operates on identifiers explicitly listed in admin_seed. */
export const bootstrapSeedAdmins = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: seeds, error } = await supabaseAdmin.from("admin_seed").select("identifier");
    if (error) throw new Error(error.message);
    const created: string[] = [];
    for (const s of seeds ?? []) {
      const ident = s.identifier as string;
      const isEmail = ident.includes("@");
      const phone = isEmail ? undefined : normalizePhone(ident);
      // Skip if user already exists
      try {
        if (isEmail) {
          const { data: list } = await supabaseAdmin.auth.admin.listUsers();
          if (list?.users?.some((u) => u.email === ident)) continue;
        } else {
          const { data: list } = await supabaseAdmin.auth.admin.listUsers();
          if (list?.users?.some((u) => u.phone === phone)) continue;
        }
      } catch {}
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: isEmail ? ident : undefined,
        phone,
        password: data.password,
        email_confirm: isEmail,
        phone_confirm: !isEmail,
        user_metadata: { full_name: "Super Admin", user_type: "employer" },
      });
      if (!createErr) created.push(ident);
    }
    return { created };
  });

export const adminLoginWithPassword = createServerFn({ method: "POST" })
  .inputValidator((d: { identifier: string; password: string }) => d)
  .handler(async ({ data }) => {
    // Stateless: returns nothing; client signs in directly. Kept for symmetry.
    return { phone: normalizePhone(data.identifier) };
  });

// --------- Admin data ops ---------

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; userType?: "candidate" | "employer" | "all"; status?: "active" | "suspended" | "all" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, mobile, user_type, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.userType && data.userType !== "all") q = q.eq("user_type", data.userType);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.search) {
      const s = data.search.trim();
      q = q.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,mobile.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; status: "active" | "suspended" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles").update({ status: data.status }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("companies").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const adminSetCompanyVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; status: "verified" | "pending" | "rejected" }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("companies").update({ verification_status: data.status }).eq("id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("jobs")
      .select("id, title, status, is_featured, applications_count, created_at, company_id, companies(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const adminToggleJobFeatured = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; featured: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("jobs").update({ is_featured: data.featured }).eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminCloseJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("jobs").update({ status: "closed" }).eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListResumes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: docs, error } = await supabaseAdmin
      .from("candidate_documents")
      .select("id, user_id, file_name, file_path, created_at, doc_type, profiles:user_id(full_name, mobile, email)")
      .eq("doc_type", "resume")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    // Sign urls
    const out: any[] = [];
    for (const d of docs ?? []) {
      const { data: signed } = await supabaseAdmin.storage.from("candidate-docs").createSignedUrl(d.file_path, 3600);
      out.push({ ...d, signed_url: signed?.signedUrl ?? null });
    }
    return { rows: out };
  });

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [u, c, j, a, rzp] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("companies").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("jobs").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("applications").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("razorpay_orders").select("amount").eq("status", "paid"),
    ]);
    const revenue = (rzp.data ?? []).reduce((s, r: any) => s + (r.amount ?? 0), 0) / 100;
    return {
      users: u.count ?? 0,
      companies: c.count ?? 0,
      jobs: j.count ?? 0,
      applications: a.count ?? 0,
      revenue,
    };
  });

export const adminGrantCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { companyId: string; delta: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: bal, error } = await supabaseAdmin.rpc("apply_credit_delta", {
      _company_id: data.companyId,
      _delta: data.delta,
      _kind: "adjustment",
      _reference: { note: data.note ?? "admin grant" },
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { balance: bal };
  });

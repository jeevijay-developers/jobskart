import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RAZORPAY_API = "https://api.razorpay.com/v1";

function getRazorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new Error(
      "Razorpay not configured yet. Ask the admin to add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }
  return { keyId, secret };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCompanyMember(supabase: any, userId: string, companyId: string) {
  const { data, error } = await supabase
    .from("employer_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You don't have access to this company.");
}

// ---------------- listPacks ----------------
export const listCreditPacks = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("credit_packs")
    .select("id, name, credits, price_inr, badge, sort")
    .eq("active", true)
    .order("sort", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

// ---------------- getWallet ----------------
export const getCompanyWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { data: wallet } = await context.supabase
      .from("employer_credit_wallets")
      .select("balance, updated_at")
      .eq("company_id", data.companyId)
      .maybeSingle();
    const { data: txns } = await context.supabase
      .from("credit_transactions")
      .select("id, kind, delta, balance_after, reference, created_at")
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false })
      .limit(20);
    return {
      balance: wallet?.balance ?? 0,
      transactions: txns ?? [],
    };
  });

// ---------------- createRazorpayOrder ----------------
export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: z.string().uuid(), packId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { keyId, secret } = getRazorpayKeys();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pack, error: packErr } = await supabaseAdmin
      .from("credit_packs")
      .select("id, name, credits, price_inr")
      .eq("id", data.packId)
      .eq("active", true)
      .maybeSingle();
    if (packErr || !pack) throw new Error("Pack not available.");

    const amountPaise = pack.price_inr * 100;
    const receipt = `jk_${Date.now()}_${data.companyId.slice(0, 8)}`;

    const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: {
          company_id: data.companyId,
          pack_id: pack.id,
          credits: String(pack.credits),
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Razorpay order failed (${res.status}). ${text.slice(0, 200)}`);
    }
    const order = (await res.json()) as { id: string; amount: number; currency: string };

    await supabaseAdmin.from("razorpay_orders").insert({
      company_id: data.companyId,
      pack_id: pack.id,
      amount_inr: pack.price_inr,
      credits: pack.credits,
      razorpay_order_id: order.id,
      status: "created",
      created_by: context.userId,
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      packName: pack.name,
      credits: pack.credits,
    };
  });

// ---------------- verifyRazorpayPayment ----------------
export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1),
        razorpaySignature: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { secret } = getRazorpayKeys();

    const expected = createHmac("sha256", secret)
      .update(`${data.razorpayOrderId}|${data.razorpayPaymentId}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(data.razorpaySignature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("Invalid payment signature.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("razorpay_orders")
      .select("id, company_id, credits, status")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .maybeSingle();
    if (error || !order) throw new Error("Order not found.");

    // Caller must be a member of the company that owns the order
    await assertCompanyMember(context.supabase, context.userId, order.company_id);

    if (order.status === "paid") {
      const { data: w } = await supabaseAdmin
        .from("employer_credit_wallets")
        .select("balance")
        .eq("company_id", order.company_id)
        .maybeSingle();
      return { balance: w?.balance ?? 0, alreadyApplied: true };
    }

    const { data: bal, error: rpcErr } = await supabaseAdmin.rpc("apply_credit_delta", {
      _company_id: order.company_id,
      _delta: order.credits,
      _kind: "purchase",
      _reference: { order_id: order.id, razorpay_payment_id: data.razorpayPaymentId },
      _actor: context.userId,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    // Issue the GST tax invoice. Idempotent per order — never blocks credit delivery.
    const { error: invErr } = await supabaseAdmin.rpc("issue_credit_pack_invoice", {
      _order_id: order.id,
      _razorpay_payment_id: data.razorpayPaymentId,
    });
    if (invErr) console.error("issue_credit_pack_invoice failed", invErr.message);

    await supabaseAdmin
      .from("razorpay_orders")
      .update({
        status: "paid",
        razorpay_payment_id: data.razorpayPaymentId,
      })
      .eq("id", order.id);

    return { balance: bal as number, alreadyApplied: false };
  });

// ---------------- listCompanyInvoices ----------------
export const listCompanyInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { data: rows, error } = await context.supabase
      .from("invoices")
      .select(
        "id, invoice_number, issue_date, line_items, subtotal_inr, cgst_inr, sgst_inr, igst_inr, total_inr, buyer_snapshot, payment_method, payment_reference, payment_status, status, source",
      )
      .eq("company_id", data.companyId)
      .order("issue_date", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------------- unlockCandidate ----------------
export const unlockCandidateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        candidateUserId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: unlockErr } = await supabaseAdmin.rpc("unlock_candidate", {
      _company_id: data.companyId,
      _candidate_user_id: data.candidateUserId,
      _actor: context.userId,
    });
    if (unlockErr) throw new Error(unlockErr.message);
    const result = (rows as Array<{ already_unlocked: boolean; balance_after: number }> | null)?.[0];

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, mobile, email, city")
      .eq("id", data.candidateUserId)
      .maybeSingle();

    return {
      contact: {
        full_name: profile?.full_name ?? "",
        mobile: profile?.mobile ?? "",
        email: profile?.email ?? "",
        city: profile?.city ?? "",
      },
      alreadyUnlocked: !!result?.already_unlocked,
      balance: result?.balance_after ?? 0,
    };
  });

// ---------------- listUnlockedCandidateIds ----------------
export const listUnlockedCandidateIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { data: rows } = await context.supabase
      .from("candidate_unlocks")
      .select("candidate_user_id")
      .eq("company_id", data.companyId);
    return (rows ?? []).map((r) => r.candidate_user_id);
  });

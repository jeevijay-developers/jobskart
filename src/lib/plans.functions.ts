// Plan subscription purchase — same Razorpay Orders flow as credit packs
// (src/lib/credits.functions.ts, src/lib/razorpay.server.ts). Plan
// entitlement logic itself (limits, live_jobs_max, etc.) lives entirely in
// Postgres per architecture rule 2 — this file only creates/verifies orders.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

// ---------------- listPlans ----------------
export const listPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("plans")
    .select("id, name, price_inr, limits")
    .eq("is_custom", false)
    .order("price_inr", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
});

// ---------------- createPlanOrder ----------------
export const createPlanOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ companyId: z.string().uuid(), planId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayKeys, paymentErrorMessage, RAZORPAY_API } =
      await import("@/lib/razorpay.server");
    const { keyId, secret } = getRazorpayKeys();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: quoteRaw, error: quoteErr } = await supabaseAdmin.rpc("create_plan_order", {
      _company_id: data.companyId,
      _plan_id: data.planId,
      _actor: context.userId,
    });
    if (quoteErr) throw new Error(paymentErrorMessage(quoteErr.message));
    const quote = quoteRaw as unknown as {
      order_id: string;
      amount_paise: number;
      subtotal_inr: number;
      gst_inr: number;
      plan_name: string;
    };

    const markFailed = (reason: string) =>
      supabaseAdmin
        .from("razorpay_orders")
        .update({ status: "failed", failure_reason: reason })
        .eq("id", quote.order_id);

    const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
    let order: { id: string; amount: number; currency: string };
    try {
      const res = await fetch(`${RAZORPAY_API}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          amount: quote.amount_paise,
          currency: "INR",
          receipt: `jk_${quote.order_id}`,
          notes: {
            jk_order_id: quote.order_id,
            company_id: data.companyId,
            plan_id: data.planId,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Razorpay order failed (${res.status}). ${text.slice(0, 200)}`);
      }
      order = (await res.json()) as { id: string; amount: number; currency: string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Razorpay order failed.";
      await markFailed(`gateway_error: ${msg}`.slice(0, 500));
      throw new Error(msg);
    }

    const { error: attachErr } = await supabaseAdmin
      .from("razorpay_orders")
      .update({ razorpay_order_id: order.id })
      .eq("id", quote.order_id);
    if (attachErr) {
      await markFailed(`attach_failed: ${attachErr.message}`.slice(0, 500));
      throw new Error("Could not start checkout. Please try again.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email, mobile")
      .eq("id", context.userId)
      .maybeSingle();

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      planName: quote.plan_name,
      subtotalInr: Number(quote.subtotal_inr),
      gstInr: Number(quote.gst_inr),
      prefill: {
        name: profile?.full_name ?? "",
        email: profile?.email ?? "",
        contact: profile?.mobile ?? "",
      },
    };
  });

// ---------------- verifyPlanPayment ----------------
export const verifyPlanPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1),
        razorpaySignature: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayKeys, hmacSha256Matches, fulfilRazorpayOrder, paymentErrorMessage } =
      await import("@/lib/razorpay.server");
    const { secret } = getRazorpayKeys();

    const signed = `${data.razorpayOrderId}|${data.razorpayPaymentId}`;
    if (!hmacSha256Matches(secret, signed, data.razorpaySignature)) {
      throw new Error("Invalid payment signature.");
    }

    let result;
    try {
      result = await fulfilRazorpayOrder({
        razorpayOrderId: data.razorpayOrderId,
        razorpayPaymentId: data.razorpayPaymentId,
        amountPaise: null,
        via: "client",
        actor: context.userId,
      });
    } catch (e) {
      throw new Error(paymentErrorMessage(e instanceof Error ? e.message : String(e)));
    }
    if (result.status === "amount_mismatch") {
      throw new Error(
        `Payment amount didn't match the order. Contact support with payment ID ${data.razorpayPaymentId}.`,
      );
    }
    return { alreadyApplied: result.already_applied };
  });

// ---------------- switchToBasicPlan ----------------
export const switchToBasicPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { error } = await context.supabase.rpc("switch_company_plan_to_basic", {
      _company_id: data.companyId,
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

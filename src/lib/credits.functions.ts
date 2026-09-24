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
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
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
  .validator((input: unknown) =>
    z.object({ companyId: z.string().uuid(), packId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayKeys, paymentErrorMessage, RAZORPAY_API } =
      await import("@/lib/razorpay.server");
    const { keyId, secret } = getRazorpayKeys();

    // Membership check + GST quote + pending order row, all in Postgres.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: quoteRaw, error: quoteErr } = await supabaseAdmin.rpc(
      "create_credit_pack_order",
      { _company_id: data.companyId, _pack_id: data.packId, _actor: context.userId },
    );
    if (quoteErr) throw new Error(paymentErrorMessage(quoteErr.message));
    const quote = quoteRaw as unknown as {
      order_id: string;
      amount_paise: number;
      subtotal_inr: number;
      gst_inr: number;
      credits: number;
      pack_name: string;
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
            pack_id: data.packId,
            credits: String(quote.credits),
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
      packName: quote.pack_name,
      credits: quote.credits,
      subtotalInr: Number(quote.subtotal_inr),
      gstInr: Number(quote.gst_inr),
      prefill: {
        name: profile?.full_name ?? "",
        email: profile?.email ?? "",
        contact: profile?.mobile ?? "",
      },
    };
  });

// ---------------- verifyRazorpayPayment ----------------
export const verifyRazorpayPayment = createServerFn({ method: "POST" })
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

    // Membership is enforced inside the RPC via _actor. Invoice issuing,
    // idempotency and the row lock against the webhook all live there too.
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
    return { balance: result.balance ?? 0, alreadyApplied: result.already_applied };
  });

// ---------------- reportRazorpayPaymentFailure ----------------
// Records a failed attempt from Checkout's payment.failed event. Only moves an
// order from 'created' to 'failed'; a later successful retry on the same
// order still fulfils normally.
export const reportRazorpayPaymentFailure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1).optional(),
        reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("razorpay_orders")
      .select("company_id")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .maybeSingle();
    if (!order) return { ok: false };
    await assertCompanyMember(context.supabase, context.userId, order.company_id);

    const { error } = await supabaseAdmin.rpc("mark_razorpay_order_failed", {
      _razorpay_order_id: data.razorpayOrderId,
      _razorpay_payment_id: (data.razorpayPaymentId ?? null) as string,
      _reason: data.reason ?? "payment_failed",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- listCompanyInvoices ----------------
export const listCompanyInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
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
  .validator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        jobId: z.string().uuid(),
        candidateUserId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error: unlockErr } = await supabaseAdmin.rpc("unlock_candidate", {
      _company_id: data.companyId,
      _job_id: data.jobId,
      _candidate_user_id: data.candidateUserId,
      _actor: context.userId,
    });
    if (unlockErr) throw new Error(unlockErr.message);
    const result = (
      rows as Array<{
        already_unlocked: boolean;
        balance_after: number;
        source: "already" | "allowance" | "credits";
        allowance_left: number | null;
      }> | null
    )?.[0];

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, mobile, email, city")
      .eq("id", data.candidateUserId)
      .maybeSingle();

    // Audit trail for the leakage-protection rule (rule 3 / rule 6): every
    // contact reveal is logged, not just the credit/allowance spend.
    await supabaseAdmin.rpc("log_contact_viewed", {
      _company_id: data.companyId,
      _candidate_user_id: data.candidateUserId,
      _job_id: data.jobId,
      _actor: context.userId,
    });

    return {
      contact: {
        full_name: profile?.full_name ?? "",
        mobile: profile?.mobile ?? "",
        email: profile?.email ?? "",
        city: profile?.city ?? "",
      },
      alreadyUnlocked: !!result?.already_unlocked,
      balance: result?.balance_after ?? 0,
      source: result?.source ?? "credits",
      allowanceLeft: result?.allowance_left ?? null,
    };
  });

// ---------------- listUnlockedCandidateIds ----------------
export const listUnlockedCandidateIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);
    const { data: rows } = await context.supabase
      .from("candidate_unlocks")
      .select("candidate_user_id")
      .eq("company_id", data.companyId);
    return (rows ?? []).map((r) => r.candidate_user_id);
  });

// ---------------- getUnlockState ----------------
// Active jobs + their per-job unlock allowance + the wallet balance, in one
// call, for the Candidate Database job selector's allowance meter.
export const getUnlockState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const nowIso = new Date().toISOString();
    const [{ data: jobs }, { data: wallet }] = await Promise.all([
      context.supabase
        .from("jobs")
        .select("id, title")
        .eq("company_id", data.companyId)
        .eq("status", "active")
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("employer_credit_wallets")
        .select("balance")
        .eq("company_id", data.companyId)
        .maybeSingle(),
    ]);

    const jobIds = (jobs ?? []).map((j) => j.id);
    const { data: allowances } = jobIds.length
      ? await context.supabase
          .from("job_unlock_allowance")
          .select("job_id, total, used")
          .in("job_id", jobIds)
      : { data: [] as Array<{ job_id: string; total: number; used: number }> };
    const allowanceByJob = new Map((allowances ?? []).map((a) => [a.job_id, a]));

    return {
      balance: wallet?.balance ?? 0,
      jobs: (jobs ?? []).map((j) => {
        const a = allowanceByJob.get(j.id);
        return {
          id: j.id,
          title: j.title,
          allowanceTotal: a?.total ?? null,
          allowanceUsed: a?.used ?? null,
          allowanceLeft: a ? a.total - a.used : null,
        };
      }),
    };
  });

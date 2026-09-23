// Server-only Razorpay helpers shared by the credits server functions and the
// webhook route. Credit granting itself lives in Postgres
// (fulfill_razorpay_order) so the two paths can never double-credit.
import { createHmac, timingSafeEqual } from "crypto";

export const RAZORPAY_API = "https://api.razorpay.com/v1";

export function getRazorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new Error(
      "Razorpay not configured yet. Ask the admin to add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }
  return { keyId, secret };
}

export function hmacSha256Matches(secret: string, payload: string, signature: string) {
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type FulfilResult = {
  status: "paid" | "amount_mismatch";
  already_applied: boolean;
  balance: number | null;
};

// Stable error codes raised by the payment RPCs → user-facing messages.
const PAYMENT_ERRORS: Record<string, string> = {
  insufficient_permissions: "You don't have access to this company.",
  pack_unavailable: "Pack not available.",
  order_not_found: "Order not found.",
};

export function paymentErrorMessage(raw: string) {
  const code = Object.keys(PAYMENT_ERRORS).find((k) => raw.includes(k));
  return code ? PAYMENT_ERRORS[code] : raw;
}

// Grants the order's credits exactly once. Safe to call from both the client
// verify path and the webhook, in any order, any number of times.
export async function fulfilRazorpayOrder(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise: number | null;
  via: "client" | "webhook";
  actor: string | null;
}): Promise<FulfilResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("fulfill_razorpay_order", {
    _razorpay_order_id: args.razorpayOrderId,
    _razorpay_payment_id: args.razorpayPaymentId,
    // Generated types can't express nullable RPC args; NULL is meaningful here.
    _amount_paise: args.amountPaise as number,
    _via: args.via,
    _actor: args.actor as string,
  });
  if (error) throw new Error(error.message);
  return data as unknown as FulfilResult;
}

import { createFileRoute } from "@tanstack/react-router";

type PaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  error_code?: string;
  error_description?: string;
};

type RazorpayEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    order?: { entity?: { id?: string } };
  };
};

export const Route = createFileRoute("/api/public/webhooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook not configured", { status: 503 });
        }
        const signature = request.headers.get("x-razorpay-signature");
        const body = await request.text();
        if (!signature) return new Response("Missing signature", { status: 401 });

        const { hmacSha256Matches, fulfilRazorpayOrder } = await import("@/lib/razorpay.server");
        if (!hmacSha256Matches(secret, body, signature)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: RazorpayEvent;
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const payment = event.payload?.payment?.entity;
        const orderId = payment?.order_id ?? event.payload?.order?.entity?.id;
        const paymentId = payment?.id;
        if (!orderId || !paymentId) return new Response("ignored", { status: 200 });

        if (event.event === "payment.failed") {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const reason = [payment?.error_code, payment?.error_description]
            .filter(Boolean)
            .join(": ");
          const { error } = await supabaseAdmin.rpc("mark_razorpay_order_failed", {
            _razorpay_order_id: orderId,
            _razorpay_payment_id: paymentId,
            _reason: reason || "payment_failed",
          });
          if (error) {
            console.error("mark_razorpay_order_failed failed", error.message);
            return new Response("error", { status: 500 });
          }
          return new Response("ok", { status: 200 });
        }

        if (event.event !== "payment.captured" && event.event !== "order.paid") {
          return new Response("ignored", { status: 200 });
        }

        try {
          const result = await fulfilRazorpayOrder({
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            amountPaise: typeof payment?.amount === "number" ? payment.amount : null,
            via: "webhook",
            actor: null,
          });
          if (result.status === "amount_mismatch") {
            console.error("Razorpay amount mismatch", {
              orderId,
              paymentId,
              amount: payment?.amount,
            });
          }
          return new Response("ok", { status: 200 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Orders not created by JobsKart: acknowledge so Razorpay stops retrying.
          if (msg.includes("order_not_found"))
            return new Response("order not found", { status: 200 });
          // Anything else: 500 so Razorpay retries (fulfilment is idempotent).
          console.error("fulfill_razorpay_order failed", msg);
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});

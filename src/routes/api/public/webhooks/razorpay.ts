import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

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

        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: { event?: string; payload?: { payment?: { entity?: { order_id?: string; id?: string } } } };
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        if (event.event !== "payment.captured") {
          return new Response("ignored", { status: 200 });
        }

        const orderId = event.payload?.payment?.entity?.order_id;
        const paymentId = event.payload?.payment?.entity?.id;
        if (!orderId || !paymentId) return new Response("ignored", { status: 200 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: order } = await supabaseAdmin
          .from("razorpay_orders")
          .select("id, company_id, credits, status")
          .eq("razorpay_order_id", orderId)
          .maybeSingle();

        if (!order) return new Response("order not found", { status: 200 });
        if (order.status === "paid") return new Response("ok", { status: 200 });

        await supabaseAdmin.rpc("apply_credit_delta", {
          _company_id: order.company_id,
          _delta: order.credits,
          _kind: "purchase",
          _reference: { order_id: order.id, razorpay_payment_id: paymentId, via: "webhook" },
          _actor: null,
        });

        await supabaseAdmin
          .from("razorpay_orders")
          .update({ status: "paid", razorpay_payment_id: paymentId })
          .eq("id", order.id);

        return new Response("ok", { status: 200 });
      },
    },
  },
});

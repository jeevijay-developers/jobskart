import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reportCandidateOrderFailure, verifyCandidatePayment } from "@/lib/learning.functions";

type OrderResult = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  title: string;
  prefill: { name: string; email: string; contact: string };
};

/**
 * Razorpay Checkout open → verify → grant, shared by the certification and
 * course buy flows (learn.certification.$slug.tsx / learn.course.$slug.tsx) —
 * both call the same generalized createOrder/verify/report server functions,
 * only the order-creation function itself differs per product.
 */
export function useCandidateCheckout(
  onPurchased: (result: { certificateNo: string | null }) => void,
) {
  const [buying, setBuying] = useState(false);
  const verify = useServerFn(verifyCandidatePayment);
  const reportFailure = useServerFn(reportCandidateOrderFailure);

  const buy = async (createOrder: () => Promise<OrderResult>) => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      toast.error("Please sign in as a candidate to buy this.");
      return;
    }
    if (typeof window === "undefined" || !window.Razorpay) {
      toast.error("Checkout not loaded yet. Refresh and try again.");
      return;
    }
    setBuying(true);
    try {
      const order = await createOrder();
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "JobsKart",
        description: order.title,
        prefill: order.prefill,
        theme: { color: "#1A55BD" },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const r = await verify({
              data: {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
            });
            toast.success("Purchased!");
            onPurchased({ certificateNo: r.certificateNo });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed.");
          } finally {
            setBuying(false);
          }
        },
        modal: { ondismiss: () => setBuying(false) },
      });
      rzp.on(
        "payment.failed",
        (resp: {
          error?: { description?: string; metadata?: { order_id?: string; payment_id?: string } };
        }) => {
          toast.error(resp.error?.description || "Payment failed. Try another method.");
          void reportFailure({
            data: {
              razorpayOrderId: resp.error?.metadata?.order_id ?? order.orderId,
              razorpayPaymentId: resp.error?.metadata?.payment_id,
            },
          }).catch(() => {
            /* best-effort; the webhook records failures too */
          });
        },
      );
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout.");
      setBuying(false);
    }
  };

  return { buying, buy };
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (
        event: "payment.failed",
        cb: (resp: {
          error?: {
            description?: string;
            reason?: string;
            metadata?: { order_id?: string; payment_id?: string };
          };
        }) => void,
      ) => void;
    };
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let loadPromise: Promise<void> | null = null;

/**
 * Injects Razorpay's checkout.js on first use instead of on every page load.
 * The script itself preloads a dozen+ payment-method chunks it doesn't need
 * unless Checkout actually opens, so loading it globally from __root.tsx
 * caused browser "preloaded but not used" warnings on every route, including
 * ones with no purchase flow (the /learn hub, candidate dashboard, etc).
 */
export function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay.")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Razorpay."));
    };
    document.body.appendChild(script);
  });
  return loadPromise;
}

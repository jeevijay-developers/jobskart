import { useBlocker, useNavigate } from "@tanstack/react-router";

/**
 * Dashboards are the landing page after login. The browser history entry
 * right before them is usually the auth/OTP screen, so a plain back-button
 * press would drop a logged-in user back onto the login form. Route "back"
 * to the public homepage instead.
 */
export function useBackToHome() {
  const navigate = useNavigate();

  useBlocker({
    shouldBlockFn: ({ action }) => {
      if (action !== "BACK") return false;
      navigate({ to: "/", replace: true });
      return true;
    },
    enableBeforeUnload: false,
  });
}

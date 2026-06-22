// This file is integration-managed: protects all child routes (URLs below this layout
// require sign-in). ssr: false because Supabase stores the session in localStorage,
// which the server cannot read. Do not author or change this file outside the integration.
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const isEmployer = location.pathname.startsWith("/employer");
      throw redirect({
        to: "/auth",
        search: {
          redirect: location.href,
          ...(isEmployer ? { tab: "employer" as const } : { tab: "candidate" as const }),
        },
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});

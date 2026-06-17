// This file is integration-managed: protects all child routes (URLs below this layout
// require sign-in). ssr: false because Supabase stores the session in localStorage,
// which the server cannot read. Do not author or change this file outside the integration.
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});

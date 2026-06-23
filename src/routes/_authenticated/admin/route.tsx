import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/admin/login" });
    const { data, error } = await supabase.rpc("has_platform_role", {
      _user_id: u.user.id,
      _role: "super_admin",
    });
    if (error || !data) throw redirect({ to: "/admin/login" });
  },
  component: () => <Outlet />,
});

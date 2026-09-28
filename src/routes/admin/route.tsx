import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // /admin/login is a child of this layout (file-based routing nests
    // admin.login.tsx under admin/route.tsx since both resolve under the
    // /admin segment), so without this bypass the guard below redirects
    // unauthenticated /admin/login itself back to /admin/login — an
    // infinite loop ("Too many redirects") that crashes to the root error
    // boundary instead of ever rendering the login form.
    if (location.pathname === "/admin/login") return;

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

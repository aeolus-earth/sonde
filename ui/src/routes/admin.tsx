import { createRoute, redirect } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { supabase } from "@/lib/supabase";
import { isAdminUser } from "@/lib/admin-access";
import AdminDashboard from "./pages/admin-dashboard";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!isAdminUser(session?.user)) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminDashboard,
});

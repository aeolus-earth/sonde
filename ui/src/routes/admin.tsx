import { createRoute, redirect } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { supabase } from "@/lib/supabase";
import AdminDashboard from "./pages/admin-dashboard";

const ADMIN_EMAIL = "mason@aeolus.earth";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.email !== ADMIN_EMAIL) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminDashboard,
});

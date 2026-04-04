import { createRoute, Outlet, redirect } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { Shell } from "@/components/layout/shell";
import { supabase } from "@/lib/supabase";

function AuthenticatedLayout() {
  return (
    <Shell>
      <div className="animate-page-enter flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </Shell>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  beforeLoad: async ({ location }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      const path = `${location.pathname}${location.searchStr}`;
      const redirectParam = path === "/login" || path.startsWith("/auth/") ? undefined : path;
      throw redirect({
        to: "/login",
        search: redirectParam ? { redirect: redirectParam } : {},
      });
    }
  },
  component: AuthenticatedLayout,
});

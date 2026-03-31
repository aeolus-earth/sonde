import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/directions",
  component: lazyRouteComponent(() => import("./pages/directions-list")),
});

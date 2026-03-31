import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "../_authenticated";

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/experiments/$id",
  component: lazyRouteComponent(() => import("../pages/experiment-detail")),
});

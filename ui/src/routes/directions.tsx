import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";

export type DirectionsSearch = {
  from?: string;
  to?: string;
};

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/directions",
  component: lazyRouteComponent(() => import("./pages/directions-list")),
  validateSearch: (search: Record<string, unknown>): DirectionsSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
});

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";

export type FindingsSearch = {
  confidence?: string;
};

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/findings",
  component: lazyRouteComponent(() => import("./pages/findings-list")),
  validateSearch: (search: Record<string, unknown>): FindingsSearch => ({
    confidence: typeof search.confidence === "string" ? search.confidence : undefined,
  }),
});

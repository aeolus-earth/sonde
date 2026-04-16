import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";

export type FindingsSearch = {
  confidence?: string;
  importance?: string;
  from?: string;
  to?: string;
};

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/findings",
  component: lazyRouteComponent(() => import("./pages/findings-list")),
  validateSearch: (search: Record<string, unknown>): FindingsSearch => ({
    confidence: typeof search.confidence === "string" ? search.confidence : undefined,
    importance: typeof search.importance === "string" ? search.importance : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
});

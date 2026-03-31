import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "../_authenticated";
import type { ExperimentStatus } from "@/types/sonde";
import type { ExperimentsSearch } from "../pages/experiments-list";

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/experiments",
  component: lazyRouteComponent(() => import("../pages/experiments-list")),
  validateSearch: (search: Record<string, unknown>): ExperimentsSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      typeof search.status === "string" &&
      ["all", "open", "running", "complete", "failed", "superseded"].includes(
        search.status
      )
        ? (search.status as ExperimentStatus | "all")
        : undefined,
  }),
});

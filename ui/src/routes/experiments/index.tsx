import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "../_authenticated";
import type { ArtifactType, ExperimentStatus } from "@/types/sonde";
import { normalizeExperimentStatusFilter } from "@/lib/experiment-status";
import type { ExperimentsSearch } from "../pages/experiments-list";

const VALID_ARTIFACT_TYPES = ["any", "figure", "paper", "dataset", "notebook", "config", "log", "report", "other"];
const VALID_VIEWS = ["list", "grouped"] as const;
const VALID_SORT_FIELDS = ["created", "closed"] as const;
const VALID_SORT_ORDERS = ["asc", "desc"] as const;

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/experiments",
  component: lazyRouteComponent(() => import("../pages/experiments-list")),
  validateSearch: (search: Record<string, unknown>): ExperimentsSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      typeof search.status === "string"
        ? (normalizeExperimentStatusFilter(search.status) as ExperimentStatus | "all" | undefined)
        : undefined,
    artifact:
      typeof search.artifact === "string" && VALID_ARTIFACT_TYPES.includes(search.artifact)
        ? (search.artifact as ArtifactType | "any")
        : undefined,
    view:
      typeof search.view === "string" && VALID_VIEWS.includes(search.view as (typeof VALID_VIEWS)[number])
        ? (search.view as "list" | "grouped")
        : undefined,
    day:
      typeof search.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.day)
        ? search.day
        : undefined,
    sort:
      typeof search.sort === "string" &&
      VALID_SORT_FIELDS.includes(search.sort as (typeof VALID_SORT_FIELDS)[number])
        ? (search.sort as "created" | "closed")
        : undefined,
    order:
      typeof search.order === "string" &&
      VALID_SORT_ORDERS.includes(search.order as (typeof VALID_SORT_ORDERS)[number])
        ? (search.order as "asc" | "desc")
        : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
});

import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "../_authenticated";
import type { ArtifactType, ExperimentStatus } from "@/types/sonde";
import type { ExperimentsSearch } from "../pages/experiments-list";

const VALID_STATUSES = ["all", "open", "running", "complete", "failed", "superseded"];
const VALID_ARTIFACT_TYPES = ["any", "figure", "paper", "dataset", "notebook", "config", "log", "report", "other"];
const VALID_VIEWS = ["list", "grouped"] as const;

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/experiments",
  component: lazyRouteComponent(() => import("../pages/experiments-list")),
  validateSearch: (search: Record<string, unknown>): ExperimentsSearch => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      typeof search.status === "string" && VALID_STATUSES.includes(search.status)
        ? (search.status as ExperimentStatus | "all")
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
    created:
      typeof search.created === "string" && ["asc", "desc"].includes(search.created)
        ? (search.created as "asc" | "desc")
        : undefined,
  }),
});

import { useCallback, lazy, Suspense, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useAllExperimentsForTree } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { usePrograms } from "@/hooks/use-programs";
import { useFindings } from "@/hooks/use-findings";
import { useActiveProgram } from "@/stores/program";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchTree, type TreeNavigateTarget } from "@/components/visualizations/research-tree";

const ExperimentGraph = lazy(() =>
  import("@/components/visualizations/experiment-graph").then((m) => ({
    default: m.ExperimentGraph,
  }))
);

const routeApi = getRouteApi(ROUTE_API.authTree);

export default function TreePage() {
  const { data: experiments, isLoading: loadingExp } =
    useAllExperimentsForTree();
  const { data: directions, isLoading: loadingDir } = useDirections();
  const { data: projects, isLoading: loadingProj } = useProjects();
  const { data: findings, isLoading: loadingFindings } = useFindings();
  const { data: programs } = usePrograms();
  const activeProgram = useActiveProgram();
  const navigate = routeApi.useNavigate();
  const [viewMode, setViewMode] = useState<"tree" | "map">("tree");

  const programLabel =
    programs?.find((p) => p.id === activeProgram)?.name ?? activeProgram;

  const handleNodeClick = useCallback(
    (id: string) => {
      navigate({ to: "/experiments/$id", params: { id } });
    },
    [navigate]
  );

  const handleProjectNavigate = useCallback(
    (projectId: string) => {
      navigate({ to: "/projects/$id", params: { id: projectId } });
    },
    [navigate]
  );

  const handleTreeNavigate = useCallback(
    (target: TreeNavigateTarget) => {
      if (target.kind === "experiment") {
        navigate({ to: "/experiments/$id", params: { id: target.id } });
      } else if (target.kind === "project") {
        navigate({ to: "/projects/$id", params: { id: target.id } });
      } else if (target.kind === "direction") {
        navigate({ to: "/directions/$id", params: { id: target.id } });
      } else {
        navigate({ to: "/findings/$id", params: { id: target.id } });
      }
    },
    [navigate]
  );

  const isLoading = loadingExp || loadingDir || loadingProj || loadingFindings;

  const hasGraphData =
    (experiments?.length ?? 0) > 0 ||
    (directions?.length ?? 0) > 0 ||
    (projects?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">
            Research tree
          </h1>
          <div
            className="flex shrink-0 rounded-[6px] border border-border bg-surface p-0.5"
            role="tablist"
            aria-label="View mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "tree"}
              className={
                viewMode === "tree"
                  ? "rounded-[4px] bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text shadow-sm"
                  : "rounded-[4px] px-2.5 py-1 text-[11px] font-medium text-text-tertiary hover:text-text-secondary"
              }
              onClick={() => setViewMode("tree")}
            >
              Tree
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "map"}
              className={
                viewMode === "map"
                  ? "rounded-[4px] bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text shadow-sm"
                  : "rounded-[4px] px-2.5 py-1 text-[11px] font-medium text-text-tertiary hover:text-text-secondary"
              }
              onClick={() => setViewMode("map")}
            >
              Map
            </button>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-text-secondary">
          Program → project → direction → experiment. Findings with evidence on an experiment appear
          inline. Use Tree for a vertical list; Map for the canvas layout.
        </p>
        <p className="mt-1 text-[11px] text-text-quaternary">
          Program: <span className="font-medium text-text-secondary">{programLabel}</span>
          <span className="mx-1.5 text-text-quaternary">·</span>
          <span className="text-text-quaternary">
            Legend: project → direction → experiment forks
          </span>
        </p>
      </div>

      <div className="h-[calc(100vh-10rem)]">
        {isLoading ? (
          <Skeleton className="h-full w-full rounded-[8px]" />
        ) : hasGraphData ? (
          viewMode === "tree" ? (
            <ResearchTree
              experiments={experiments ?? []}
              directions={directions ?? []}
              projects={projects ?? []}
              findings={findings ?? []}
              onNavigate={handleTreeNavigate}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Skeleton className="h-full w-full rounded-[8px]" />
                </div>
              }
            >
              <ExperimentGraph
                experiments={experiments ?? []}
                directions={directions ?? []}
                projects={projects ?? []}
                onNodeClick={handleNodeClick}
                onProjectNavigate={handleProjectNavigate}
              />
            </Suspense>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-text-quaternary">
            No projects, directions, or experiments in this program yet.
          </div>
        )}
      </div>
    </div>
  );
}

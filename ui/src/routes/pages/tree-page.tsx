import { useCallback, lazy, Suspense } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useAllExperimentsForTree } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { useProjects } from "@/hooks/use-projects";
import { usePrograms } from "@/hooks/use-programs";
import { useActiveProgram } from "@/stores/program";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { data: programs } = usePrograms();
  const activeProgram = useActiveProgram();
  const navigate = routeApi.useNavigate();

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

  const isLoading = loadingExp || loadingDir || loadingProj;

  const hasGraphData =
    (experiments?.length ?? 0) > 0 ||
    (directions?.length ?? 0) > 0 ||
    (projects?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Experiment Map</h1>
        <p className="text-[12px] text-text-secondary">
          Program → project → direction → experiment. Click a project or direction header to expand.
          Double-click a project to open its page; double-click an experiment to open details.
        </p>
        <p className="mt-1 text-[11px] text-text-quaternary">
          Program: <span className="font-medium text-text-secondary">{programLabel}</span>
          <span className="mx-1.5 text-text-quaternary">·</span>
          <span className="text-text-quaternary">
            Legend: project (briefcase) → direction → experiment forks
          </span>
        </p>
      </div>

      <div className="h-[calc(100vh-10rem)]">
        {isLoading ? (
          <Skeleton className="h-full w-full rounded-[8px]" />
        ) : hasGraphData ? (
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
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-text-quaternary">
            No projects, directions, or experiments in this program yet.
          </div>
        )}
      </div>
    </div>
  );
}

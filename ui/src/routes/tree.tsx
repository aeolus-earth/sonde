import { useMemo, useCallback, lazy, Suspense } from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";
import { useAllExperimentsForTree } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
import { Skeleton } from "@/components/ui/skeleton";

const ExperimentGraph = lazy(() =>
  import("@/components/visualizations/experiment-graph").then((m) => ({
    default: m.ExperimentGraph,
  }))
);

function TreePage() {
  const { data: experiments, isLoading: loadingExp } =
    useAllExperimentsForTree();
  const { data: directions, isLoading: loadingDir } = useDirections();
  const navigate = useNavigate();

  const handleNodeClick = useCallback(
    (id: string) => {
      navigate({ to: "/experiments/$id", params: { id } });
    },
    [navigate]
  );

  // Build direction name lookup
  const directionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of directions ?? []) {
      map.set(d.id, d.title);
    }
    return map;
  }, [directions]);

  const isLoading = loadingExp || loadingDir;

  return (
    <div className="flex h-full flex-col space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-text">Experiment Map</h1>
        <p className="text-xs text-text-secondary">
          Experiments grouped by direction. Click a node to view details.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Skeleton className="h-full w-full rounded-[8px]" />
          </div>
        ) : experiments && experiments.length > 0 ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Skeleton className="h-full w-full rounded-[8px]" />
              </div>
            }
          >
            <ExperimentGraph
              experiments={experiments}
              directionNames={directionNames}
              onNodeClick={handleNodeClick}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
            No experiments yet.
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/tree",
  component: TreePage,
});

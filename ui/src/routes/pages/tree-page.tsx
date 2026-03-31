import { useMemo, useCallback, lazy, Suspense } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { ROUTE_API } from "../route-ids";
import { useAllExperimentsForTree } from "@/hooks/use-experiments";
import { useDirections } from "@/hooks/use-directions";
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
  const navigate = routeApi.useNavigate();

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
    <div className="space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-[-0.015em] text-text">Experiment Map</h1>
        <p className="text-[12px] text-text-secondary">
          Experiments grouped by direction. Click a node to view details.
        </p>
      </div>

      <div className="h-[calc(100vh-10rem)]">
        {isLoading ? (
          <Skeleton className="h-full w-full rounded-[8px]" />
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
          <div className="flex h-full items-center justify-center text-[13px] text-text-tertiary">
            No experiments yet.
          </div>
        )}
      </div>
    </div>
  );
}

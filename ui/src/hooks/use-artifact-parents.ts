import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { Artifact } from "@/types/sonde";
import type { DirectionSummary } from "@/types/sonde";
import type { ExperimentSummary } from "@/types/sonde";
import type { Finding } from "@/types/sonde";

function uniqStrings(ids: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function parentIdsFromArtifacts(artifacts: Artifact[]) {
  const experimentIds = uniqStrings(artifacts.map((a) => a.experiment_id));
  const findingIds = uniqStrings(
    artifacts
      .filter((a) => !a.experiment_id && a.finding_id)
      .map((a) => a.finding_id),
  );
  const directionIds = uniqStrings(
    artifacts
      .filter((a) => !a.experiment_id && !a.finding_id && a.direction_id)
      .map((a) => a.direction_id),
  );
  return { experimentIds, findingIds, directionIds };
}

/**
 * Batch-load experiment / finding / direction rows for artifact parent labels.
 * Resolution order per artifact matches UI: experiment, then finding, then direction.
 */
export function useArtifactParentLookup(artifacts: Artifact[]) {
  const { experimentIds, findingIds, directionIds } = useMemo(
    () => parentIdsFromArtifacts(artifacts),
    [artifacts],
  );

  const expQueries = useQueries({
    queries: experimentIds.map((id) => ({
      queryKey: queryKeys.experiments.detail(id),
      queryFn: async (): Promise<ExperimentSummary> => {
        const { data, error } = await supabase
          .from("experiment_summary")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;
        return data;
      },
      enabled: !!id,
    })),
  });

  const findQueries = useQueries({
    queries: findingIds.map((id) => ({
      queryKey: queryKeys.findings.detail(id),
      queryFn: async (): Promise<Finding> => {
        const { data, error } = await supabase
          .from("findings")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;
        return data;
      },
      enabled: !!id,
    })),
  });

  const dirQueries = useQueries({
    queries: directionIds.map((id) => ({
      queryKey: queryKeys.directions.detail(id),
      queryFn: async (): Promise<DirectionSummary> => {
        const { data, error } = await supabase
          .from("direction_status")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;
        return data;
      },
      enabled: !!id,
    })),
  });

  const experimentById = useMemo(() => {
    const m = new Map<string, ExperimentSummary>();
    experimentIds.forEach((id, i) => {
      const row = expQueries[i]?.data;
      if (row) m.set(id, row);
    });
    return m;
  }, [experimentIds, expQueries]);

  const findingById = useMemo(() => {
    const m = new Map<string, Finding>();
    findingIds.forEach((id, i) => {
      const row = findQueries[i]?.data;
      if (row) m.set(id, row);
    });
    return m;
  }, [findingIds, findQueries]);

  const directionById = useMemo(() => {
    const m = new Map<string, DirectionSummary>();
    directionIds.forEach((id, i) => {
      const row = dirQueries[i]?.data;
      if (row) m.set(id, row);
    });
    return m;
  }, [directionIds, dirQueries]);

  const isLoading =
    expQueries.some((q) => q.isLoading) ||
    findQueries.some((q) => q.isLoading) ||
    dirQueries.some((q) => q.isLoading);

  return {
    experimentById,
    findingById,
    directionById,
    isLoading,
  };
}

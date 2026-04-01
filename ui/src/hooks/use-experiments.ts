import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { ExperimentSummary } from "@/types/sonde";

/** Row from `get_experiment_ancestors` RPC (subset). */
export interface ExperimentAncestorRpcRow {
  id: string;
  parent_id: string | null;
  depth: number;
}

export function useExperiments() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.experiments.all(program),
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("program", program)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!program,
  });
}

export function useExperiment(id: string) {
  return useQuery({
    queryKey: queryKeys.experiments.detail(id),
    queryFn: async (): Promise<ExperimentSummary> => {
      // Use the view (RLS-accessible) rather than the raw table
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useAllExperimentsForTree() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: [...queryKeys.experiments.all(program), "tree-all"] as const,
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("program", program)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!program,
  });
}

export function useExperimentsByDirection(directionId: string) {
  return useQuery({
    queryKey: ["experiments", "by-direction", directionId] as const,
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("direction_id", directionId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!directionId,
  });
}

/**
 * Server-side search using `search_all` RPC.
 * Returns experiment IDs matching `query` across all searchable fields
 * (FTS, ID patterns, digit substrings). Use as a complement to client-side
 * filtering when the full dataset may not be loaded.
 */
export function useExperimentSearch(query: string) {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.experiments.search(program, query),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("search_all", {
        query,
        filter_program: program,
        max_results: 50,
      });
      if (error) throw error;
      return (data ?? [])
        .filter((r: { record_type: string }) => r.record_type === "experiment")
        .map((r: { id: string }) => r.id);
    },
    enabled: query.length > 1 && !!program,
    staleTime: 30_000,
  });
}

/** Parent chain root → immediate parent (excludes current experiment). */
export function useExperimentAncestors(expId: string) {
  return useQuery({
    queryKey: queryKeys.experiments.ancestors(expId),
    queryFn: async (): Promise<{ id: string }[]> => {
      const { data, error } = await supabase.rpc("get_experiment_ancestors", {
        exp_id: expId,
      });
      if (error) throw error;
      const rows = (data ?? []) as ExperimentAncestorRpcRow[];
      return rows
        .filter((r) => r.depth > 0)
        .sort((a, b) => b.depth - a.depth)
        .map((r) => ({ id: r.id }));
    },
    enabled: !!expId,
  });
}

/** Direct children of this experiment (by `parent_id`). */
export function useExperimentChildren(expId: string) {
  return useQuery({
    queryKey: queryKeys.experiments.children(expId),
    queryFn: async (): Promise<{ id: string }[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("id")
        .eq("parent_id", expId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id }));
    },
    enabled: !!expId,
  });
}

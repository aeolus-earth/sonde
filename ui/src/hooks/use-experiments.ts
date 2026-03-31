import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { ExperimentSummary } from "@/types/sonde";

export function useExperiments() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.experiments.all(program),
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("program", program)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return data;
    },
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

export function useExperimentSearch(query: string) {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.experiments.search(program, query),
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("program", program)
        .or(`hypothesis.ilike.%${query}%,finding.ilike.%${query}%`)
        .limit(50);

      if (error) throw error;
      return data;
    },
    enabled: query.length > 2,
  });
}

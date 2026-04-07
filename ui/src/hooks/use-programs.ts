import { useQuery } from "@tanstack/react-query";
import { normalizeExperimentHypothesis } from "@/lib/experiment-hypothesis";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { ExperimentSummary, Program } from "@/types/sonde";

export function usePrograms() {
  return useQuery({
    queryKey: queryKeys.programs.all(),
    queryFn: async (): Promise<Program[]> => {
      const { data, error } = await supabase
        .from("programs")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useExperimentsForProgram(programId: string | null) {
  return useQuery({
    queryKey: queryKeys.experiments.byProgram(programId ?? "__none__"),
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("program", programId!)
        .order("created_at", { ascending: false })
        .limit(150);

      if (error) throw error;
      return data.map(normalizeExperimentHypothesis);
    },
    enabled: !!programId,
  });
}

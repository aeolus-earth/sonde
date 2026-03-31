import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { ExperimentNote } from "@/types/sonde";

export function useExperimentNotes(experimentId: string) {
  return useQuery({
    queryKey: queryKeys.notes.byExperiment(experimentId),
    queryFn: async (): Promise<ExperimentNote[]> => {
      const { data, error } = await supabase
        .from("experiment_notes")
        .select("*")
        .eq("experiment_id", experimentId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!experimentId,
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { ExperimentNote } from "@/types/sonde";

/** Search note bodies for @-mentions while viewing an experiment. */
export function useExperimentNotesSearch(experimentId: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.notes.search(experimentId, q),
    queryFn: async (): Promise<ExperimentNote[]> => {
      const safe = q.replace(/[%_]/g, " ").trim();
      if (!safe) return [];
      const { data, error } = await supabase
        .from("experiment_notes")
        .select("*")
        .eq("experiment_id", experimentId)
        .ilike("content", `%${safe}%`)
        .order("created_at", { ascending: false })
        .limit(15);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!experimentId && q.length >= 2,
  });
}

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

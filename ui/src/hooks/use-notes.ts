import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { Note } from "@/types/sonde";

/** Generic hook: fetch notes for any record type (experiment, direction, project). */
export function useNotes(recordType: string, recordId: string) {
  return useQuery({
    queryKey: queryKeys.notes.byRecord(recordType, recordId),
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("record_type", recordType)
        .eq("record_id", recordId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!recordId,
  });
}

/** Backwards-compatible hook for experiment notes. */
export function useExperimentNotes(experimentId: string) {
  return useNotes("experiment", experimentId);
}

/** Search note bodies for @-mentions while viewing an experiment. */
export function useExperimentNotesSearch(experimentId: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.notes.search(experimentId, q),
    queryFn: async (): Promise<Note[]> => {
      const safe = q.replace(/[%_]/g, " ").trim();
      if (!safe) return [];
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("record_type", "experiment")
        .eq("record_id", experimentId)
        .ilike("content", `%${safe}%`)
        .order("created_at", { ascending: false })
        .limit(15);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!experimentId && q.length >= 2,
  });
}

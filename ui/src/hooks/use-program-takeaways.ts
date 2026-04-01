import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { ProgramTakeaways } from "@/types/sonde";

export function useProgramTakeaways(programId: string | null) {
  return useQuery({
    queryKey: queryKeys.programTakeaways.byProgram(programId ?? "__none__"),
    queryFn: async (): Promise<ProgramTakeaways | null> => {
      if (!programId) return null;
      const { data, error } = await supabase
        .from("program_takeaways")
        .select("*")
        .eq("program", programId)
        .maybeSingle();
      if (error) throw error;
      return data as ProgramTakeaways | null;
    },
    enabled: !!programId,
    staleTime: 5 * 60_000,
  });
}

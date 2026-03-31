import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { DirectionSummary } from "@/types/sonde";

export function useDirection(id: string) {
  return useQuery({
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
  });
}

export function useDirections() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.directions.status(program),
    queryFn: async (): Promise<DirectionSummary[]> => {
      const { data, error } = await supabase
        .from("direction_status")
        .select("*")
        .eq("program", program)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
}

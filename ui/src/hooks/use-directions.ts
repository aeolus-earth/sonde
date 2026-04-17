import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { DirectionSummary } from "@/types/sonde";

export function useDirection(id: string) {
  return useQuery({
    queryKey: queryKeys.directions.detail(id),
    queryFn: async (): Promise<DirectionSummary | null> => {
      const { data, error } = await supabase
        .from("direction_status")
        .select("*")
        .eq("id", id)
        .maybeSingle();

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
    enabled: !!program,
  });
}

export function useChildDirections(parentId: string) {
  return useQuery({
    queryKey: queryKeys.directions.children(parentId),
    queryFn: async (): Promise<DirectionSummary[]> => {
      const { data, error } = await supabase
        .from("direction_status")
        .select("*")
        .eq("parent_direction_id", parentId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!parentId,
  });
}

export function useParentDirection(parentId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.directions.detail(parentId ?? ""),
    queryFn: async (): Promise<DirectionSummary | null> => {
      const { data, error } = await supabase
        .from("direction_status")
        .select("*")
        .eq("id", parentId!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!parentId,
  });
}

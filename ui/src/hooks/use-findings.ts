import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { Finding } from "@/types/sonde";

export function useFindings() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.findings.all(program),
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await supabase
        .from("findings")
        .select("*")
        .eq("program", program)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
}

export function useCurrentFindings() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.findings.current(program),
    queryFn: async (): Promise<Finding[]> => {
      const { data, error } = await supabase
        .from("current_findings")
        .select("*")
        .eq("program", program);

      if (error) throw error;
      return data;
    },
  });
}

export function useFinding(id: string) {
  return useQuery({
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
  });
}

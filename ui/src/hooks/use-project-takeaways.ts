import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ProjectTakeaways } from "@/types/sonde";

export function useProjectTakeaways(projectId: string | null) {
  return useQuery({
    queryKey: ["project-takeaways", projectId],
    queryFn: async (): Promise<ProjectTakeaways | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("project_takeaways")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();
      if (error) throw error;
      return data as ProjectTakeaways | null;
    },
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}

/** All non-empty `project_takeaways` rows for projects in the given program. */
export function useProjectTakeawaysInProgram(program: string | null) {
  return useQuery({
    queryKey: ["project-takeaways", "in-program", program] as const,
    queryFn: async (): Promise<ProjectTakeaways[]> => {
      if (!program) return [];
      const { data: projects, error: e1 } = await supabase
        .from("project_status")
        .select("id")
        .eq("program", program);
      if (e1) throw e1;
      const ids = (projects ?? []).map((p) => p.id as string);
      if (ids.length === 0) return [];
      const { data: rows, error: e2 } = await supabase
        .from("project_takeaways")
        .select("*")
        .in("project_id", ids);
      if (e2) throw e2;
      return (rows as ProjectTakeaways[]).filter((r) => (r.body ?? "").trim().length > 0);
    },
    enabled: !!program,
    staleTime: 5 * 60_000,
  });
}

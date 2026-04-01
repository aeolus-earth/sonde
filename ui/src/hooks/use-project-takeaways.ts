import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ProjectTakeaways {
  project_id: string;
  body: string;
  updated_at: string;
}

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

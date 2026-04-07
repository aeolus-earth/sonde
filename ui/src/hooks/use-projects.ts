import { useQuery } from "@tanstack/react-query";
import { normalizeExperimentHypothesis } from "@/lib/experiment-hypothesis";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { ProjectSummary, ExperimentSummary, DirectionSummary } from "@/types/sonde";

export function useProjects() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.projects.status(program),
    queryFn: async (): Promise<ProjectSummary[]> => {
      const { data, error } = await supabase
        .from("project_status")
        .select("*")
        .eq("program", program)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!program,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: async (): Promise<ProjectSummary> => {
      const { data, error } = await supabase
        .from("project_status")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useExperimentsByProject(projectId: string) {
  return useQuery({
    queryKey: ["experiments", "by-project", projectId] as const,
    queryFn: async (): Promise<ExperimentSummary[]> => {
      const { data, error } = await supabase
        .from("experiment_summary")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data.map(normalizeExperimentHypothesis);
    },
    enabled: !!projectId,
  });
}

/**
 * Directions for a project. Uses the **project's** `program`, not the header active program —
 * otherwise opening a project while another program is selected loads the wrong `direction_status`
 * rows and `project_id` filtering yields nothing.
 */
export function useDirectionsByProject(projectId: string, program: string | undefined) {
  return useQuery({
    queryKey: ["directions", "by-project", projectId, program] as const,
    queryFn: async (): Promise<DirectionSummary[]> => {
      if (!program) return [];
      const { data, error } = await supabase
        .from("direction_status")
        .select("*")
        .eq("program", program)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).filter((d) => d.project_id === projectId);
    },
    enabled: !!projectId && !!program,
  });
}

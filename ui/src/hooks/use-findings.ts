import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { findingConfidenceLabel } from "@/lib/finding-confidence";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import { useAddToast } from "@/stores/toast";
import type { Finding } from "@/types/sonde";
import type { FindingConfidence } from "@/types/sonde";

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
    enabled: !!program,
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
    enabled: !!program,
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

export function useUpdateFindingConfidence(findingId: string) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({ confidence }: { confidence: FindingConfidence }) => {
      const { data, error } = await supabase
        .from("findings")
        .update({ confidence })
        .eq("id", findingId)
        .select("*")
        .single();

      if (error) throw error;
      return data as Finding;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.findings.detail(findingId), updated);
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      addToast({
        title: "Confidence updated",
        description: `Set to ${findingConfidenceLabel(updated.confidence)}`,
        variant: "success",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to update confidence",
        description: err.message,
        variant: "error",
      });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  findingConfidenceLabel,
  isFindingConfidence,
} from "@/lib/finding-confidence";
import {
  findingImportanceLabel,
  isFindingImportance,
} from "@/lib/finding-importance";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import { useAddToast } from "@/stores/toast";
import type { Finding } from "@/types/sonde";
import type { FindingConfidence, FindingImportance } from "@/types/sonde";

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
      return (data ?? []).map(normalizeFinding);
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
      return (data ?? []).map(normalizeFinding);
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
      return normalizeFinding(data);
    },
    enabled: !!id,
  });
}

export function useUpdateFindingConfidence(findingId: string) {
  return useUpdateFindingField(findingId, {
    field: "confidence",
    successTitle: "Confidence updated",
    formatValue: (value) => findingConfidenceLabel(value as FindingConfidence),
    errorTitle: "Failed to update confidence",
  });
}

export function useUpdateFindingImportance(findingId: string) {
  return useUpdateFindingField(findingId, {
    field: "importance",
    successTitle: "Importance updated",
    formatValue: (value) => findingImportanceLabel(value as FindingImportance),
    errorTitle: "Failed to update importance",
  });
}

function useUpdateFindingField(
  findingId: string,
  config: {
    field: "confidence" | "importance";
    successTitle: string;
    formatValue: (value: string) => string;
    errorTitle: string;
  },
) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      value,
    }: {
      value: FindingConfidence | FindingImportance;
    }) => {
      const { data, error } = await supabase
        .from("findings")
        .update({ [config.field]: value })
        .eq("id", findingId)
        .select("*")
        .single();

      if (error) throw error;
      return normalizeFinding(data as Finding);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.findings.detail(findingId), updated);
      queryClient.invalidateQueries({ queryKey: ["findings"] });
      addToast({
        title: config.successTitle,
        description: `Set to ${config.formatValue(updated[config.field])}`,
        variant: "success",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: config.errorTitle,
        description: err.message,
        variant: "error",
      });
    },
  });
}

function normalizeFinding(finding: Finding): Finding {
  return {
    ...finding,
    confidence: isFindingConfidence(finding.confidence)
      ? finding.confidence
      : "medium",
    importance: isFindingImportance(finding.importance)
      ? finding.importance
      : "medium",
    evidence: Array.isArray(finding.evidence) ? finding.evidence : [],
    metadata:
      finding.metadata && typeof finding.metadata === "object"
        ? finding.metadata
        : {},
  };
}

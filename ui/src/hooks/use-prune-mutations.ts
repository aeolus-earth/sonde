import {
  QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAddToast } from "@/stores/toast";
import { experimentActionButtonLabel } from "@/lib/prune-actions";
import type {
  BulkActionResult,
  BulkDeleteFindingApplied,
  BulkDeleteQuestionApplied,
  BulkTransitionExperimentApplied,
  ExperimentPruneAction,
} from "@/types/sonde";

async function invalidatePruneQueries(
  queryClient: QueryClient,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["questions"] }),
    queryClient.invalidateQueries({ queryKey: ["findings"] }),
    queryClient.invalidateQueries({ queryKey: ["experiments"] }),
    queryClient.invalidateQueries({ queryKey: ["directions"] }),
    queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
    queryClient.invalidateQueries({ queryKey: ["activity"] }),
  ]);
}

function normalizeBulkResult<TApplied>(
  raw: unknown,
): BulkActionResult<TApplied> {
  const data = raw as Partial<BulkActionResult<TApplied>> | null;
  return {
    applied: Array.isArray(data?.applied) ? data.applied : [],
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
    summary: {
      requested:
        typeof data?.summary?.requested === "number"
          ? data.summary.requested
          : 0,
      applied:
        typeof data?.summary?.applied === "number" ? data.summary.applied : 0,
      skipped:
        typeof data?.summary?.skipped === "number" ? data.summary.skipped : 0,
    },
  };
}

export function useDeleteQuestions() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      ids,
    }: {
      ids: string[];
    }): Promise<BulkActionResult<BulkDeleteQuestionApplied>> => {
      const { data, error } = await supabase.rpc("bulk_delete_questions", {
        target_ids: ids,
      });
      if (error) throw error;
      return normalizeBulkResult<BulkDeleteQuestionApplied>(data);
    },
    onSuccess: async (result) => {
      await invalidatePruneQueries(queryClient);
      addToast({
        title:
          result.summary.applied === 1
            ? "Question deleted"
            : result.summary.applied > 1
              ? "Questions deleted"
              : "No questions deleted",
        description:
          result.summary.skipped > 0
            ? `${result.summary.applied} deleted, ${result.summary.skipped} skipped.`
            : undefined,
        variant: result.summary.applied > 0 ? "success" : "info",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to delete questions",
        description: err.message,
        variant: "error",
      });
    },
  });
}

export function useDeleteFindings() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      ids,
    }: {
      ids: string[];
    }): Promise<BulkActionResult<BulkDeleteFindingApplied>> => {
      const { data, error } = await supabase.rpc("bulk_delete_findings", {
        target_ids: ids,
      });
      if (error) throw error;
      return normalizeBulkResult<BulkDeleteFindingApplied>(data);
    },
    onSuccess: async (result) => {
      await invalidatePruneQueries(queryClient);
      const artifactCount = result.applied.reduce(
        (total, item) => total + (item.artifact_count ?? 0),
        0,
      );
      const descriptionParts: string[] = [];
      if (artifactCount > 0) {
        descriptionParts.push(
          `${artifactCount} artifact${artifactCount === 1 ? "" : "s"} queued for cleanup.`,
        );
      }
      if (result.summary.skipped > 0) {
        descriptionParts.push(
          `${result.summary.skipped} skipped during delete.`,
        );
      }
      addToast({
        title:
          result.summary.applied === 1
            ? "Finding deleted"
            : result.summary.applied > 1
              ? "Findings deleted"
              : "No findings deleted",
        description:
          descriptionParts.length > 0 ? descriptionParts.join(" ") : undefined,
        variant: result.summary.applied > 0 ? "success" : "info",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to delete findings",
        description: err.message,
        variant: "error",
      });
    },
  });
}

export function useTransitionExperiments() {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: ExperimentPruneAction;
    }): Promise<BulkActionResult<BulkTransitionExperimentApplied>> => {
      const { data, error } = await supabase.rpc(
        "bulk_transition_experiments",
        {
          target_ids: ids,
          target_status: status,
          origin: "ui_prune",
        },
      );
      if (error) throw error;
      return normalizeBulkResult<BulkTransitionExperimentApplied>(data);
    },
    onSuccess: async (result, variables) => {
      await invalidatePruneQueries(queryClient);
      addToast({
        title:
          result.summary.applied === 1
            ? "Experiment updated"
            : result.summary.applied > 1
              ? "Experiments updated"
              : "No experiments updated",
        description:
          result.summary.applied > 0
            ? `${experimentActionButtonLabel(variables.status)} applied to ${result.summary.applied}.`
            : result.summary.skipped > 0
              ? `${result.summary.skipped} skipped because they were not eligible.`
              : undefined,
        variant: result.summary.applied > 0 ? "success" : "info",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to update experiments",
        description: err.message,
        variant: "error",
      });
    },
  });
}

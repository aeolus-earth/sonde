import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useAddToast } from "@/stores/toast";
import type { ExperimentStatus } from "@/types/sonde";

export function useAddNote(
  recordType: "experiment" | "direction" | "project",
  recordId: string,
) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({
      content,
      source,
    }: {
      content: string;
      source: string;
    }) => {
      // Generate note ID
      const { count } = await supabase
        .from("notes")
        .select("*", { count: "exact", head: true });
      const nextId = `NOTE-${String((count ?? 0) + 1).padStart(4, "0")}`;

      const { data, error } = await supabase
        .from("notes")
        .insert({
          id: nextId,
          record_type: recordType,
          record_id: recordId,
          content,
          source,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notes.byRecord(recordType, recordId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.activity.byRecord(recordId),
      });
      addToast({ title: "Note added", variant: "success" });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to add note",
        description: err.message,
        variant: "error",
      });
    },
  });
}

export function useUpdateExperimentStatus(experimentId: string) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({ status }: { status: ExperimentStatus }) => {
      const { data, error } = await supabase
        .from("experiments")
        .update({ status })
        .eq("id", experimentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.experiments.detail(experimentId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.activity.byRecord(experimentId),
      });
      // Invalidate list queries across all programs
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      addToast({
        title: `Status updated to ${variables.status}`,
        variant: "success",
      });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to update status",
        description: err.message,
        variant: "error",
      });
    },
  });
}

export function useAddTag(experimentId: string) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({ tag, currentTags }: { tag: string; currentTags: string[] }) => {
      const newTags = [...new Set([...currentTags, tag])];
      const { data, error } = await supabase
        .from("experiments")
        .update({ tags: newTags })
        .eq("id", experimentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.experiments.detail(experimentId),
      });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      addToast({ title: "Tag added", variant: "success" });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to add tag",
        description: err.message,
        variant: "error",
      });
    },
  });
}

export function useRemoveTag(experimentId: string) {
  const queryClient = useQueryClient();
  const addToast = useAddToast();

  return useMutation({
    mutationFn: async ({ tag, currentTags }: { tag: string; currentTags: string[] }) => {
      const newTags = currentTags.filter((t) => t !== tag);
      const { data, error } = await supabase
        .from("experiments")
        .update({ tags: newTags })
        .eq("id", experimentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.experiments.detail(experimentId),
      });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
      addToast({ title: "Tag removed", variant: "info" });
    },
    onError: (err: Error) => {
      addToast({
        title: "Failed to remove tag",
        description: err.message,
        variant: "error",
      });
    },
  });
}

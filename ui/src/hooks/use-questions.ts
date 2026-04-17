import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import { useActiveProgram } from "@/stores/program";
import type { Question, QuestionSummary } from "@/types/sonde";

export function useQuestions() {
  const program = useActiveProgram();

  return useQuery({
    queryKey: queryKeys.questions.all(program),
    queryFn: async (): Promise<QuestionSummary[]> => {
      const { data, error } = await supabase
        .from("question_status")
        .select("*")
        .eq("program", program)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!program,
  });
}

export function useQuestion(id: string) {
  return useQuery({
    queryKey: queryKeys.questions.detail(id),
    queryFn: async (): Promise<QuestionSummary | null> => {
      const { data, error } = await supabase
        .from("question_status")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useQuestionsByDirection(
  directionId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.questions.byDirection(directionId ?? ""),
    queryFn: async (): Promise<QuestionSummary[]> => {
      const { data, error } = await supabase
        .from("question_status")
        .select("*")
        .eq("direction_id", directionId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!directionId,
  });
}

export function useQuestionsByExperiment(
  experimentId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.questions.byExperiment(experimentId ?? ""),
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from("question_experiments")
        .select("question_id,is_primary,questions(*)")
        .eq("experiment_id", experimentId!)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? [])
        .map((row) => row.questions as unknown as Question | null)
        .filter((row): row is Question => !!row);
    },
    enabled: !!experimentId,
  });
}

export function useQuestionsByFinding(findingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.questions.byFinding(findingId ?? ""),
    queryFn: async (): Promise<Question[]> => {
      const { data, error } = await supabase
        .from("question_findings")
        .select("question_id,questions(*)")
        .eq("finding_id", findingId!)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? [])
        .map((row) => row.questions as unknown as Question | null)
        .filter((row): row is Question => !!row);
    },
    enabled: !!findingId,
  });
}

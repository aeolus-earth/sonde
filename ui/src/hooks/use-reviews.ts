import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type {
  ExperimentReview,
  ExperimentReviewEntry,
  ExperimentReviewThread,
} from "@/types/sonde";

export function useExperimentReview(experimentId: string) {
  return useQuery({
    queryKey: queryKeys.reviews.byExperiment(experimentId),
    queryFn: async (): Promise<ExperimentReviewThread | null> => {
      const { data: review, error: reviewError } = await supabase
        .from("experiment_reviews")
        .select("*")
        .eq("experiment_id", experimentId)
        .maybeSingle();

      if (reviewError) throw reviewError;
      if (!review) return null;

      const { data: entries, error: entriesError } = await supabase
        .from("experiment_review_entries")
        .select("*")
        .eq("review_id", review.id)
        .order("created_at", { ascending: true });

      if (entriesError) throw entriesError;

      return {
        ...(review as ExperimentReview),
        entries: (entries ?? []) as ExperimentReviewEntry[],
      };
    },
    enabled: !!experimentId,
  });
}

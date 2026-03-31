import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { queryKeys } from "@/lib/query-keys";
import type { ActivityLogEntry } from "@/types/sonde";

export function useGlobalActivity(limit = 100) {
  return useQuery({
    queryKey: ["activity", "global", limit] as const,
    queryFn: async (): Promise<ActivityLogEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    },
  });
}

export function useRecentActivity(program: string) {
  return useQuery({
    queryKey: queryKeys.activity.recent(program),
    queryFn: async (): Promise<ActivityLogEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data;
    },
  });
}

export function useRecordActivity(recordId: string) {
  return useQuery({
    queryKey: queryKeys.activity.byRecord(recordId),
    queryFn: async (): Promise<ActivityLogEntry[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("record_id", recordId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!recordId,
  });
}

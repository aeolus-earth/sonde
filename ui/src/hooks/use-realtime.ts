import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
type Table =
  | "experiments"
  | "findings"
  | "directions"
  | "questions"
  | "activity_log";

let channelCounter = 0;

/**
 * Subscribes to Supabase realtime changes on a table and
 * invalidates the matching TanStack Query cache entries.
 *
 * Each call gets a unique channel name to avoid collisions
 * when multiple components subscribe to the same table.
 */
export function useRealtimeInvalidation(
  table: Table,
  queryKeyPrefix: readonly string[]
) {
  const queryClient = useQueryClient();
  const channelRef = useRef<string>(`rt-${table}-${++channelCounter}`);

  useEffect(() => {
    const channel = supabase
      .channel(channelRef.current)
      .on(
        "postgres_changes" as const,
        { event: "*", schema: "public", table },
        () => {
          queryClient.invalidateQueries({ queryKey: [...queryKeyPrefix] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryKeyPrefix, queryClient]);
}
